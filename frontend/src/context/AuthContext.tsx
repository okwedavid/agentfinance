"use client";
import { createContext, useState, useEffect, useContext } from 'react';
import { apiFetch } from '../lib/api';

type User = { id: string; username: string } | null;

type AuthContextType = {
  user: User;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => void;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: false,
  login: async () => {},
  register: async () => {},
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // fetch current user from backend /auth/me endpoint
    (async () => {
      try {
        const { fetchMe } = await import('../lib/api');
        const json = await fetchMe();
        setUser(json);
      } catch (e) {
        setUser(null);
      }
    })();
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    const j = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    setUser({ id: j.id, username: j.username });
    setLoading(false);
  };
  const register = async (username: string, password: string) => {
    setLoading(true);
    const j = await apiFetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    setUser({ id: j.id, username: j.username });
    setLoading(false);
  };
  const logout = () => {
    setUser(null);
    apiFetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthProvider;