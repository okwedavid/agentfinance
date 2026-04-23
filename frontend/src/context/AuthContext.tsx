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
  bio?: string;
  walletAddress?: string | null;
  isAdmin?: boolean;
}

interface AuthCtx {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
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
  token: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  async function refresh() {
    if (!isLoggedIn()) {
      setUser(null);
      setToken(null);
      setLoading(false);
      return;
    }

    try {
      const me = await getMe();
      setUser(me);
      setToken(getToken());
    } catch {
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(username: string, password: string) {
    setLoading(true);
    await apiLogin(username, password);
    await refresh();
  }

  async function register(username: string, password: string) {
    setLoading(true);
    await apiRegister(username, password);
    await refresh();
  }

  function logout() {
    apiLogout();
    setUser(null);
    setToken(null);
    window.location.href = "/login";
  }

  useEffect(() => {
    void refresh();
  }, []);

  const isAdmin = user?.isAdmin === true || user?.username === "okwedavid";

  const value = useMemo(() => ({
    login,
    register,
    user,
    loading,
    refresh,
    logout,
    isAdmin,
    token,
  }), [user, loading, isAdmin, token]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
