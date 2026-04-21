"use client";
import { useEffect, useState } from "react";
import { isLoggedIn } from "@/lib/api";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

function token() { return typeof window !== 'undefined' ? localStorage.getItem('token') : null; }

async function api(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const STATUS_PILL: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-300 border-emerald-600/20',
  failed:    'bg-red-500/10 text-red-300 border-red-600/20',
  running:   'bg-blue-500/10 text-blue-300 border-blue-600/20',
  pending:   'bg-yellow-500/10 text-yellow-300 border-yellow-600/20',
};

const AGENT_ICON: Record<string, string> = {
  research: '🔬', trading: '📈', content: '✍️', execution: '⚡', coordinator: '🧠',
};

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Analytics() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    load();
  }, []);

  async function load() {
    setLoading(true); setError('');
    try {
      const data = await api('/tasks');
      setTasks(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Derived stats
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'completed').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const successRate = total > 0 ? Math.round((done / total) * 100) : 0;

  // Agent breakdown from task results
  const agentMap: Record<string, number> = {};
  tasks.forEach(t => {
    try {
      const r = JSON.parse(t.result || '{}');
      const type = r.agentType || 'unknown';
      agentMap[type] = (agentMap[type] || 0) + 1;
    } catch {}
  });
  const agentEntries = Object.entries(agentMap).sort((a, b) => b[1] - a[1]);

  // Last 7 days task volume
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * 86400000);
    const label = d.toLocaleDateString('en', { weekday: 'short' });
    const key = d.toISOString().slice(0, 10);
    const count = tasks.filter(t => t.createdAt?.slice(0, 10) === key).length;
    return { label, count };
  });
  const maxDay = Math.max(...days.map(d => d.count), 1);

  return (
    <div className="min-h-screen bg-[#060b16] text-white flex flex-col">

      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#060b16]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">← Dashboard</Link>
          <span className="font-bold flex-1 text-center text-white">Analytics</span>
          <Link href="/wallet" className="text-gray-400 hover:text-white text-sm transition-colors">Wallet</Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-900/20 border border-red-700/30 rounded-2xl p-6 text-center mb-6">
            <p className="text-red-300 font-medium mb-2">Failed to load analytics</p>
            <p className="text-red-400/70 text-sm font-mono mb-4">{error}</p>
            <button onClick={load} className="text-xs bg-red-900/30 border border-red-700/30 px-5 py-2 rounded-xl text-red-300 hover:bg-red-900/50 transition-colors">
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Total Tasks', value: total, color: 'text-white', icon: '📊' },
                { label: 'Completed', value: done, color: 'text-emerald-400', icon: '✅' },
                { label: 'Success Rate', value: `${successRate}%`, color: 'text-blue-400', icon: '🎯' },
                { label: 'Failed', value: failed, color: 'text-red-400', icon: '⚠️' },
              ].map(s => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-gray-500 text-xs">{s.label}</p>
                    <span className="text-lg">{s.icon}</span>
                  </div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

              {/* 7-day bar chart */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-white mb-4">Task Volume — Last 7 Days</h2>
                {days.every(d => d.count === 0) ? (
                  <p className="text-gray-600 text-sm text-center py-8">No tasks in the last 7 days</p>
                ) : (
                  <div className="flex items-end gap-2 h-32">
                    {days.map(d => (
                      <div key={d.label} className="flex-1 flex flex-col items-center gap-1.5">
                        <span className="text-xs text-gray-500">{d.count > 0 ? d.count : ''}</span>
                        <div
                          className="w-full bg-blue-500/70 rounded-t transition-all duration-700 hover:bg-blue-400 cursor-default"
                          style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count > 0 ? '8px' : '2px', opacity: d.count > 0 ? 1 : 0.2 }}
                          title={`${d.label}: ${d.count} tasks`}
                        />
                        <span className="text-xs text-gray-600">{d.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status breakdown */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-white mb-4">Status Breakdown</h2>
                <div className="space-y-4">
                  {[
                    { label: 'Completed', count: done, color: 'bg-emerald-500' },
                    { label: 'Running', count: running, color: 'bg-blue-500' },
                    { label: 'Pending', count: pending, color: 'bg-yellow-500' },
                    { label: 'Failed', count: failed, color: 'bg-red-500' },
                  ].map(s => {
                    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                    return (
                      <div key={s.label}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-gray-300 text-sm">{s.label}</span>
                          <span className="text-gray-500 text-xs">{s.count} ({pct}%)</span>
                        </div>
                        <Bar pct={pct} color={s.color} />
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Agent breakdown */}
            {agentEntries.length > 0 && (
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 mb-6">
                <h2 className="text-sm font-semibold text-white mb-4">Agent Type Usage</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {agentEntries.map(([type, count]) => {
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={type}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-gray-300 text-sm capitalize">
                            {AGENT_ICON[type] || '🤖'} {type}
                          </span>
                          <span className="text-gray-500 text-xs">{count} tasks</span>
                        </div>
                        <Bar pct={pct} color="bg-violet-500" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Task history */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
                <h2 className="text-sm font-semibold text-white">Task History</h2>
                <button onClick={load} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↻ Refresh</button>
              </div>

              {tasks.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="text-3xl mb-2">📋</div>
                  <p className="text-gray-400 text-sm">No tasks yet</p>
                  <Link href="/dashboard" className="text-blue-400 text-xs hover:text-blue-300 mt-1 inline-block">
                    Create a task →
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.05] text-left">
                        <th className="px-5 pb-3 pt-4 text-gray-500 font-medium text-xs">Task</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs">Status</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs hidden sm:table-cell">Agent</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs hidden md:table-cell">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {tasks.map((task: any) => {
                        let agentType = '—';
                        try { agentType = JSON.parse(task.result || '{}').agentType || '—'; } catch {}
                        return (
                          <tr key={task.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-3 text-gray-300 max-w-xs">
                              <span className="truncate block">{task.action}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-md border ${STATUS_PILL[task.status] || STATUS_PILL.pending}`}>
                                {task.status}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-gray-500 text-xs hidden sm:table-cell capitalize">
                              {AGENT_ICON[agentType] || ''} {agentType}
                            </td>
                            <td className="px-3 py-3 text-gray-600 text-xs hidden md:table-cell">
                              {new Date(task.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-white/[0.05] mt-6">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-gray-600 text-xs">© 2025 AgentFinance · Built by okwedavid</p>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <Link href="/dashboard" className="hover:text-gray-400 transition-colors">Dashboard</Link>
            <Link href="/wallet" className="hover:text-gray-400 transition-colors">Wallet</Link>
            <span>All rights reserved</span>
          </div>
        </div>
      </footer>
    </div>
  );
}