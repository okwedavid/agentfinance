"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getTasks, getMe, isLoggedIn, logout } from "@/lib/api";
import { NewTaskModal } from "@/components/NewTaskModal";
import ErrorBoundary from "@/components/ErrorBoundary";
import Link from "next/link";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://serene-magic-production-6d0c.up.railway.app';

type Task = { id: string; action: string; status: string; createdAt: string; result?: string; };

const STATUS: Record<string, { dot: string; badge: string; label: string }> = {
  pending:   { dot: 'bg-yellow-400', badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-600/30', label: 'Pending' },
  running:   { dot: 'bg-blue-400 animate-pulse', badge: 'bg-blue-500/15 text-blue-400 border-blue-600/30', label: 'Running' },
  completed: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-600/30', label: 'Done' },
  failed:    { dot: 'bg-red-400', badge: 'bg-red-500/15 text-red-400 border-red-600/30', label: 'Failed' },
};

const EVENT_MAP: Record<string, { icon: string; color: string; label: (d: any) => string }> = {
  'task:created':     { icon: '📨', color: 'text-blue-400',   label: () => 'Task queued' },
  'task:classified':  { icon: '🧠', color: 'text-purple-400', label: d => `→ ${d?.agentLabel || 'Agent'} assigned` },
  'agent:started':    { icon: '🚀', color: 'text-cyan-400',   label: d => `${d?.agentType || ''} agent started` },
  'agent:tool_call':  { icon: '🔧', color: 'text-amber-400',  label: d => `Calling ${d?.tool || 'tool'}` },
  'agent:tool_result':{ icon: '✅', color: 'text-amber-300',  label: d => `${d?.tool || 'Tool'} returned` },
  'agent:completed':  { icon: '🎯', color: 'text-emerald-400',label: () => 'Agent completed' },
  'task:completed':   { icon: '💰', color: 'text-emerald-500',label: () => 'Task done!' },
  'task:failed':      { icon: '❌', color: 'text-red-400',    label: () => 'Task failed' },
  'task:updated':     { icon: '🔄', color: 'text-gray-400',   label: d => `Status: ${d?.status || 'updated'}` },
};

function parseTaskOutput(raw?: string): string {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    if (p.output) return p.output;
    if (p.error) return `Error: ${p.error}`;
    return JSON.stringify(p, null, 2);
  } catch {
    return raw;
  }
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [wsState, setWsState] = useState<'connecting'|'live'|'offline'>('connecting');
  const [selected, setSelected] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getMe().then(setUser).catch(() => { window.location.href = '/login'; });
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTasks();
      if (Array.isArray(data)) {
        setTasks(data);
        // Update selected task if open
        setSelected(prev => prev ? (data.find((t: Task) => t.id === prev.id) || prev) : null);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => {
    window.addEventListener('task:created', loadTasks);
    return () => window.removeEventListener('task:created', loadTasks);
  }, [loadTasks]);

  // WebSocket
  useEffect(() => {
    let ws: WebSocket, timer: ReturnType<typeof setTimeout>, dead = false;
    const connect = () => {
      if (dead) return;
      setWsState('connecting');
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => setWsState('live');
        ws.onclose = () => { setWsState('offline'); if (!dead) timer = setTimeout(connect, 3500); };
        ws.onerror = () => ws.close();
        ws.onmessage = e => {
          try {
            const msg = JSON.parse(e.data);
            const meta = EVENT_MAP[msg.type];
            if (meta) {
              setEvents(prev => [{
                key: `${msg.type}-${Date.now()}-${Math.random()}`,
                icon: meta.icon,
                color: meta.color,
                label: meta.label(msg.data),
                ts: Date.now(),
              }, ...prev].slice(0, 60));
            }
            if (['task:created','task:completed','task:failed','task:updated'].includes(msg.type)) {
              loadTasks();
            }
          } catch {}
        };
      } catch {}
    };
    connect();
    return () => { dead = true; clearTimeout(timer); ws?.close(); };
  }, [loadTasks]);

  // Scroll feed to top on new events
  useEffect(() => {
    feedRef.current?.scrollTo(0, 0);
  }, [events.length]);

  const counts = {
    total: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    done: tasks.filter(t => t.status === 'completed').length,
    pending: tasks.filter(t => t.status === 'pending').length,
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#080d1a]">

        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <header className="border-b border-white/5 bg-black/40 backdrop-blur sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            {/* Brand */}
            <div className="flex-1 min-w-0">
              <span className="text-white font-bold text-base">AgentFinance</span>
              {user && <span className="text-blue-400 text-sm ml-2 hidden sm:inline">/ {user.username}</span>}
            </div>

            {/* Nav */}
            <nav className="hidden sm:flex items-center gap-1">
              <Link href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white">Dashboard</Link>
              <Link href="/analytics" className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Analytics</Link>
              <Link href="/wallet" className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Wallet</Link>
            </nav>

            {/* Status */}
            <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border flex-shrink-0 ${
              wsState === 'live' ? 'bg-emerald-900/30 border-emerald-800/40 text-emerald-400' :
              wsState === 'connecting' ? 'bg-yellow-900/30 border-yellow-800/40 text-yellow-400' :
              'bg-red-900/30 border-red-800/40 text-red-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsState === 'live' ? 'bg-emerald-400 animate-pulse' : wsState === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'}`} />
              <span className="hidden sm:inline">{wsState === 'live' ? 'Live' : wsState === 'connecting' ? 'Connecting' : 'Offline'}</span>
            </div>

            {/* New task - flex-shrink-0 prevents overflow on mobile */}
            <div className="flex-shrink-0">
              <NewTaskModal />
            </div>

            <button
              onClick={() => { logout(); window.location.href = '/login'; }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 hidden sm:block"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-5">

          {/* ── Stats row ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Total', value: counts.total, color: 'text-white' },
              { label: 'Running', value: counts.running, color: 'text-blue-400' },
              { label: 'Completed', value: counts.done, color: 'text-emerald-400' },
              { label: 'Pending', value: counts.pending, color: 'text-yellow-400' },
            ].map(s => (
              <div key={s.label} className="bg-white/4 border border-white/8 rounded-xl px-4 py-3">
                <p className="text-gray-500 text-xs mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* ── Main grid ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Tasks panel */}
            <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                <h2 className="text-white font-semibold text-sm">Tasks</h2>
                <button onClick={loadTasks} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↻ Refresh</button>
              </div>

              <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-white/5">
                {loading && <div className="p-6 text-center text-gray-500 text-sm">Loading...</div>}
                {!loading && tasks.length === 0 && (
                  <div className="p-8 text-center">
                    <div className="text-3xl mb-2">🤖</div>
                    <p className="text-gray-400 text-sm">No tasks yet</p>
                    <p className="text-gray-600 text-xs mt-1">Use <strong className="text-gray-400">+ New Task</strong> to deploy an agent</p>
                  </div>
                )}
                {tasks.map(task => {
                  const s = STATUS[task.status] || STATUS.pending;
                  const isSelected = selected?.id === task.id;
                  return (
                    <button
                      key={task.id}
                      onClick={() => setSelected(isSelected ? null : task)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 ${isSelected ? 'bg-white/6' : ''}`}
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{task.action}</p>
                        <p className="text-gray-600 text-xs">{new Date(task.createdAt).toLocaleString()}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-md border ${s.badge}`}>{s.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Result panel */}
              {selected && (
                <div className="border-t border-white/6 p-4 bg-black/20">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-blue-300 truncate flex-1 mr-2">{selected.action}</p>
                    <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-gray-400 text-xs flex-shrink-0">✕ close</button>
                  </div>
                  {selected.result ? (
                    <div className="bg-black/40 rounded-xl p-3 max-h-56 overflow-y-auto">
                      <pre className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed break-words font-sans">
                        {parseTaskOutput(selected.result)}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-gray-600 text-xs italic">
                      {selected.status === 'running' ? 'Agent is working...' :
                       selected.status === 'pending' ? 'Waiting in queue...' : 'No output recorded.'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Live feed */}
            <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                <h2 className="text-white font-semibold text-sm">Live Agent Activity</h2>
                {events.length > 0 && (
                  <button onClick={() => setEvents([])} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Clear</button>
                )}
              </div>

              <div ref={feedRef} className="flex-1 overflow-y-auto max-h-72 divide-y divide-white/5">
                {events.length === 0 ? (
                  <div className="p-8 text-center">
                    <div className="text-3xl mb-2">📡</div>
                    <p className="text-gray-400 text-sm">Waiting for activity</p>
                    <p className="text-gray-600 text-xs mt-1">Events stream here when agents run</p>
                  </div>
                ) : events.map(ev => (
                  <div key={ev.key} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-base flex-shrink-0">{ev.icon}</span>
                    <p className={`flex-1 text-sm min-w-0 truncate ${ev.color}`}>{ev.label}</p>
                    <span className="text-gray-700 text-xs flex-shrink-0">{new Date(ev.ts).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* ── Mobile nav ───────────────────────────────────────────────── */}
          <div className="sm:hidden mt-4 flex gap-2">
            <Link href="/analytics" className="flex-1 text-center text-xs py-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-300">Analytics</Link>
            <Link href="/wallet" className="flex-1 text-center text-xs py-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-300">Wallet</Link>
            <button onClick={() => { logout(); window.location.href = '/login'; }} className="flex-1 text-xs py-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-500">Sign out</button>
          </div>

        </main>
      </div>
    </ErrorBoundary>
  );
}