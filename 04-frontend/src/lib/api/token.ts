/**
 * In-memory access-token store (ADR-002: never localStorage).
 * The refresh token lives in an httpOnly cookie managed by the API.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
