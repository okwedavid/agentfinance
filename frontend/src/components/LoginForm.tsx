"use client";
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginForm() {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // The previous version made its own fetch to '/auth/login' — a RELATIVE path
  // with no API base and no credentials, so it could never reach the backend and
  // never carried the session cookie. It then re-issued a second login through
  // AuthContext. Now the single AuthContext path is used, so there is exactly one
  // login call and it goes through the central apiFetch (correct base URL,
  // credentials:'include').
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(name, apiKey);
    } catch (err: any) {
      setError(err?.message || 'login failed');
    }
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Agent name</label>
        <input value={name} onChange={e=>setName(e.target.value)} className="mt-1 block w-full" />
      </div>
      <div>
        <label className="block text-sm font-medium">API Key</label>
        <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} className="mt-1 block w-full" />
      </div>
      {error && <div className="text-red-500">{error}</div>}
      <button className="btn btn-primary" type="submit">Login</button>
    </form>
  );
}
