"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  getMe,
  isLoggedIn,
  login as apiLogin,
  logout as apiLogout,
  logoutSession as apiLogoutSession,
  deleteAccount as apiDeleteAccount,
  register as apiRegister,
} from "@/lib/api";

interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  emailVerified?: boolean;
  role?: string;
  bio?: string;
  walletAddress?: string | null;
  walletProfiles?: Record<string, string>;
  preferredNetwork?: string | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isNewUser?: boolean;
}

/**
 * Explicit authentication lifecycle.
 *
 * The old context used `loading: boolean` with `user: User | null`. That encoding
 * cannot distinguish "the check has not finished yet" from "the check finished and
 * found no session", which is the ambiguity that makes a guard redirect a signed-in
 * user to /login on a hard refresh: the guard sees `loading === false, user === null`
 * during the window before `/auth/me` resolves.
 *
 * AUTH_CHECKING must never be treated as AUTHENTICATED or UNAUTHENTICATED.
 */
export type AuthStatus = "AUTH_CHECKING" | "AUTHENTICATED" | "UNAUTHENTICATED";

interface AuthCtx {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  user: User | null;
  /** @deprecated Prefer `status`. Retained so existing consumers keep working. */
  loading: boolean;
  status: AuthStatus;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isNewUser: boolean;
}

const AuthContext = createContext<AuthCtx>({
  login: async () => {},
  register: async () => {},
  user: null,
  loading: true,
  status: "AUTH_CHECKING",
  refresh: async () => {},
  logout: async () => {},
  deleteAccount: async () => {},
  isAdmin: false,
  isSuperAdmin: false,
  isNewUser: false,
});

function normalizeUser(payload: any): User | null {
  if (!payload?.id) return null;
  return {
    id: payload.id,
    username: payload.username,
    email: payload.email || null,
    emailVerified: payload.emailVerified === true,
    role: payload.role || "USER",
    displayName: payload.displayName || null,
    bio: payload.bio || null,
    walletAddress: payload.walletAddress || null,
    walletProfiles: payload.walletProfiles || {},
    preferredNetwork: payload.preferredNetwork || "ethereum",
    isAdmin: payload.role === "ADMIN" || payload.role === "SUPER_ADMIN" || payload.isAdmin === true,
    isSuperAdmin: payload.role === "SUPER_ADMIN" || payload.isSuperAdmin === true,
    isNewUser: payload.isNewUser === true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("AUTH_CHECKING");
  const [isNewUser, setIsNewUser] = useState(false);

  // Guards against a slow /auth/me response being overwritten by a later
  // resolution, which is how an intermittent logout appears in production.
  const checkIdRef = useRef(0);

  const applyAuthResult = useCallback((payload: any, newUser: boolean) => {
    setUser(normalizeUser(payload));
    setIsNewUser(newUser && payload?.isNewUser === true);
    setStatus("AUTHENTICATED");
  }, []);

  const refresh = useCallback(async () => {
    const checkId = ++checkIdRef.current;

    // No marker cookie means no session is even possible, so skip the round trip.
    // This is an optimisation only: the server stays the authority, so a forged
    // marker cookie still fails every authenticated call.
    if (!isLoggedIn()) {
      if (checkId === checkIdRef.current) {
        setUser(null);
        setIsNewUser(false);
        setStatus("UNAUTHENTICATED");
      }
      return;
    }

    try {
      const me = await getMe();
      if (checkId !== checkIdRef.current) return;
      const normalized = normalizeUser(me);
      if (normalized) {
        setUser(normalized);
        setIsNewUser(false);
        setStatus("AUTHENTICATED");
      } else {
        // A 200 with an unusable payload is not a session.
        setUser(null);
        setIsNewUser(false);
        setStatus("UNAUTHENTICATED");
      }
    } catch {
      if (checkId !== checkIdRef.current) return;
      setUser(null);
      setIsNewUser(false);
      setStatus("UNAUTHENTICATED");
    }
  }, []);

  async function login(username: string, password: string) {
    const payload = await apiLogin(username, password);
    applyAuthResult(payload, false);
  }

  async function register(username: string, email: string, password: string) {
    const payload = await apiRegister(username, email, password);
    applyAuthResult(payload, true);
  }

  async function logout() {
    // Revoke server-side first; the response also clears the cookie.
    await apiLogoutSession();
    apiLogout();
    // Invalidate any in-flight check so a pending /auth/me cannot resurrect the
    // session after logout.
    checkIdRef.current += 1;
    setUser(null);
    setIsNewUser(false);
    setStatus("UNAUTHENTICATED");
    window.location.href = "/login";
  }

  async function deleteAccount() {
    await apiDeleteAccount();
    apiLogout();
    checkIdRef.current += 1;
    setUser(null);
    setIsNewUser(false);
    setStatus("UNAUTHENTICATED");
    window.location.href = "/login";
  }

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const loading = status === "AUTH_CHECKING";

  const value = useMemo(() => ({
    login,
    register,
    user,
    loading,
    status,
    refresh,
    logout,
    deleteAccount,
    isAdmin,
    isSuperAdmin,
    isNewUser,
  }), [user, loading, status, isAdmin, isSuperAdmin, isNewUser, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
