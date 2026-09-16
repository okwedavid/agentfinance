"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  getMe,
  getToken,
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
  role?: string;
  bio?: string;
  walletAddress?: string | null;
  walletProfiles?: Record<string, string>;
  preferredNetwork?: string | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isNewUser?: boolean;
}

interface AuthCtx {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isNewUser: boolean;
  token: string | null;
}

const AuthContext = createContext<AuthCtx>({
  login: async () => {},
  register: async () => {},
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
  deleteAccount: async () => {},
  isAdmin: false,
  isSuperAdmin: false,
  isNewUser: false,
  token: null,
});

function normalizeUser(payload: any): User | null {
  if (!payload?.id) return null;
  return {
    id: payload.id,
    username: payload.username,
    email: payload.email || null,
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
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);

  async function applyAuthResult(payload: any, newUser: boolean) {
    setUser(normalizeUser(payload));
    setToken(getToken());
    setIsNewUser(newUser && payload?.isNewUser === true);
  }

  async function refresh() {
    if (!isLoggedIn()) {
      setUser(null);
      setToken(null);
      setIsNewUser(false);
      setLoading(false);
      return;
    }

    try {
      const me = await getMe();
      setUser(normalizeUser(me));
      setToken(getToken());
      setIsNewUser(false);
    } catch {
      setUser(null);
      setToken(null);
      setIsNewUser(false);
    } finally {
      setLoading(false);
    }
  }

  async function login(username: string, password: string) {
    setLoading(true);
    const payload = await apiLogin(username, password);
    await applyAuthResult(payload, false);
  }

  async function register(username: string, email: string, password: string) {
    setLoading(true);
    const payload = await apiRegister(username, password, email);
    await applyAuthResult(payload, true);
  }

  async function logout() {
    await apiLogoutSession();
    apiLogout();
    setUser(null);
    setToken(null);
    setIsNewUser(false);
    window.location.href = "/login";
  }

  async function deleteAccount() {
    await apiDeleteAccount();
    apiLogout();
    setUser(null);
    setToken(null);
    setIsNewUser(false);
    window.location.href = "/register";
  }

  useEffect(() => {
    void refresh();
  }, []);

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const value = useMemo(() => ({
    login,
    register,
    user,
    loading,
    refresh,
    logout,
    deleteAccount,
    isAdmin,
    isSuperAdmin,
    isNewUser,
    token,
  }), [user, loading, isAdmin, isSuperAdmin, isNewUser, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}