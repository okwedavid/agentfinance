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
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true,
  refresh: async () => {}, logout: () => {},
  isAdmin: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Admin = username is "okwedavid" or has admin flag
  const isAdmin = user?.isAdmin === true || user?.username === 'okwedavid';

  return (
    <Ctx.Provider value={{ user, loading, refresh, logout, isAdmin }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);