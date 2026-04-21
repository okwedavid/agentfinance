"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getTasks, getMe, isLoggedIn, logout } from "@/lib/api";
import { NewTaskModal } from "@/components/NewTaskModal";
import ErrorBoundary from "@/components/ErrorBoundary";
import Link from "next/link";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://serene-magic-production-6d0c.up.railway.app';

type Task = { id: string; action: string; status: string; createdAt: string; result?: string; userId?: string };

const STATUS = {
  pending:   { dot: 'bg-yellow-400', badge: 'bg-yellow-500/10 text-yellow-300 border-yellow-600/20', label: 'Pending' },
  running:   { dot: 'bg-blue-400 animate-pulse', badge: 'bg-blue-500/10 text-blue-300 border-blue-600/20', label: 'Running' },
  completed: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-600/20', label: 'Done' },
  failed:    { dot: 'bg-red-400', badge: 'bg-red-500/10 text-red-300 border-red-600/20', label: 'Failed' },
} as const;

const EVENTS: Record<string, { icon: string; color: string; label: (d: any) => string }> = {
  'task:created':     { icon: '📨', color: 'text-blue-300',   label: () => 'Task queued' },
  'task:classified':  { icon: '🧠', color: 'text-violet-300', label: d => `${d?.agentLabel || 'Agent'} assigned` },
  'agent:started':    { icon: '🚀', color: 'text-cyan-300',   label: d => `${d?.agentType || ''} agent started` },
  'agent:tool_call':  { icon: '⚙️', color: 'text-amber-300',  label: d => `Calling ${d?.tool || 'tool'}` },
  'agent:tool_result':{ icon: '✓',  color: 'text-amber-200',  label: d => `${d?.tool || 'Tool'} returned` },
  'agent:completed':  { icon: '🎯', color: 'text-emerald-300',label: () => 'Agent completed' },
  'task:completed':   { icon: '💰', color: 'text-emerald-400',label: () => 'Task done — check output' },
  'task:failed':      { icon: '✕',  color: 'text-red-300',    label: () => 'Task failed' },
  'task:updated':     { icon: '↻',  color: 'text-gray-400',   label: d => `Status → ${d?.status || 'updated'}` },
};

// ── Markdown-like output renderer ─────────────────────────────────────────────

function renderOutput(text: string) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // H2 ---
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key++} className="text-base font-bold text-white mt-4 mb-1 pb-1 border-b border-white/10">
          {line.slice(3)}
        </h2>
      );
      continue;
    }

    // Bold **text** inline
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      elements.push(
        <p key={key++} className="text-sm font-semibold text-white/90 mt-2">
          {line.slice(2, -2)}
        </p>
      );
      continue;
    }

    // Key: Value line
    if (line.includes('**') && line.includes(':')) {
      const rendered = line.replace(/\*\*(.+?)\*\*/g, '<span class="font-semibold text-white">$1</span>');
      elements.push(
        <p
          key={key++}
          className="text-sm text-gray-200 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      );
      continue;
    }

    // Horizontal rule ---
    if (line.trim() === '---') {
      elements.push(<hr key={key++} className="border-white/10 my-3" />);
      continue;
    }

    // Emoji-prefixed highlight lines (🏆 💰 ⚠️ 📋 ✅)
    if (/^[🏆💰⚠️📋✅🎯📈🔴🟡🟢⚡🔬✍️]/.test(line)) {
      elements.push(
        <p key={key++} className="text-sm text-emerald-200 leading-relaxed py-0.5">
          {line}
        </p>
      );
      continue;
    }

    // Bullet point
    if (line.startsWith('- ') || line.startsWith('• ')) {
      elements.push(
        <li key={key++} className="text-sm text-gray-300 leading-relaxed ml-3 list-none flex gap-2">
          <span className="text-blue-400 flex-shrink-0">·</span>
          <span>{line.slice(2)}</span>
        </li>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)?.[1];
      const content = line.replace(/^\d+\.\s/, '');
      elements.push(
        <li key={key++} className="text-sm text-gray-300 leading-relaxed ml-1 list-none flex gap-2.5">
          <span className="text-blue-400 font-mono text-xs mt-0.5 flex-shrink-0">{num}.</span>
          <span>{content}</span>
        </li>
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      elements.push(<div key={key++} className="h-1.5" />);
      continue;
    }

    // Error line
    if (line.startsWith('❌') || line.toLowerCase().startsWith('error:')) {
      elements.push(
        <p key={key++} className="text-sm text-red-300 bg-red-900/20 rounded px-2 py-1 mt-1">
          {line}
        </p>
      );
      continue;
    }

    // Default paragraph
    elements.push(
      <p key={key++} className="text-sm text-gray-300 leading-relaxed">
        {line}
      </p>
    );
  }

  return elements;
}

function parseTaskOutput(raw?: string): string {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    if (p.error) return `❌ ${p.error}`;
    if (p.output) return p.output;
    return JSON.stringify(p, null, 2);
  } catch {
    return raw;
  }
}

// ── Styled floating popup ─────────────────────────────────────────────────────

function TaskPopup({ task, onClose }: { task: Task; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const output = parseTaskOutput(task.result);
  const s = STATUS[task.status as keyof typeof STATUS] || STATUS.pending;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Popup card */}
      <div
        ref={ref}
        className="relative w-full max-w-lg bg-[#0c1628] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
        style={{ maxHeight: '85vh' }}
      >
        {/* Gradient top bar */}
        <div className="h-0.5 bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-500" />

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/6">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${s.dot}`} />
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium text-sm leading-snug">{task.action}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded border ${s.badge}`}>{s.label}</span>
              <span className="text-gray-600 text-xs">{new Date(task.createdAt).toLocaleString()}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-all text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: 'calc(85vh - 200px)' }}>
          {task.status === 'running' && (
            <div className="flex items-center gap-3 py-4">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="text-blue-300 text-sm">Agent is working on this...</p>
            </div>
          )}

          {task.status === 'pending' && (
            <div className="py-4 flex items-center gap-3 text-yellow-300">
              <span className="text-lg">⏳</span>
              <p className="text-sm">Waiting in queue...</p>
            </div>
          )}

          {(task.status === 'completed' || task.status === 'failed') && output ? (
            <div className="space-y-0.5">
              {renderOutput(output)}
            </div>
          ) : (task.status === 'completed' || task.status === 'failed') && !output ? (
            <p className="text-gray-500 text-sm italic py-4">No output recorded.</p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/6 flex items-center justify-between bg-black/20">
          <p className="text-gray-600 text-xs">Task ID: {task.id.slice(0, 8)}…</p>
          <Link href="/analytics" onClick={onClose} className="text-blue-400 hover:text-blue-300 text-xs transition-colors">
            Full Analytics →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [ws, setWs] = useState<'live' | 'connecting' | 'offline'>('connecting');
  const [popup, setPopup] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; return; }
    getMe().then(setUser).catch(() => { window.location.href = '/login'; });
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const data = await getTasks();
      if (Array.isArray(data)) {
        setTasks(data);
        setPopup(prev => prev ? data.find((t: Task) => t.id === prev.id) || prev : null);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => {
    window.addEventListener('task:created', loadTasks);
    return () => window.removeEventListener('task:created', loadTasks);
  }, [loadTasks]);

  // Poll when tasks are running
  useEffect(() => {
    const hasActive = tasks.some(t => t.status === 'running' || t.status === 'pending');
    if (!hasActive) return;
    const t = setInterval(loadTasks, 4000);
    return () => clearInterval(t);
  }, [tasks, loadTasks]);

  // WebSocket
  useEffect(() => {
    let socket: WebSocket, timer: ReturnType<typeof setTimeout>, dead = false;
    const connect = () => {
      if (dead) return;
      setWs('connecting');
      try {
        socket = new WebSocket(WS_URL);
        socket.onopen = () => setWs('live');
        socket.onclose = () => { setWs('offline'); if (!dead) timer = setTimeout(connect, 3000); };
        socket.onerror = () => socket.close();
        socket.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            const meta = EVENTS[msg.type];
            if (meta) {
              setEvents(prev => [{
                key: `${msg.type}-${Date.now()}`,
                icon: meta.icon, color: meta.color, label: meta.label(msg.data), ts: Date.now(),
              }, ...prev].slice(0, 80));
            }
            if (['task:created','task:completed','task:failed','task:updated'].includes(msg.type)) loadTasks();
          } catch {}
        };
      } catch {}
    };
    connect();
    return () => { dead = true; clearTimeout(timer); socket?.close(); };
  }, [loadTasks]);

  const counts = {
    total: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    done: tasks.filter(t => t.status === 'completed').length,
    pending: tasks.filter(t => t.status === 'pending').length,
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#060b16] text-white flex flex-col">

        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-white/5 bg-[#060b16]/95 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-2">
            <span className="font-bold text-white flex-shrink-0">AgentFinance</span>
            {user && <span className="text-blue-400/70 text-sm hidden sm:inline">/ {user.username}</span>}

            <nav className="hidden sm:flex items-center gap-1 ml-4">
              <span className="text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-600/30">Dashboard</span>
              <Link href="/analytics" className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Analytics</Link>
              <Link href="/wallet" className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Wallet</Link>
            </nav>

            <div className="flex-1" />

            <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border flex-shrink-0 ${
              ws === 'live' ? 'border-emerald-700/40 text-emerald-400 bg-emerald-900/20'
              : ws === 'connecting' ? 'border-yellow-700/40 text-yellow-400 bg-yellow-900/20'
              : 'border-red-700/40 text-red-400 bg-red-900/20'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${ws==='live'?'bg-emerald-400 animate-pulse':ws==='connecting'?'bg-yellow-400':'bg-red-400'}`} />
              {ws === 'live' ? 'Live' : ws === 'connecting' ? 'Connecting' : 'Offline'}
            </div>

            <div className="flex-shrink-0"><NewTaskModal /></div>

            <button onClick={() => { logout(); window.location.href='/login'; }}
              className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0 hidden sm:block ml-1">
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-5">

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Total Tasks', val: counts.total, color: 'text-white' },
              { label: 'Running',     val: counts.running, color: 'text-blue-400' },
              { label: 'Completed',   val: counts.done, color: 'text-emerald-400' },
              { label: 'Pending',     val: counts.pending, color: 'text-yellow-400' },
            ].map(s => (
              <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                <p className="text-gray-500 text-xs mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.val}</p>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Tasks */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
                <h2 className="text-sm font-semibold text-white">Tasks</h2>
                <button onClick={loadTasks} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">↻ Refresh</button>
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
                {loading && <div className="p-8 text-center text-gray-500 text-sm">Loading...</div>}
                {!loading && tasks.length === 0 && (
                  <div className="p-10 text-center">
                    <div className="text-4xl mb-3">🤖</div>
                    <p className="text-gray-400 text-sm">No tasks yet</p>
                    <p className="text-gray-600 text-xs mt-1">Click <strong className="text-gray-400">+ New Task</strong> to deploy your first agent</p>
                  </div>
                )}
                {tasks.map(task => {
                  const s = STATUS[task.status as keyof typeof STATUS] || STATUS.pending;
                  const isOpen = popup?.id === task.id;
                  return (
                    <button
                      key={task.id}
                      onClick={() => setPopup(isOpen ? null : task)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-white/[0.04] ${isOpen ? 'bg-white/[0.05]' : ''}`}
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white/90 text-sm truncate">{task.action}</p>
                        <p className="text-gray-600 text-xs">{new Date(task.createdAt).toLocaleString()}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-md border ${s.badge}`}>{s.label}</span>
                      <span className="text-gray-600 text-xs flex-shrink-0">{task.result ? '↗' : '···'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live feed */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
                <h2 className="text-sm font-semibold text-white">Live Agent Activity</h2>
                {events.length > 0 && (
                  <button onClick={() => setEvents([])} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Clear</button>
                )}
              </div>
              <div className="divide-y divide-white/[0.04] max-h-[400px] overflow-y-auto">
                {events.length === 0 ? (
                  <div className="p-10 text-center">
                    <div className="text-4xl mb-3">📡</div>
                    <p className="text-gray-400 text-sm">Waiting for activity</p>
                    <p className="text-gray-600 text-xs mt-1">Events stream here in real time</p>
                  </div>
                ) : events.map(ev => (
                  <div key={ev.key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <span className="text-base flex-shrink-0 w-5 text-center">{ev.icon}</span>
                    <p className={`flex-1 text-sm truncate ${ev.color}`}>{ev.label}</p>
                    <span className="text-gray-700 text-xs flex-shrink-0 font-mono">{new Date(ev.ts).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Mobile nav */}
          <div className="sm:hidden mt-4 grid grid-cols-3 gap-2">
            <Link href="/analytics" className="text-center text-xs py-2.5 bg-white/[0.04] border border-white/[0.07] rounded-xl text-gray-300">Analytics</Link>
            <Link href="/wallet" className="text-center text-xs py-2.5 bg-white/[0.04] border border-white/[0.07] rounded-xl text-gray-300">Wallet</Link>
            <button onClick={() => { logout(); window.location.href='/login'; }} className="text-xs py-2.5 bg-white/[0.04] border border-white/[0.07] rounded-xl text-gray-500">Sign out</button>
          </div>

        </main>

        {/* Footer */}
        <footer className="border-t border-white/[0.05] mt-auto">
          <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-gray-600 text-xs">© 2025 AgentFinance · Built by okwedavid</p>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <Link href="/analytics" className="hover:text-gray-400 transition-colors">Analytics</Link>
              <Link href="/wallet" className="hover:text-gray-400 transition-colors">Wallet</Link>
              <span>All rights reserved</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Popup */}
      {popup && <TaskPopup task={popup} onClose={() => setPopup(null)} />}
    </ErrorBoundary>
  );
}