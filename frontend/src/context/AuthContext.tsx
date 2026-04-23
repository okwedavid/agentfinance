"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getMe, isLoggedIn, logout as apiLogout } from "@/lib/api";

interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  bio?: string;
  walletAddress?: string;
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
  token?: string | null;
}

const AuthContext = createContext<AuthCtx>({
  login: async () => {},
  register: async () => {},
  user: null, loading: true,
  refresh: async () => {}, logout: () => {},
  isAdmin: false,
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 1. Define the missing login function
  const login = async (username: string, password: string) => {
    // Your login logic here (e.g., await apiLogin(username, password))
    await refresh(); // Refresh user state after login
  };

  // 2. Define the missing register function
  const register = async (username: string, password: string) => {
    // Your register logic here
    await refresh();
  };

  const refresh = useCallback(async () => {
    if (!isLoggedIn()) { setUser(null); setLoading(false); return; }
    try {
      const u = await getMe();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function logout() {
    apiLogout();
    setUser(null);
    window.location.href = '/login';
  }

  const isAdmin = user?.isAdmin === true || user?.username === 'okwedavid';

  return (
    // Now 'login' and 'register' are defined and can be passed here
    <AuthContext.Provider value={{ user, loading, refresh, logout, isAdmin, login, register }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}