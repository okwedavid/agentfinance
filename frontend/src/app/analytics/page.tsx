"use client";
import { useEffect, useState } from "react";
import { getAnalyticsSummary, getAnalyticsHistory, isLoggedIn } from "@/lib/api";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell
} from "recharts";
import Link from "next/link";

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

const AGENT_ICONS: Record<string, string> = {
  research: '🔬', trading: '📈', content: '✍️', execution: '⚡', coordinator: '🧠'
};

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
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
      const [sum, hist] = await Promise.all([
        getAnalyticsSummary(),
        getAnalyticsHistory(100, 0),
      ]);
      setSummary(sum);
      setHistory(Array.isArray(hist) ? hist : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  const agents = summary?.agents || [];
  const trends = summary?.trends || [];
  const total = summary?.summary?.totalTasks ?? 0;
  const successRate = summary?.summary?.successRate ?? 0;

  return (
    <div className="min-h-screen bg-[#080d1a]">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">← Dashboard</Link>
          <span className="text-white font-bold flex-1 text-center">Analytics</span>
          <Link href="/wallet" className="text-gray-400 hover:text-white text-sm transition-colors">Wallet</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-2xl p-6 text-center">
            <p className="text-red-300 font-medium mb-2">Failed to load analytics</p>
            <p className="text-red-400/70 text-sm">{error}</p>
            <button onClick={load} className="mt-4 text-xs bg-red-900/40 border border-red-700/40 px-4 py-2 rounded-lg text-red-300">
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
                <p className="text-gray-500 text-xs mb-1">Total tasks run</p>
                <p className="text-3xl font-bold text-white">{total}</p>
              </div>
              <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
                <p className="text-gray-500 text-xs mb-1">Success rate</p>
                <p className="text-3xl font-bold text-emerald-400">{successRate}%</p>
              </div>
              <div className="bg-white/4 border border-white/8 rounded-2xl p-5 col-span-2 sm:col-span-1">
                <p className="text-gray-500 text-xs mb-1">Agent types active</p>
                <p className="text-3xl font-bold text-blue-400">{agents.length}</p>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Trend */}
              <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">Task Volume (7 Days)</h2>
                {trends.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={trends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="date" stroke="#4b5563" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis stroke="#4b5563" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="tasks" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-44 flex items-center justify-center text-gray-600 text-sm">
                    Run tasks to see trend data
                  </div>
                )}
              </div>

              {/* Agent breakdown */}
              <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
                <h2 className="text-white font-semibold text-sm mb-4">Tasks by Agent Type</h2>
                {agents.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={agents} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                      <XAxis type="number" stroke="#4b5563" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis dataKey="agent" type="category" stroke="#4b5563" tick={{ fontSize: 10, fill: '#6b7280' }} width={70} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="tasks" radius={[0, 4, 4, 0]}>
                        {agents.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-44 flex items-center justify-center text-gray-600 text-sm">
                    No agent data yet
                  </div>
                )}
              </div>
            </div>

            {/* History table */}
            <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
                <h2 className="text-white font-semibold text-sm">Task History</h2>
                <button onClick={load} className="text-xs text-blue-400 hover:text-blue-300">↻ Refresh</button>
              </div>

              {history.length === 0 ? (
                <div className="p-10 text-center text-gray-600 text-sm">
                  No task history yet. Create tasks from the dashboard.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-white/5">
                        <th className="px-5 pb-3 pt-4 text-gray-500 font-medium text-xs">Task</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs">Status</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs hidden sm:table-cell">Duration</th>
                        <th className="px-3 pb-3 pt-4 text-gray-500 font-medium text-xs hidden md:table-cell">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {history.map((entry: any) => (
                        <tr key={entry.id} className="hover:bg-white/3 transition-colors">
                          <td className="px-5 py-3 text-gray-300 max-w-xs">
                            <span className="truncate block">{entry.action}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-md border ${
                              entry.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-600/30' :
                              entry.status === 'failed'    ? 'bg-red-500/15 text-red-400 border-red-600/30' :
                              entry.status === 'running'   ? 'bg-blue-500/15 text-blue-400 border-blue-600/30' :
                              'bg-yellow-500/15 text-yellow-400 border-yellow-600/30'
                            }`}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-gray-500 text-xs hidden sm:table-cell">
                            {entry.durationMs ? `${(entry.durationMs/1000).toFixed(1)}s` : '—'}
                          </td>
                          <td className="px-3 py-3 text-gray-600 text-xs hidden md:table-cell">
                            {new Date(entry.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
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