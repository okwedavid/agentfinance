"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getTasks, getMe, isLoggedIn, logout } from "@/lib/api";
import { NewTaskModal } from "@/components/NewTaskModal";
import ErrorBoundary from "@/components/ErrorBoundary";
import Link from "next/link";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://serene-magic-production-6d0c.up.railway.app';

type Task = { id: string; action: string; status: string; createdAt: string; result?: string };

const STATUS = {
  pending:   { dot: 'bg-yellow-400', pill: 'bg-yellow-500/10 text-yellow-400 border-yellow-700/30', label: 'Pending' },
  running:   { dot: 'bg-blue-400 animate-pulse', pill: 'bg-blue-500/10 text-blue-400 border-blue-700/30', label: 'Running' },
  completed: { dot: 'bg-emerald-400', pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-700/30', label: 'Done' },
  failed:    { dot: 'bg-red-400', pill: 'bg-red-500/10 text-red-400 border-red-700/30', label: 'Failed' },
} as const;

const EV: Record<string, {icon:string; color:string; label:(d:any)=>string}> = {
  'task:created':    { icon:'📨', color:'text-blue-400',   label:()=>'Task queued' },
  'task:classified': { icon:'🧠', color:'text-purple-400', label:d=>`${d?.agentLabel||'Agent'} assigned` },
  'agent:started':   { icon:'🚀', color:'text-cyan-400',   label:d=>`${d?.agentType||''} agent started` },
  'agent:tool_call': { icon:'🔧', color:'text-amber-400',  label:d=>`Calling ${d?.tool||'tool'}` },
  'agent:tool_result':{ icon:'✅', color:'text-amber-300', label:d=>`${d?.tool||'Tool'} returned` },
  'agent:completed': { icon:'🎯', color:'text-emerald-400',label:()=>'Agent completed' },
  'task:completed':  { icon:'💰', color:'text-emerald-500',label:()=>'Task done!' },
  'task:failed':     { icon:'❌', color:'text-red-400',    label:()=>'Task failed' },
  'task:updated':    { icon:'🔄', color:'text-gray-400',   label:d=>`Status: ${d?.status||'updated'}` },
};

function parseOutput(raw?: string): string {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    if (p.error) return `❌ ${p.error}`;
    if (p.output) return p.output;
    return JSON.stringify(p, null, 2);
  } catch { return raw; }
}

// Floating popup for task output
function TaskPopup({ task, anchor, onClose }: { task: Task; anchor: DOMRect; onClose: () => void }) {
  const output = parseOutput(task.result);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Position: try right of anchor, fall back to below
  const top = Math.min(anchor.top + window.scrollY, window.innerHeight - 400 + window.scrollY);

  return (
    <div
      ref={ref}
      className="fixed z-50 w-80 sm:w-96 bg-[#0d1829] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      style={{ top: Math.max(8, top), left: Math.min(anchor.right + 8, window.innerWidth - 400) }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 bg-black/20">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS[task.status as keyof typeof STATUS]?.dot || 'bg-gray-400'}`} />
          <p className="text-white text-xs font-medium truncate">{task.action}</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-2 flex-shrink-0 text-lg leading-none">×</button>
      </div>

      {/* Body */}
      <div className="p-4 max-h-80 overflow-y-auto">
        {task.status === 'running' && (
          <div className="flex items-center gap-3 text-blue-400">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm">Agent is working...</p>
          </div>
        )}
        {task.status === 'pending' && (
          <p className="text-yellow-400 text-sm">⏳ Waiting in queue...</p>
        )}
        {(task.status === 'completed' || task.status === 'failed') && output && (
          <pre className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed font-sans break-words">{output}</pre>
        )}
        {(task.status === 'completed' || task.status === 'failed') && !output && (
          <p className="text-gray-500 text-sm italic">No output recorded.</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
        <span className="text-gray-600 text-xs">{new Date(task.createdAt).toLocaleString()}</span>
        <Link href="/analytics" className="text-blue-400 text-xs hover:text-blue-300">View in Analytics →</Link>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [wsState, setWsState] = useState<'connecting'|'live'|'offline'>('connecting');
  const [popup, setPopup] = useState<{ task: Task; anchor: DOMRect } | null>(null);
  const [loading, setLoading] = useState(true);

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
        // Update popup task if open
        setPopup(prev => prev ? { ...prev, task: data.find((t:Task) => t.id === prev.task.id) || prev.task } : null);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => {
    const h = () => loadTasks();
    window.addEventListener('task:created', h);
    return () => window.removeEventListener('task:created', h);
  }, [loadTasks]);

  // Poll when tasks are running
  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === 'running' || t.status === 'pending');
    if (!hasRunning) return;
    const t = setInterval(loadTasks, 5000);
    return () => clearInterval(t);
  }, [tasks, loadTasks]);

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
            const meta = EV[msg.type];
            if (meta) {
              setEvents(prev => [{
                key: `${msg.type}-${Date.now()}`,
                icon: meta.icon, color: meta.color, label: meta.label(msg.data), ts: Date.now(),
              }, ...prev].slice(0, 60));
            }
            if (['task:created','task:completed','task:failed','task:updated'].includes(msg.type)) loadTasks();
          } catch {}
        };
      } catch {}
    };
    connect();
    return () => { dead = true; clearTimeout(timer); ws?.close(); };
  }, [loadTasks]);

  const openPopup = (task: Task, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopup(popup?.task.id === task.id ? null : { task, anchor: rect });
  };

  const counts = {
    total: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    done: tasks.filter(t => t.status === 'completed').length,
    pending: tasks.filter(t => t.status === 'pending').length,
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#060b16] text-white">

        {/* Header */}
        <header className="sticky top-0 z-30 bg-[#060b16]/95 backdrop-blur border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-2 sm:gap-3">
            <span className="font-bold text-base flex-shrink-0">AgentFinance</span>
            {user && <span className="text-blue-400 text-sm hidden sm:inline">/ {user.username}</span>}

            <nav className="hidden sm:flex items-center gap-1 ml-4">
              <span className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white">Dashboard</span>
              <Link href="/analytics" className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Analytics</Link>
              <Link href="/wallet" className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Wallet</Link>
            </nav>

            <div className="flex-1" />

            {/* WS indicator */}
            <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border flex-shrink-0 ${
              wsState==='live' ? 'bg-emerald-900/30 border-emerald-800/40 text-emerald-400'
              : wsState==='connecting' ? 'bg-yellow-900/30 border-yellow-800/40 text-yellow-400'
              : 'bg-red-900/30 border-red-800/40 text-red-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsState==='live'?'bg-emerald-400 animate-pulse':wsState==='connecting'?'bg-yellow-400':'bg-red-400'}`} />
              {wsState==='live'?'Live':wsState==='connecting'?'…':'Offline'}
            </div>

            {/* New task — flex-shrink-0 prevents mobile overflow */}
            <div className="flex-shrink-0"><NewTaskModal /></div>

            <button
              onClick={() => { logout(); window.location.href='/login'; }}
              className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0 hidden sm:block"
            >Sign out</button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-5">

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label:'Total tasks', val: counts.total, color:'text-white' },
              { label:'Running', val: counts.running, color:'text-blue-400' },
              { label:'Completed', val: counts.done, color:'text-emerald-400' },
              { label:'Pending', val: counts.pending, color:'text-yellow-400' },
            ].map(s => (
              <div key={s.label} className="bg-white/3 border border-white/7 rounded-xl px-4 py-3">
                <p className="text-gray-500 text-xs mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.val}</p>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Tasks panel */}
            <div className="bg-white/3 border border-white/7 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                <h2 className="text-sm font-semibold">Tasks</h2>
                <button onClick={loadTasks} className="text-xs text-blue-400 hover:text-blue-300">↻ Refresh</button>
              </div>

              <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                {loading && <div className="p-6 text-center text-gray-500 text-sm">Loading...</div>}
                {!loading && tasks.length === 0 && (
                  <div className="p-10 text-center">
                    <div className="text-3xl mb-2">🤖</div>
                    <p className="text-gray-400 text-sm">No tasks yet</p>
                    <p className="text-gray-600 text-xs mt-1">Click <strong className="text-gray-300">+ New Task</strong> to deploy your first agent</p>
                  </div>
                )}
                {tasks.map(task => {
                  const s = STATUS[task.status as keyof typeof STATUS] || STATUS.pending;
                  const isOpen = popup?.task.id === task.id;
                  return (
                    <button
                      key={task.id}
                      onClick={e => openPopup(task, e)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 ${isOpen ? 'bg-white/6' : ''}`}
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{task.action}</p>
                        <p className="text-gray-600 text-xs">{new Date(task.createdAt).toLocaleString()}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-md border ${s.pill}`}>{s.label}</span>
                      <span className="text-gray-600 text-xs flex-shrink-0">{task.result ? '↗' : '···'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live feed */}
            <div className="bg-white/3 border border-white/7 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                <h2 className="text-sm font-semibold">Live Agent Activity</h2>
                {events.length > 0 && (
                  <button onClick={() => setEvents([])} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
                )}
              </div>
              <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                {events.length === 0 ? (
                  <div className="p-10 text-center">
                    <div className="text-3xl mb-2">📡</div>
                    <p className="text-gray-400 text-sm">Waiting for activity</p>
                    <p className="text-gray-600 text-xs mt-1">Events appear here when agents run</p>
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

          {/* Mobile bottom nav */}
          <div className="sm:hidden mt-4 grid grid-cols-3 gap-2">
            <Link href="/analytics" className="text-center text-xs py-2.5 bg-white/5 border border-white/8 rounded-xl text-gray-300">Analytics</Link>
            <Link href="/wallet" className="text-center text-xs py-2.5 bg-white/5 border border-white/8 rounded-xl text-gray-300">Wallet</Link>
            <button onClick={() => { logout(); window.location.href='/login'; }} className="text-xs py-2.5 bg-white/5 border border-white/8 rounded-xl text-gray-500">Sign out</button>
          </div>

        </main>

        {/* Floating popup */}
        {popup && (
          <TaskPopup
            task={popup.task}
            anchor={popup.anchor}
            onClose={() => setPopup(null)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}