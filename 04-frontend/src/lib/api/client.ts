import { t } from "@/lib/strings";
import { getAccessToken, setAccessToken } from "./token";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export const API_BASE = `${BASE_URL}/api/v1`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** Extra keys from the error body (e.g. existing_contact_id on 409). */
  readonly extras: Record<string, unknown>;

  constructor(
    status: number,
    code: string | null,
    message: string,
    extras: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extras = extras;
  }

  /** pt-BR message for toasts: translated code, or a generic fallback. */
  get userMessage(): string {
    if (this.code && t.errors.byCode[this.code]) {
      return t.errors.byCode[this.code];
    }
    if (this.status === 401) return t.errors.byCode.unauthorized;
    if (this.status === 403) return t.errors.byCode.forbidden;
    if (this.status === 404) return t.errors.byCode.not_found;
    if (this.status === 422) return t.errors.byCode.validation_error;
    if (this.status === 0) return t.errors.network;
    return t.errors.generic;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage;
  return t.errors.generic;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the Authorization header (login/refresh). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/**
 * Backend errors are flat: `{"detail": "<msg>", "code": "<stable_code>", ...extras}`
 * (see 03-backend/app/core/exceptions.py). Extra keys are preserved for
 * callers (e.g. `existing_contact_id` on duplicate_phone).
 */
async function parseError(res: Response): Promise<ApiError> {
  let code: string | null = null;
  let message = res.statusText;
  let extras: Record<string, unknown> = {};
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object") {
      const body = data as Record<string, unknown>;
      if (typeof body.detail === "string") message = body.detail;
      if (typeof body.code === "string") code = body.code;
      extras = Object.fromEntries(
        Object.entries(body).filter(([k]) => k !== "detail" && k !== "code"),
      );
    }
  } catch {
    // non-JSON body — keep statusText
  }
  return new ApiError(res.status, code, message, extras);
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

let refreshPromise: Promise<boolean> | null = null;

/** Single-flight refresh: POST /auth/refresh using the httpOnly cookie. */
export async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const data = (await res.json()) as { access_token: string };
      setAccessToken(data.access_token);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!options.anonymous) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, null, "network error");
  }
}

/**
 * Typed API request with automatic token refresh on 401 (single retry).
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, options);

  if (res.status === 401 && !options.anonymous) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawRequest(path, options);
    }
  }

  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
