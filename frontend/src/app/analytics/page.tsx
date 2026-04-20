"use client";
import { useEffect, useState } from "react";
import { isLoggedIn } from "@/lib/api";
import Link from "next/link";

const API = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('token') : null;
}

async function apiFetch(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-700/30',
  failed:    'bg-red-500/10 text-red-400 border-red-700/30',
  running:   'bg-blue-500/10 text-blue-400 border-blue-700/30',
  pending:   'bg-yellow-500/10 text-yellow-400 border-yellow-700/30',
};

export default function AnalyticsPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      // Load tasks (user's own tasks) and summary in parallel
      const [taskData, summaryData] = await Promise.all([
        apiFetch('/tasks'),
        apiFetch('/analytics/summary').catch(() => null),
      ]);
      setTasks(Array.isArray(taskData) ? taskData : []);
      setSummary(summaryData);
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  // Compute stats from actual task data
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const running = tasks.filter(t => t.status === 'running').length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Agent type breakdown from results
  const agentBreakdown: Record<string, number> = {};
  tasks.forEach(t => {
    try {
      const r = JSON.parse(t.result || '{}');
      const type = r.agentType || 'unknown';
      agentBreakdown[type] = (agentBreakdown[type] || 0) + 1;
    } catch {}
  });

  return (
    <div className="min-h-screen bg-[#060b16] text-white">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#060b16]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">← Dashboard</Link>
          <span className="font-bold flex-1 text-center">Analytics</span>
          <Link href="/wallet" className="text-gray-400 hover:text-white text-sm transition-colors">Wallet</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-2xl p-6 text-center mb-6">
            <p className="text-red-300 font-medium mb-2">Failed to load analytics</p>
            <p className="text-red-400/70 text-sm font-mono">{error}</p>
            <button onClick={load} className="mt-4 text-xs bg-red-900/30 border border-red-700/30 px-4 py-2 rounded-lg text-red-300 hover:bg-red-900/50">
              Try again
            </button>
          </div>
        )}

        {!loading && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Total Tasks', value: total, color: 'text-white' },
                { label: 'Completed', value: completed, color: 'text-emerald-400' },
                { label: 'Success Rate', value: `${successRate}%`, color: 'text-blue-400' },
                { label: 'Failed', value: failed, color: 'text-red-400' },
              ].map(s => (
                <div key={s.label} className="bg-white/3 border border-white/7 rounded-2xl px-4 py-4">
                  <p className="text-gray-500 text-xs mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Agent breakdown + running */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {/* Agent type breakdown */}
              <div className="bg-white/3 border border-white/7 rounded-2xl p-5">
                <h2 className="text-sm font-semibold mb-4">Agent Type Breakdown</h2>
                {Object.keys(agentBreakdown).length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-6">Run tasks to see agent breakdown</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(agentBreakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => {
                        const icons: Record<string,string> = { research:'🔬', trading:'📈', content:'✍️', execution:'⚡', coordinator:'🧠', unknown:'🤖' };
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div key={type}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-300 capitalize">{icons[type] || '🤖'} {type}</span>
                              <span className="text-xs text-gray-500">{count} tasks ({pct}%)</span>
                            </div>
                            <div className="h-1.5 bg-white/5 rounded-full">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Status breakdown */}
              <div className="bg-white/3 border border-white/7 rounded-2xl p-5">
                <h2 className="text-sm font-semibold mb-4">Status Overview</h2>
                <div className="space-y-3">
                  {[
                    { label: 'Completed', count: completed, color: 'bg-emerald-500' },
                    { label: 'Failed', count: failed, color: 'bg-red-500' },
                    { label: 'Running', count: running, color: 'bg-blue-500' },
                    { label: 'Pending', count: tasks.filter(t=>t.status==='pending').length, color: 'bg-yellow-500' },
                  ].map(s => {
                    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                    return (
                      <div key={s.label}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-gray-300">{s.label}</span>
                          <span className="text-xs text-gray-500">{s.count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full">
                          <div className={`h-full ${s.color} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Task history table */}
            <div className="bg-white/3 border border-white/7 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
                <h2 className="text-sm font-semibold">Task History</h2>
                <button onClick={load} className="text-xs text-blue-400 hover:text-blue-300">↻ Refresh</button>
              </div>

              {tasks.length === 0 && !error ? (
                <div className="p-12 text-center">
                  <div className="text-3xl mb-2">📊</div>
                  <p className="text-gray-400 text-sm">No tasks yet</p>
                  <p className="text-gray-600 text-xs mt-1">
                    <Link href="/dashboard" className="text-blue-400 hover:text-blue-300">Create a task</Link> to see analytics
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-left">
                        <th className="px-5 pb-3 pt-4 text-gray-500 font-medium text-xs">Task</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs">Status</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs hidden sm:table-cell">Agent</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs hidden md:table-cell">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tasks.map((task: any) => {
                        let agentType = '—';
                        try { agentType = JSON.parse(task.result || '{}').agentType || '—'; } catch {}
                        const agentIcons: Record<string,string> = { research:'🔬', trading:'📈', content:'✍️', execution:'⚡', coordinator:'🧠' };
                        return (
                          <tr key={task.id} className="hover:bg-white/3 transition-colors">
                            <td className="px-5 py-3 text-gray-300 max-w-xs">
                              <span className="truncate block">{task.action}</span>
                            </td>
                            <td className="px-3 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-md border ${STATUS_STYLE[task.status] || STATUS_STYLE.pending}`}>
                                {task.status}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-gray-500 text-xs hidden sm:table-cell capitalize">
                              {agentIcons[agentType] || ''} {agentType}
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
    </div>
  );
}