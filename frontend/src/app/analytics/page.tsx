"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isLoggedIn, getTasks, API_BASE } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function AnalyticsPage() {
  const { user }              = useAuth();
  const [tasks, setTasks]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState<7 | 14 | 30>(7);
  const { status: wsStatus }  = useWebSocket();

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getTasks().then(setTasks).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Computed stats
  const completed  = tasks.filter(t => t.status === 'completed').length;
  const failed     = tasks.filter(t => t.status === 'failed').length;
  const running    = tasks.filter(t => t.status === 'running').length;
  const rate       = tasks.length > 0 ? Math.round(completed / tasks.length * 100) : 0;
  const earnings   = (completed * 0.0035).toFixed(4);

  // Daily breakdown for last N days
  const days: { date: string; label: string; total: number; completed: number; failed: number }[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayTasks = tasks.filter(t => (t.createdAt || '').startsWith(key));
    days.push({
      date: key,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      total: dayTasks.length,
      completed: dayTasks.filter(t => t.status === 'completed').length,
      failed: dayTasks.filter(t => t.status === 'failed').length,
    });
  }
  const maxDayTotal = Math.max(...days.map(d => d.total), 1);

  // Status breakdown
  const statusMap = { completed, failed, running, pending: tasks.filter(t => t.status === 'pending').length };

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={wsStatus} />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 pb-24 md:pb-6 space-y-5 page-enter">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Analytics</h1>
            <p className="text-gray-400 text-sm">Agent performance and earnings history</p>
          </div>
          <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
            {([7, 14, 30] as const).map(d => (
              <button key={d} onClick={() => setRange(d)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
                  range === d ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
          {[
            { icon: '📋', label: 'Total Tasks',   value: tasks.length,   color: 'text-white',        sub: `${running} running` },
            { icon: '✅', label: 'Completed',     value: completed,       color: 'text-emerald-400',  sub: `${rate}% success rate` },
            { icon: '❌', label: 'Failed',        value: failed,          color: 'text-red-400',      sub: `${100 - rate}% failure rate` },
            { icon: '💰', label: 'Est. Earnings', value: `${earnings} ETH`, color: 'text-amber-400', sub: `≈ $${(parseFloat(earnings) * 3200).toFixed(2)}` },
          ].map((s, i) => (
            <div key={s.label} className="glass rounded-2xl p-4 animate-fade-in card-glow"
              style={{ animationDelay: `${i * 60}ms` }}>
              <div className="text-xl mb-3">{s.icon}</div>
              <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
              <p className="text-gray-600 text-xs">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Daily activity chart */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-5">Daily Task Activity</h2>
          {loading ? (
            <div className="h-32 skeleton rounded-xl" />
          ) : (
            <div className="space-y-2">
              {days.slice(-14).map(day => (
                <div key={day.date} className="flex items-center gap-3">
                  <span className="text-gray-600 text-xs w-16 flex-shrink-0 text-right">{day.label}</span>
                  <div className="flex-1 flex items-center gap-1">
                    {/* Completed bar */}
                    <div
                      className="h-5 rounded bg-emerald-500/40 border border-emerald-500/30 transition-all duration-500 flex items-center justify-center"
                      style={{ width: `${(day.completed / maxDayTotal) * 100}%`, minWidth: day.completed > 0 ? 20 : 0 }}>
                      {day.completed > 0 && (
                        <span className="text-emerald-300 text-[9px] font-mono">{day.completed}</span>
                      )}
                    </div>
                    {/* Failed bar */}
                    {day.failed > 0 && (
                      <div
                        className="h-5 rounded bg-red-500/30 border border-red-500/25 flex items-center justify-center"
                        style={{ width: `${(day.failed / maxDayTotal) * 100}%`, minWidth: 20 }}>
                        <span className="text-red-300 text-[9px] font-mono">{day.failed}</span>
                      </div>
                    )}
                    {day.total === 0 && (
                      <div className="h-5 w-full rounded bg-white/[0.03]" />
                    )}
                  </div>
                  <span className="text-gray-600 text-xs w-6 text-right flex-shrink-0">{day.total || ''}</span>
                </div>
              ))}
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <div className="w-3 h-3 rounded bg-emerald-500/40 border border-emerald-500/30" /> Completed
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <div className="w-3 h-3 rounded bg-red-500/30 border border-red-500/25" /> Failed
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Status breakdown */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <h2 className="text-sm font-semibold text-white mb-4">Status Breakdown</h2>
          <div className="space-y-3">
            {Object.entries(statusMap).map(([status, count]) => {
              const pct = tasks.length > 0 ? (count / tasks.length) * 100 : 0;
              const colors: Record<string, string> = {
                completed: 'bg-emerald-500',
                failed:    'bg-red-500',
                running:   'bg-blue-500',
                pending:   'bg-amber-500',
              };
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-gray-300 text-xs capitalize">{status}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs">{count} tasks</span>
                      <span className="text-white text-xs font-mono w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <Bar pct={pct} color={colors[status]} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent tasks table */}
        <div className="glass rounded-2xl overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">All Tasks</h2>
            <Link href="/dashboard" className="text-xs text-blue-400 hover:text-blue-300">
              Deploy agent →
            </Link>
          </div>
          {loading ? (
            <div className="p-5 space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-10 skeleton rounded-lg" />)}
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-3xl mb-2 animate-float">📊</div>
              <p className="text-gray-500 text-sm">No data yet. Deploy your first agent on the Dashboard.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
              {tasks.slice(0, 50).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <span className="text-sm flex-shrink-0">
                    {t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : t.status === 'running' ? '⚡' : '⏳'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-xs truncate">{t.action}</p>
                    <p className="text-gray-600 text-xs">
                      {new Date(t.createdAt || Date.now()).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    t.status === 'completed' ? 'badge-completed' :
                    t.status === 'failed'    ? 'badge-failed' :
                    t.status === 'running'   ? 'badge-running' : 'badge-pending'
                  }`}>{t.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}