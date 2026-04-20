"use client";
import { useEffect, useState } from 'react';
import { getAnalyticsSummary, getAnalyticsHistory } from '@/lib/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = '/login'; return; }

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [sum, hist] = await Promise.all([
          getAnalyticsSummary(),
          getAnalyticsHistory(50, 0),
        ]);
        setSummary(sum);
        setHistory(Array.isArray(hist) ? hist : []);
      } catch (e: any) {
        setError(e.message || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading analytics...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center">
      <div className="bg-red-900/30 border border-red-700 rounded-2xl p-6 max-w-md text-center">
        <p className="text-red-300 font-medium mb-2">Failed to load analytics</p>
        <p className="text-red-400 text-sm">{error}</p>
        <p className="text-gray-500 text-xs mt-3">Check that your backend is running and ANTHROPIC_API_KEY is set in Railway.</p>
      </div>
    </div>
  );

  const agents = summary?.agents || [];
  const trends = summary?.trends || [];
  const total = summary?.summary?.totalTasks || 0;
  const successRate = summary?.summary?.successRate || 0;
  const agentCount = summary?.summary?.agents || agents.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Analytics</h1>
          <p className="text-blue-300 text-sm mt-1">Agent performance and earnings overview</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Tasks Run', value: total, sub: 'all time' },
            { label: 'Success Rate', value: `${successRate}%`, sub: 'completed successfully' },
            { label: 'Active Agents', value: agentCount, sub: 'agent types deployed' },
          ].map(c => (
            <div key={c.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-xs text-blue-300 mb-1">{c.label}</p>
              <p className="text-3xl font-bold text-white">{c.value}</p>
              <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

          {/* Task trends */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4">Task Volume (7 Days)</h2>
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.9)', border: 'none', borderRadius: 8 }} />
                  <Line type="monotone" dataKey="tasks" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
                No trend data yet — run some tasks first
              </div>
            )}
          </div>

          {/* Agent performance */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4">Tasks by Agent</h2>
            {agents.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={agents} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="agent" type="category" stroke="#6b7280" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip contentStyle={{ background: 'rgba(15,23,42,0.9)', border: 'none', borderRadius: 8 }} />
                  <Bar dataKey="tasks" radius={[0, 4, 4, 0]}>
                    {agents.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
                No agent data yet
              </div>
            )}
          </div>
        </div>

        {/* Recent task history */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4">Recent Tasks</h2>
          {history.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              No task history yet. Create your first task from the dashboard.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-white/5">
                    <th className="pb-3 pr-4">Task</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Duration</th>
                    <th className="pb-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {history.map((entry: any) => (
                    <tr key={entry.id} className="text-gray-300">
                      <td className="py-3 pr-4 max-w-xs truncate">{entry.action}</td>
                      <td className="py-3 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          entry.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                          entry.status === 'failed'    ? 'bg-red-900/50 text-red-400' :
                          entry.status === 'running'   ? 'bg-blue-900/50 text-blue-400' :
                          'bg-yellow-900/50 text-yellow-400'
                        }`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-gray-500">
                        {entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="py-3 text-gray-500 text-xs">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}