"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  getMe,
  getToken,
  isLoggedIn,
  login as apiLogin,
  logout as apiLogout,
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
  isNewUser?: boolean;
}

interface AuthCtx {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isNewUser: boolean;
  token: string | null;
}

const AuthContext = createContext<AuthCtx>({
  login: async () => {},
  register: async () => {},
  user: null,
  loading: true,
  refresh: async () => {},
  logout: () => {},
  isAdmin: false,
  isNewUser: false,
  token: null,
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
    isAdmin: payload.role === "ADMIN" || payload.isAdmin === true,
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

  function logout() {
    apiLogout();
    setUser(null);
    setToken(null);
    setIsNewUser(false);
    window.location.href = "/login";
  }

  useEffect(() => {
    void refresh();
  }, []);

  const isAdmin = user?.role === "ADMIN";

  const value = useMemo(() => ({
    login,
    register,
    user,
    loading,
    refresh,
    logout,
    isAdmin,
    isNewUser,
    token,
  }), [user, loading, isAdmin, isNewUser, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}