"use client";
import { useState } from "react";
import { login, register, isLoggedIn } from "@/lib/api";
import { useEffect } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [mode, setMode]       = useState<'login' | 'register'>('login');
  const [username, setUser]   = useState('');
  const [password, setPass]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (isLoggedIn()) window.location.href = '/dashboard';
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setError('Enter username and password'); return; }
    setLoading(true); setError('');
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      window.location.href = '/dashboard';
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-[#050c18] flex items-center justify-center p-4">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-violet-600/8 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-scale-in">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-2xl font-black mx-auto mb-4 animate-glow">
            A
          </div>
          <h1 className="text-2xl font-bold gradient-text">AgentFinance</h1>
          <p className="text-gray-400 text-sm mt-1">AI agents that generate income for you</p>
        </div>

        {/* Card */}
        <div className="glass-heavy rounded-2xl p-6">
          {/* Mode toggle */}
          <div className="flex gap-1 bg-white/[0.04] rounded-xl p-1 mb-6">
            <button onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === 'login' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}>Sign In</button>
            <button onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                mode === 'register' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}>Create Account</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Username</label>
              <input
                type="text" value={username} onChange={e => setUser(e.target.value)}
                placeholder="Enter username" autoComplete="username"
                className="input-field" autoFocus />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Password</label>
              <input
                type="password" value={password} onChange={e => setPass(e.target.value)}
                placeholder="Enter password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="input-field" />
            </div>

            {error && (
              <div className="px-3 py-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-red-400 text-xs animate-fade-in leading-relaxed">
                ❌ {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center h-11 text-base">
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {mode === 'login' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Features preview */}
          <div className="mt-6 pt-5 border-t border-white/[0.06]">
            <p className="text-gray-600 text-xs text-center mb-3">What you get</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '🤖', text: '4 AI agents' },
                { icon: '📈', text: 'DeFi yields' },
                { icon: '💰', text: 'Auto earnings' },
                { icon: '📊', text: 'Analytics' },
              ].map(f => (
                <div key={f.text} className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{f.icon}</span> {f.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-gray-700 text-xs mt-4">
          © {new Date().getFullYear()} AgentFinance · Built by okwedavid
        </p>
      </div>
    </div>
  );
}