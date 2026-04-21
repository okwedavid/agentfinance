"use client";
import { useEffect, useState } from "react";
import { getMe, apiFetch, getTasks, isLoggedIn } from "@/lib/api";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getMe().then(u => {
      setUser(u);
      setDisplayName(u.displayName || u.username || '');
      setBio(u.bio || '');
    });
    getTasks().then(t => { if (Array.isArray(t)) setTasks(t); });
  }, []);

  async function saveProfile() {
    setSaving(true); setMsg('');
    try {
      // Store in localStorage as fallback (backend profile endpoint optional)
      localStorage.setItem('af_displayName', displayName);
      localStorage.setItem('af_bio', bio);
      setUser((prev: any) => ({ ...prev, displayName, bio }));
      setEditing(false);
      setMsg('✅ Profile updated');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    } finally { setSaving(false); }
  }

  // Stats derived from tasks
  const completed = tasks.filter(t => t.status === 'completed').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const successRate = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

  // Get agent types used
  const agentTypes: Record<string, number> = {};
  tasks.forEach(t => {
    try {
      const type = JSON.parse(t.result || '{}').agentType || 'coordinator';
      agentTypes[type] = (agentTypes[type] || 0) + 1;
    } catch {}
  });
  const topAgent = Object.entries(agentTypes).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

  const AGENT_ICONS: Record<string, string> = {
    research:'🔬', trading:'📈', content:'✍️', execution:'⚡', coordinator:'🧠'
  };

  // Load from localStorage
  useEffect(() => {
    const dn = localStorage.getItem('af_displayName');
    const b = localStorage.getItem('af_bio');
    if (dn) setDisplayName(dn);
    if (b) setBio(b);
  }, []);

  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">
      <TopNav username={user?.username} />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 pb-24 md:pb-8">

        {/* Profile card */}
        <div className="glass rounded-2xl p-6 mb-5 animate-fade-in">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-2xl font-bold flex-shrink-0">
              {initials}
            </div>

            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="space-y-3">
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Display name"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    placeholder="Bio (optional)"
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveProfile} disabled={saving}
                      className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(false)}
                      className="bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-sm transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-xl font-bold text-white">{displayName || user?.username}</h1>
                    <button onClick={() => setEditing(true)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                      Edit
                    </button>
                  </div>
                  <p className="text-gray-500 text-sm">@{user?.username}</p>
                  {bio && <p className="text-gray-300 text-sm mt-2">{bio}</p>}
                  {user?.walletAddress && (
                    <p className="text-gray-600 text-xs mt-2 font-mono truncate">{user.walletAddress}</p>
                  )}
                </>
              )}
              {msg && <p className={`text-sm mt-2 ${msg.startsWith('❌') ? 'text-red-400' : 'text-emerald-400'}`}>{msg}</p>}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total Tasks', value: tasks.length, color: 'text-white', icon: '📋' },
            { label: 'Completed', value: completed, color: 'text-emerald-400', icon: '✅' },
            { label: 'Success Rate', value: `${successRate}%`, color: 'text-blue-400', icon: '🎯' },
            { label: 'Top Agent', value: `${AGENT_ICONS[topAgent] || '🤖'} ${topAgent}`, color: 'text-violet-400', icon: '⭐' },
          ].map(s => (
            <div key={s.label} className="glass rounded-xl px-4 py-3">
              <p className="text-gray-500 text-xs mb-1">{s.label}</p>
              <p className={`text-lg font-bold ${s.color} capitalize`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Recent activity */}
        <div className="glass rounded-2xl overflow-hidden mb-5">
          <div className="px-5 py-4 border-b border-white/[0.05] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent Tasks</h2>
            <Link href="/analytics" className="text-xs text-blue-400 hover:text-blue-300">View all →</Link>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {tasks.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                No tasks yet. <Link href="/dashboard" className="text-blue-400">Create one →</Link>
              </div>
            ) : tasks.slice(0, 8).map(task => {
              let agentType = 'coordinator';
              try { agentType = JSON.parse(task.result || '{}').agentType || 'coordinator'; } catch {}
              return (
                <div key={task.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="text-base">{AGENT_ICONS[agentType] || '🤖'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-sm truncate">{task.action}</p>
                    <p className="text-gray-600 text-xs">{new Date(task.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-md border flex-shrink-0 ${
                    task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-600/20' :
                    task.status === 'failed' ? 'bg-red-500/10 text-red-300 border-red-600/20' :
                    task.status === 'running' ? 'bg-blue-500/10 text-blue-300 border-blue-600/20' :
                    'bg-yellow-500/10 text-yellow-300 border-yellow-600/20'
                  }`}>{task.status}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Wallet quick status */}
        <div className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Wallet</h2>
          {user?.walletAddress ? (
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <div className="flex-1 min-w-0">
                <p className="text-white font-mono text-sm truncate">{user.walletAddress}</p>
                <p className="text-gray-500 text-xs">Connected — earnings route here</p>
              </div>
              <Link href="/wallet" className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">Manage →</Link>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-amber-400 text-sm">No wallet connected</p>
              <Link href="/wallet" className="text-xs bg-amber-600/20 border border-amber-600/30 text-amber-300 px-3 py-1.5 rounded-xl hover:bg-amber-600/30 transition-colors">
                Connect →
              </Link>
            </div>
          )}
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}