"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ErrorBoundary from "@/components/ErrorBoundary";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { NewTaskModal } from "@/components/NewTaskModal";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://serene-magic-production-6d0c.up.railway.app';

type Task = {
  id: string;
  action: string;
  status: string;
  createdAt: string;
  result?: string;
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-600',
  running: 'bg-blue-600 animate-pulse',
  completed: 'bg-green-600',
  failed: 'bg-red-600',
};

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Load user
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = '/login'; return; }
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setUser).catch(() => {
      window.location.href = '/login';
    });
  }, []);

  // Load tasks
  const loadTasks = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) setTasks(data);
    } catch (e) {
      console.error('Failed to load tasks:', e);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // WebSocket — live events
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let dead = false;

    const connect = () => {
      if (dead) return;
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          if (!dead) retryTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            setEvents(prev => [...prev.slice(-200), msg]);

            // Update task list on relevant events
            if (['task:created', 'task:updated', 'task:completed', 'task:failed'].includes(msg.type)) {
              loadTasks();
            }
          } catch {}
        };
      } catch {}
    };

    connect();
    return () => {
      dead = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [loadTasks]);

  const runningCount = tasks.filter(t => t.status === 'running').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6">

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">
              AgentFinance
              {user && <span className="text-blue-300 text-xl font-normal ml-3">/ {user.username}</span>}
            </h1>
            <p className="text-blue-300 text-sm mt-1">Your AI agents are working to generate income</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${connected ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              {connected ? 'Live' : 'Reconnecting'}
            </div>
            <NewTaskModal />
          </div>
        </div>

        {/* Wallet banner if not connected */}
        {user && !user.walletAddress && (
          <div className="mb-6 bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 flex items-center gap-4">
            <span className="text-2xl">💳</span>
            <div>
              <p className="text-amber-300 font-medium text-sm">Connect your wallet to receive earnings</p>
              <p className="text-amber-400/70 text-xs">Your AI agents will sweep profits directly to your wallet</p>
            </div>
            <button
              onClick={() => window.scrollTo(0, 0)}
              className="ml-auto text-xs bg-amber-600 hover:bg-amber-500 px-3 py-1.5 rounded text-white"
            >
              Connect Wallet →
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Tasks', value: tasks.length, color: 'text-white' },
            { label: 'Running Now', value: runningCount, color: 'text-blue-400' },
            { label: 'Completed', value: completedCount, color: 'text-green-400' },
            { label: 'Failed', value: failedCount, color: 'text-red-400' },
          ].map(s => (
            <Card key={s.label} className="bg-white/5 backdrop-blur border-white/10 text-white">
              <CardHeader className="pb-1 pt-4 px-4">
                <p className="text-xs text-blue-300">{s.label}</p>
                <CardTitle className={`text-3xl font-bold ${s.color}`}>{s.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Task list */}
          <div className="bg-white/5 backdrop-blur rounded-2xl p-4 border border-white/10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-white font-semibold">Tasks</h2>
              <button onClick={loadTasks} className="text-xs text-blue-400 hover:text-blue-300">↻ Refresh</button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {tasks.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No tasks yet — click "New Task" to deploy your first agent
                </div>
              )}
              {tasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                  className="flex items-start gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer transition-all"
                >
                  <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLOR[task.status] || 'bg-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm truncate">{task.action}</p>
                    <p className="text-gray-500 text-xs">{new Date(task.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="text-xs text-gray-400 capitalize flex-shrink-0">{task.status}</span>
                </div>
              ))}
            </div>

            {/* Task result panel */}
            {selectedTask?.result && (
              <div className="mt-4 p-3 bg-black/40 rounded-lg border border-white/10">
                <p className="text-xs text-blue-300 mb-2 font-medium">Agent Output</p>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {(() => {
                    try {
                      const parsed = JSON.parse(selectedTask.result!);
                      return parsed.output || JSON.stringify(parsed, null, 2);
                    } catch {
                      return selectedTask.result;
                    }
                  })()}
                </pre>
              </div>
            )}
          </div>

          {/* Live activity feed */}
          <AgentActivityFeed events={events} />
        </div>

      </div>
    </ErrorBoundary>
  );
}