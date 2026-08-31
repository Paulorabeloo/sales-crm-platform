/**
 * Message protocol between extension contexts. All API traffic goes through
 * the background service worker (fetch there bypasses page CORS thanks to
 * host_permissions, and keeps the token out of page-context reach).
 */

import type { Me } from "./types";

export interface ExtensionConfig {
  apiBase: string;
  crmBase: string;
}

export interface AuthState {
  loggedIn: boolean;
  user: Me | null;
  expiresAt: number | null; // epoch ms
}

export type BgRequest =
  | { type: "login"; email: string; password: string }
  | { type: "logout" }
  | { type: "getAuthState" }
  | { type: "getConfig" }
  | { type: "setConfig"; config: ExtensionConfig }
  | {
      type: "apiFetch";
      method: "GET" | "POST" | "PATCH" | "DELETE";
      path: string; // e.g. "/api/v1/contacts?q=..."
      body?: unknown;
    };

export interface BgError {
  status: number; // 0 = network error
  code: string;
  detail: string;
  extras?: Record<string, unknown>;
}

export type BgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: BgError };

/** Typed wrapper over chrome.runtime.sendMessage. */
export function sendToBackground<T = unknown>(request: BgRequest): Promise<BgResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(request, (response: BgResponse<T> | undefined) => {
      if (chrome.runtime.lastError || response === undefined) {
        resolve({
          ok: false,
          error: {
            status: 0,
            code: "extension_error",
            detail: chrome.runtime.lastError?.message ?? "No response from background",
          },
        });
        return;
      }
      resolve(response);
    });
  });
}
