"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isLoggedIn, getTasks, API_BASE, getToken } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [tasks, setTasks]       = useState<any[]>([]);
  const [editing, setEditing]   = useState(false);
  const [displayName, setDN]    = useState('');
  const [bio, setBio]           = useState('');
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState('');
  const { status: wsStatus }    = useWebSocket();

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getTasks().then(setTasks).catch(() => {});
    setDN(localStorage.getItem('af_displayName') || user?.displayName || user?.username || '');
    setBio(localStorage.getItem('af_bio') || user?.bio || '');
  }, [user]);

  async function save() {
    setSaving(true);
    localStorage.setItem('af_displayName', displayName);
    localStorage.setItem('af_bio', bio);
    // Try backend patch
    try {
      await fetch(`${API_BASE}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ displayName, bio }),
      });
    } catch {}
    await refresh();
    setSaving(false); setEditing(false);
    setMsg('✅ Profile saved');
    setTimeout(() => setMsg(''), 3000);
  }

  const completed = tasks.filter(t => t.status === 'completed').length;
  const failed    = tasks.filter(t => t.status === 'failed').length;
  const rate      = tasks.length > 0 ? Math.round(completed / tasks.length * 100) : 0;
  const wallet    = typeof window !== 'undefined' ? localStorage.getItem('agentfi_wallet') : null;
  const initials  = (displayName || user?.username || 'U').slice(0, 2).toUpperCase();
  const earnings  = (completed * 0.0035).toFixed(4);

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={wsStatus} />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 pb-24 md:pb-6 space-y-4 page-enter">

        <div>
          <h1 className="text-xl font-bold text-white">Profile</h1>
          <p className="text-gray-400 text-sm">Manage your identity and view agent history</p>
        </div>

        {/* Profile hero card */}
        <div className="glass rounded-2xl p-6 animate-fade-in">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-2xl font-black animate-glow">
                {initials}
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-[#050c18] flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-3 animate-fade-in">
                  <input value={displayName} onChange={e => setDN(e.target.value)}
                    placeholder="Display name" className="input-field" autoFocus />
                  <textarea value={bio} onChange={e => setBio(e.target.value)}
                    placeholder="Short bio about yourself…" rows={2}
                    className="input-field resize-none" />
                  <div className="flex gap-2">
                    <button onClick={save} disabled={saving} className="btn-primary">
                      {saving
                        ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                        : 'Save profile'}
                    </button>
                    <button onClick={() => setEditing(false)} className="btn-ghost">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="animate-fade-in">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-xl font-bold text-white">{displayName || user?.username || 'Agent'}</h2>
                    <button onClick={() => setEditing(true)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors border border-blue-500/25 px-2 py-0.5 rounded-lg">
                      Edit
                    </button>
                  </div>
                  <p className="text-gray-500 text-sm mb-2">@{user?.username}</p>
                  {bio && <p className="text-gray-300 text-sm leading-relaxed">{bio}</p>}
                  {wallet && (
                    <p className="text-gray-600 text-xs font-mono mt-2 truncate">
                      {wallet.slice(0, 6)}…{wallet.slice(-4)}
                    </p>
                  )}
                </div>
              )}
              {msg && <p className="text-emerald-400 text-sm mt-2 animate-fade-in">{msg}</p>}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
          {[
            { icon: '📋', label: 'Total Tasks',  value: tasks.length,      color: 'text-white' },
            { icon: '✅', label: 'Completed',    value: completed,          color: 'text-emerald-400' },
            { icon: '🎯', label: 'Success Rate', value: `${rate}%`,         color: 'text-blue-400' },
            { icon: '💰', label: 'Est. Earned',  value: `${earnings} ETH`, color: 'text-amber-400' },
          ].map((s, i) => (
            <div key={s.label}
              className="glass rounded-xl p-4 animate-fade-in card-glow"
              style={{ animationDelay: `${i * 60}ms` }}>
              <div className="text-2xl mb-3">{s.icon}</div>
              <p className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Recent task activity */}
        <div className="glass rounded-2xl overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
            <Link href="/analytics" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {tasks.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-3xl mb-2 animate-float">🤖</div>
                <p className="text-gray-500 text-sm">No tasks yet.</p>
                <Link href="/dashboard" className="text-blue-400 text-sm hover:text-blue-300">
                  Deploy your first agent →
                </Link>
              </div>
            ) : tasks.slice(0, 8).map(t => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                <span className="text-base flex-shrink-0">
                  {t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : t.status === 'running' ? '⚡' : '⏳'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white/80 text-sm truncate">{t.action}</p>
                  <p className="text-gray-600 text-xs">
                    {new Date(t.createdAt || Date.now()).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                  t.status === 'completed' ? 'badge-completed' :
                  t.status === 'failed'    ? 'badge-failed' :
                  t.status === 'running'   ? 'badge-running' : 'badge-pending'
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Wallet status */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Wallet</h2>
            <Link href="/wallet" className="text-xs text-blue-400 hover:text-blue-300">Manage →</Link>
          </div>
          {wallet ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">💳</div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-mono truncate">{wallet}</p>
                <p className="text-emerald-400 text-xs flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse inline-block" />
                  Connected · earnings route here
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-amber-400 text-sm">⚠️ No wallet connected</p>
              <Link href="/wallet" className="btn-primary text-xs py-2">Connect →</Link>
            </div>
          )}
        </div>

        {/* Agent capability badges */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-3">Agent Access</h2>
          <div className="flex flex-wrap gap-2">
            {['🔬 Research','📈 Trading','✍️ Content','⚡ Execution'].map(a => (
              <div key={a} className="flex items-center gap-1.5 text-xs bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-1.5 text-blue-300">
                {a}
              </div>
            ))}
            {['📱 Social (soon)','🛡️ Security (soon)'].map(a => (
              <div key={a} className="flex items-center gap-1.5 text-xs bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-gray-500">
                {a}
              </div>
            ))}
          </div>
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}