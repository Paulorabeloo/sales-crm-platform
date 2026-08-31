/**
 * Background service worker: owns the auth session and proxies every API call.
 *
 * - Access token lives in chrome.storage.session (memory-backed, cleared when
 *   the browser closes; not accessible from web pages).
 * - Config (API/CRM base URLs) lives in chrome.storage.local.
 * - Auth flow: POST /auth/login?client=extension issues a 12h access token
 *   with no refresh cookie (see backend ADR in 17-wave3-notes.md).
 */

import type { AuthState, BgRequest, BgResponse, ExtensionConfig } from "./lib/messages";
import type { ApiErrorBody, Me, TokenResponse } from "./lib/types";

const DEFAULT_CONFIG: ExtensionConfig = {
  apiBase: "http://127.0.0.1:8000",
  crmBase: "http://localhost:3000",
};

interface StoredSession {
  token: string;
  expiresAt: number; // epoch ms
  user: Me;
}

// --- Storage helpers ----------------------------------------------------------

async function getConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get("config");
  const config = stored["config"] as Partial<ExtensionConfig> | undefined;
  return {
    apiBase: (config?.apiBase ?? DEFAULT_CONFIG.apiBase).replace(/\/+$/, ""),
    crmBase: (config?.crmBase ?? DEFAULT_CONFIG.crmBase).replace(/\/+$/, ""),
  };
}

async function setConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ config });
}

async function getSession(): Promise<StoredSession | null> {
  const stored = await chrome.storage.session.get("session");
  const session = stored["session"] as StoredSession | undefined;
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    await chrome.storage.session.remove("session");
    return null;
  }
  return session;
}

// --- API ----------------------------------------------------------------------

function networkError(): BgResponse<never> {
  return { ok: false, error: { status: 0, code: "network_error", detail: "Network error" } };
}

async function toErrorResponse(response: Response): Promise<BgResponse<never>> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // non-JSON error body
  }
  const { detail = response.statusText, code = "http_error", ...extras } = body ?? {};
  return {
    ok: false,
    error: { status: response.status, code, detail: String(detail), extras },
  };
}

async function handleLogin(email: string, password: string): Promise<BgResponse<AuthState>> {
  const { apiBase } = await getConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/v1/auth/login?client=extension`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return networkError();
  }
  if (!response.ok) return toErrorResponse(response);
  const tokens = (await response.json()) as TokenResponse;

  let meResponse: Response;
  try {
    meResponse = await fetch(`${apiBase}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
  } catch {
    return networkError();
  }
  if (!meResponse.ok) return toErrorResponse(meResponse);
  const user = (await meResponse.json()) as Me;

  const session: StoredSession = {
    token: tokens.access_token,
    // Refuse to use the token in its final minute to avoid mid-request expiry.
    expiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
    user,
  };
  await chrome.storage.session.set({ session });
  return { ok: true, data: { loggedIn: true, user, expiresAt: session.expiresAt } };
}

async function handleApiFetch(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<BgResponse<unknown>> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      error: { status: 401, code: "not_logged_in", detail: "Not logged in" },
    };
  }
  const { apiBase } = await getConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return networkError();
  }
  if (response.status === 401) {
    // Token rejected server-side: drop the session so the UI asks for login.
    await chrome.storage.session.remove("session");
  }
  if (!response.ok) return toErrorResponse(response);
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json() };
}

async function handleRequest(request: BgRequest): Promise<BgResponse<unknown>> {
  switch (request.type) {
    case "login":
      return handleLogin(request.email, request.password);
    case "logout": {
      await chrome.storage.session.remove("session");
      return { ok: true, data: null };
    }
    case "getAuthState": {
      const session = await getSession();
      const state: AuthState = session
        ? { loggedIn: true, user: session.user, expiresAt: session.expiresAt }
        : { loggedIn: false, user: null, expiresAt: null };
      return { ok: true, data: state };
    }
    case "getConfig":
      return { ok: true, data: await getConfig() };
    case "setConfig": {
      await setConfig(request.config);
      return { ok: true, data: null };
    }
    case "apiFetch":
      return handleApiFetch(request.method, request.path, request.body);
  }
}

chrome.runtime.onMessage.addListener(
  (request: BgRequest, _sender, sendResponse: (response: BgResponse<unknown>) => void) => {
    handleRequest(request)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: {
            status: 0,
            code: "background_error",
            detail: error instanceof Error ? error.message : String(error),
          },
        });
      });
    return true; // keep the message channel open for the async response
  },
);
