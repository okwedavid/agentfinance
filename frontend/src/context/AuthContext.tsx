"use client";
import { createContext, useState, useEffect, useContext } from 'react';
import { login as apiLogin, register as apiRegister, getMe, logout as apiLogout } from '../lib/api';

type User = { id: string; username: string; walletAddress?: string } | null;

type AuthContextType = {
  user: User;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => void;
};

export const AuthContext = createContext<AuthContextType>({
  user: null, loading: true,
  login: async () => {}, register: async () => {}, logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) { setLoading(false); return; }

    getMe()
      .then(json => setUser({ id: json.id, username: json.username, walletAddress: json.walletAddress }))
      .catch(() => {
        // Token expired or invalid
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const j = await apiLogin(username, password);
    setUser({ id: j.id, username: j.username });
  };

  const register = async (username: string, password: string) => {
    const j = await apiRegister(username, password);
    setUser({ id: j.id, username: j.username });
  };

  const logout = () => {
    apiLogout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthProvider;