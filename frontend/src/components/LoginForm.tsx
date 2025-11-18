"use client";
import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

export default function LoginForm() {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const { login } = useContext(AuthContext);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, apiKey }) });
      const data = await res.json();
      if (res.ok && data.token) {
        await login(name, apiKey);
      } else {
        setError(data.error || 'login failed');
      }
    } catch (e) { setError('network error'); }
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Agent name</label>
        <input value={name} onChange={e=>setName(e.target.value)} className="mt-1 block w-full" />
      </div>
      <div>
        <label className="block text-sm font-medium">API Key</label>
        <input value={apiKey} onChange={e=>setApiKey(e.target.value)} className="mt-1 block w-full" />
      </div>
      {error && <div className="text-red-500">{error}</div>}
      <button className="btn btn-primary" type="submit">Login</button>
    </form>
  );
}
