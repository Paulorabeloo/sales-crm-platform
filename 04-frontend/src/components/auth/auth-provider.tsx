"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api/resources";
import { tryRefresh } from "@/lib/api/client";
import { setAccessToken } from "@/lib/api/token";
import type { User } from "@/lib/api/types";

interface AuthContextValue {
  user: User | null;
  /** True while restoring the session on first load. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const queryClient = useQueryClient();

  // Restore session on first load: refresh cookie -> access token -> /auth/me
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await tryRefresh();
        if (ok) {
          const me = await authApi.me();
          if (!cancelled) setUser(me);
        }
      } catch {
        // stay logged out
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    // Backend login returns only the token — the profile comes from /auth/me.
    const res = await authApi.login(email, password);
    setAccessToken(res.access_token);
    const me = await authApi.me();
    setUser(me);
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // logout locally regardless
    }
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      isAdmin: user?.role === "ADMIN",
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
