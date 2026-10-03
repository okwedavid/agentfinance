"use client";
import { useState } from "react";
import { getOAuthProviders, API_BASE, type OAuthProviderInfo } from "@/lib/api";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import OAuthProviderButton from "@/components/OAuthProviderButton";

export default function LoginPage() {
  const { login, register, status: authStatus } = useAuth();
  const router = useRouter();
  const [mode, setMode]       = useState<'login' | 'register'>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'register') {
      return 'register';
    }
    return 'login';
  });
  const [username, setUser]   = useState('');
  const [email, setEmail]     = useState('');
  const [password, setPass]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);

  // Availability comes from the backend, never from a hardcoded list here.
  const activeProviders = providers.filter((p) => p.available);
  const unavailableProviders = providers.filter((p) => !p.available);

  // Send an already-authenticated visitor onward — but only on a CONFIRMED
  // session, and only after the auth check has actually completed. The previous
  // check ran on mount against client storage, which raced /auth/me and could
  // bounce a valid session back here.
  useEffect(() => {
    if (authStatus === "AUTHENTICATED") router.replace(safeNextPath() ?? "/dashboard");
  }, [authStatus, router]);

  /**
   * Where to go after signing in.
   *
   * The guard passes the attempted route as `?next=`. Only same-site absolute
   * paths are honoured: accepting an absolute URL here would turn the login page
   * into an open redirect, sending a freshly authenticated user (and their
   * referrer) to an attacker-controlled site.
   */
  function safeNextPath(): string | null {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("next");
    if (!raw) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    return raw;
  }

  useEffect(() => {
    getOAuthProviders()
      .then((list) => {
        const order = ["google", "facebook", "x"];
        setProviders(
          [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
        );
      })
      .catch(() => setProviders([]));
  }, []);

  // Surface an OAuth failure the backend redirected here with, instead of
  // showing a bare login form as if nothing happened.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const oauthError = params.get("oauth_error");
    if (oauthError) setError(oauthError);
    // Clear the fragment so a refresh does not re-show a stale error.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setError('Enter username and password'); return; }
    if (mode === 'register' && !email.trim()) { setError('Enter your email address'); return; }
    setLoading(true); setError('');
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), email.trim(), password);
      // Honour the route the guard was protecting, so an interrupted deep link
      // resumes where the user intended instead of always landing on /dashboard.
      router.replace(safeNextPath() ?? '/dashboard');
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
          {/* J1.8: this line claimed an economic outcome the platform cannot
              deliver. Agents book a reward value against completed work; no
              external party pays for that work, so nothing here generates
              income. Stated as what it actually does. */}
          <p className="text-gray-400 text-sm mt-1">AI agents that do work and book reward value for it</p>
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

            {mode === 'register' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Email</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email"
                  className="input-field" />
              </div>
            )}

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

          {/* Only providers the backend reports as ACTIVE are offered as a
              working sign-in. Facebook and X have no credentials configured in
              this deployment, and the previous UI rendered all three as clickable
              buttons regardless — advertising a capability that does not exist
              and failing at the click. */}
          {activeProviders.length > 0 && (
            <>
              <div className="mt-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-gray-600">
                <span className="h-px flex-1 bg-white/[0.06]" />
                <span>Do you already have an account?</span>
                <span className="h-px flex-1 bg-white/[0.06]" />
              </div>
              <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(activeProviders.length, 3)}, minmax(0, 1fr))` }}>
                {activeProviders.map((p) => (
                  <OAuthProviderButton
                    key={p.id}
                    provider={p}
                    href={`${API_BASE}/auth/oauth/${p.id}/start`}
                  />
                ))}
              </div>
            </>
          )}

          {unavailableProviders.length > 0 && (
            <p className="mt-4 text-center text-[11px] leading-5 text-gray-600">
              Not available: {unavailableProviders.map((p) => p.displayName).join(", ")}.{" "}
              These sign-in methods are not configured on this deployment.
            </p>
          )}

          {/* Features preview */}
          <div className="mt-6 pt-5 border-t border-white/[0.06]">
            <p className="text-gray-600 text-xs text-center mb-3">What you get</p>
            <div className="grid grid-cols-2 gap-2">
              {/* "Auto earnings" implied money arriving on its own. The
                  platform books reward value for completed work and pays it
                  out only from the operator treasury against confirmed
                  withdrawals, so the label names the mechanism. */}
              {[
                { icon: '🤖', text: '3 agent roles' },
                { icon: '📈', text: 'Work analytics' },
                { icon: '💰', text: 'Reward ledger' },
                { icon: '📊', text: 'Task history' },
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