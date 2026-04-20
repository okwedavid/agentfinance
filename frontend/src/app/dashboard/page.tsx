"use client";
import { useEffect, useState, useCallback } from "react";
import { getTasks, getMe, isLoggedIn } from "@/lib/api";
import { NewTaskModal } from "@/components/NewTaskModal";
import ErrorBoundary from "@/components/ErrorBoundary";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');
const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || 'wss://serene-magic-production-6d0c.up.railway.app');

type Task = { id: string; action: string; status: string; createdAt: string; result?: string };

const STATUS_STYLE: Record<string, string> = {
  pending:   'bg-yellow-500/20 text-yellow-400 border-yellow-700/40',
  running:   'bg-blue-500/20 text-blue-400 border-blue-700/40 animate-pulse',
  completed: 'bg-green-500/20 text-green-400 border-green-700/40',
  failed:    'bg-red-500/20 text-red-400 border-red-700/40',
};

type LiveEvent = {
  key: string;
  icon: string;
  label: string;
  detail?: string;
  ts: number;
  color: string;
};

function parseEvent(raw: any): LiveEvent | null {
  if (!raw?.type) return null;
  const ts = raw.data?.timestamp || Date.now();
  const taskId = (raw.data?.taskId || raw.data?.id || '').slice(0, 8);
  const map: Record<string, Omit<LiveEvent, 'key' | 'ts'>> = {
    'task:created':    { icon: '📨', label: 'Task received', detail: taskId, color: 'text-blue-400' },
    'task:classified': { icon: '🧠', label: `Assigned to ${raw.data?.agentLabel || 'agent'}`, detail: taskId, color: 'text-purple-400' },
    'agent:started':   { icon: '🚀', label: 'Agent started', detail: raw.data?.agentType, color: 'text-cyan-400' },
    'agent:tool_call': { icon: '🔧', label: `Calling ${raw.data?.tool || 'tool'}`, detail: taskId, color: 'text-amber-400' },
    'agent:tool_result':{ icon: '✅', label: `Tool returned`, detail: raw.data?.tool, color: 'text-amber-300' },
    'agent:completed': { icon: '🎯', label: 'Agent completed', detail: taskId, color: 'text-green-400' },
    'task:completed':  { icon: '💰', label: 'Task done!', detail: taskId, color: 'text-green-500' },
    'task:failed':     { icon: '❌', label: 'Task failed', detail: taskId, color: 'text-red-400' },
    'task:updated':    { icon: '🔄', label: `Status: ${raw.data?.status}`, detail: taskId, color: 'text-gray-400' },
  };
  const m = map[raw.type];
  if (!m) return null;
  return { key: `${raw.type}-${ts}-${Math.random()}`, ts, ...m };
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<any>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);

  // Guard: redirect if not logged in
  useEffect(() => {
    if (!isLoggedIn()) { window.location.href = '/login'; }
  }, []);

  // Load user
  useEffect(() => {
    getMe().then(setUser).catch(() => { window.location.href = '/login'; });
  }, []);

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      setTasksLoading(true);
      const data = await getTasks();
      if (Array.isArray(data)) setTasks(data);
    } catch (e) {
      console.error('Failed to load tasks:', e);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Listen for task created event from NewTaskModal
  useEffect(() => {
    const handler = () => loadTasks();
    window.addEventListener('task:created', handler);
    return () => window.removeEventListener('task:created', handler);
  }, [loadTasks]);

  // WebSocket for live events
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let dead = false;

    const connect = () => {
      if (dead) return;
      setWsStatus('connecting');
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => setWsStatus('connected');
        ws.onclose = () => {
          setWsStatus('disconnected');
          if (!dead) retryTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (e) => {
          try {
            const raw = JSON.parse(e.data);
            const ev = parseEvent(raw);
            if (ev) setEvents(prev => [ev, ...prev].slice(0, 50));
            // Reload tasks on status-changing events
            if (['task:created','task:completed','task:failed','task:updated'].includes(raw.type)) {
              loadTasks();
            }
          } catch {}
        };
      } catch {}
    };

    connect();
    return () => { dead = true; clearTimeout(retryTimer); ws?.close(); };
  }, [loadTasks]);

  const running  = tasks.filter(t => t.status === 'running').length;
  const done     = tasks.filter(t => t.status === 'completed').length;
  const pending  = tasks.filter(t => t.status === 'pending').length;
  const failed   = tasks.filter(t => t.status === 'failed').length;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        {/* Top bar */}
        <div className="border-b border-white/5 bg-black/20 px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-white">
              AgentFinance
              {user && <span className="text-blue-400 text-base font-normal ml-2">/ {user.username}</span>}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
              wsStatus === 'connected'
                ? 'bg-green-900/30 border-green-800/50 text-green-400'
                : wsStatus === 'connecting'
                ? 'bg-yellow-900/30 border-yellow-800/50 text-yellow-400'
                : 'bg-red-900/30 border-red-800/50 text-red-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-green-400 animate-pulse' : wsStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'}`} />
              {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Offline'}
            </div>
            <a href="/analytics" className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5">
              Analytics →
            </a>
            <button
              onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Sign out
            </button>
            <NewTaskModal />
          </div>
        </div>

        <div className="p-6 max-w-7xl mx-auto">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Tasks', value: tasks.length, color: 'text-white' },
              { label: 'Running', value: running, color: 'text-blue-400' },
              { label: 'Completed', value: done, color: 'text-green-400' },
              { label: 'Pending', value: pending, color: 'text-yellow-400' },
            ].map(s => (
              <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Task list */}
            <div className="bg-white/5 border border-white/10 rounded-2xl">
              <div className="flex justify-between items-center px-5 pt-5 pb-3 border-b border-white/5">
                <h2 className="text-white font-semibold">Your Tasks</h2>
                <button onClick={loadTasks} className="text-xs text-blue-400 hover:text-blue-300">↻ Refresh</button>
              </div>

              <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
                {tasksLoading && (
                  <div className="p-5 text-center text-gray-500 text-sm">Loading...</div>
                )}
                {!tasksLoading && tasks.length === 0 && (
                  <div className="p-8 text-center">
                    <p className="text-4xl mb-3">🤖</p>
                    <p className="text-gray-400 text-sm">No tasks yet.</p>
                    <p className="text-gray-500 text-xs mt-1">Click <strong className="text-gray-400">+ New Task</strong> to deploy your first agent.</p>
                  </div>
                )}
                {tasks.map(task => (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                    className="flex items-start gap-3 px-5 py-3 hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-white text-sm truncate">{task.action}</p>
                      <p className="text-gray-600 text-xs mt-0.5">{new Date(task.createdAt).toLocaleString()}</p>
                    </div>
                    <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-md border capitalize ${STATUS_STYLE[task.status] || 'bg-gray-700 text-gray-300 border-gray-600'}`}>
                      {task.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Result panel */}
              {selectedTask?.result && (
                <div className="p-4 border-t border-white/5">
                  <p className="text-xs text-blue-300 font-medium mb-2">Agent Output — {selectedTask.action}</p>
                  <div className="bg-black/40 rounded-xl p-3 max-h-52 overflow-y-auto">
                    <p className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed">
                      {(() => {
                        try {
                          const p = JSON.parse(selectedTask.result!);
                          return p.output || JSON.stringify(p, null, 2);
                        } catch {
                          return selectedTask.result;
                        }
                      })()}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Live event feed */}
            <div className="bg-white/5 border border-white/10 rounded-2xl">
              <div className="flex justify-between items-center px-5 pt-5 pb-3 border-b border-white/5">
                <h2 className="text-white font-semibold">Live Agent Activity</h2>
                {events.length > 0 && (
                  <button onClick={() => setEvents([])} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
                )}
              </div>

              <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
                {events.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-4xl mb-3">📡</p>
                    <p className="text-gray-400 text-sm">Waiting for agent activity...</p>
                    <p className="text-gray-500 text-xs mt-1">Events appear here in real time when agents are running.</p>
                  </div>
                ) : events.map(ev => (
                  <div key={ev.key} className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/5 transition-colors">
                    <span className="text-lg flex-shrink-0">{ev.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium ${ev.color}`}>{ev.label}</span>
                      {ev.detail && (
                        <span className="text-gray-500 text-xs ml-2 font-mono">{ev.detail}</span>
                      )}
                    </div>
                    <span className="text-gray-600 text-xs flex-shrink-0">
                      {new Date(ev.ts).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}