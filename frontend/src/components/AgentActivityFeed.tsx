"use client";
import React, { useEffect, useRef, useState } from 'react';

type AgentEvent = {
  id: string;
  type: string;
  agentType?: string;
  tool?: string;
  result?: string;
  taskId?: string;
  timestamp: number;
};

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  'task:created':    { label: 'Task received',      color: 'text-blue-400' },
  'task:classified': { label: 'Agent assigned',     color: 'text-purple-400' },
  'task:updated':    { label: 'Status update',      color: 'text-gray-400' },
  'agent:started':   { label: 'Agent started',      color: 'text-cyan-400' },
  'agent:tool_call': { label: 'Tool called',         color: 'text-amber-400' },
  'agent:tool_result':{ label: 'Tool result',        color: 'text-amber-300' },
  'agent:completed': { label: 'Agent completed',    color: 'text-green-400' },
  'task:completed':  { label: 'Task done',           color: 'text-green-500' },
  'task:failed':     { label: 'Task failed',         color: 'text-red-400' },
  'agent:timeout':   { label: 'Agent timed out',    color: 'text-orange-400' },
};

const AGENT_ICONS: Record<string, string> = {
  research: '🔬',
  trading: '📈',
  content: '✍️',
  execution: '⚡',
  coordinator: '🧠',
};

export default function AgentActivityFeed({ events }: { events: any[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Parse and enrich events
  const agentEvents: AgentEvent[] = events
    .filter(e => e && typeof e === 'object')
    .map((e, i) => ({
      id: `${i}-${e.timestamp || Date.now()}`,
      type: e.type || 'unknown',
      agentType: e.data?.agentType || e.agentType,
      tool: e.data?.tool || e.tool,
      result: e.data?.result || e.result,
      taskId: e.data?.taskId || e.taskId,
      timestamp: e.data?.timestamp || e.timestamp || Date.now(),
    }))
    .slice(-60)
    .reverse();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (!agentEvents.length) {
    return (
      <div className="bg-gray-900 rounded-2xl p-6 shadow h-full flex flex-col items-center justify-center gap-3 min-h-64">
        <div className="text-4xl">🤖</div>
        <p className="text-gray-400 text-sm text-center">
          No agent activity yet.<br />Create a task to see your AI agents work in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-2xl p-4 shadow flex flex-col gap-1 max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between mb-2 sticky top-0 bg-gray-900 pb-2">
        <h2 className="text-sm font-semibold text-white">Live Agent Activity</h2>
        <span className="text-xs text-green-400 animate-pulse">● Live</span>
      </div>

      {agentEvents.map((ev) => {
        const meta = EVENT_LABELS[ev.type] || { label: ev.type, color: 'text-gray-400' };
        const icon = ev.agentType ? AGENT_ICONS[ev.agentType] || '🤖' : '📡';
        const isExpanded = expanded === ev.id;
        const hasResult = ev.result && ev.result.length > 0;

        return (
          <div
            key={ev.id}
            className={`rounded-lg px-3 py-2 text-xs transition-all cursor-pointer
              ${ev.type === 'task:completed' ? 'bg-green-900/30 border border-green-800/50' :
                ev.type === 'task:failed' ? 'bg-red-900/30 border border-red-800/50' :
                ev.type === 'agent:tool_call' ? 'bg-amber-900/20 border border-amber-800/30' :
                'bg-white/5 border border-white/5'}
            `}
            onClick={() => hasResult ? setExpanded(isExpanded ? null : ev.id) : null}
          >
            <div className="flex items-center gap-2">
              <span>{icon}</span>
              <span className={`font-medium ${meta.color}`}>{meta.label}</span>
              {ev.agentType && (
                <span className="text-gray-500 capitalize">{ev.agentType} agent</span>
              )}
              {ev.tool && (
                <span className="bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                  {ev.tool}
                </span>
              )}
              {hasResult && (
                <span className="ml-auto text-gray-600">{isExpanded ? '▲' : '▼'}</span>
              )}
            </div>

            {isExpanded && ev.result && (
              <pre className="mt-2 text-gray-300 whitespace-pre-wrap break-words text-xs bg-black/30 p-2 rounded max-h-40 overflow-y-auto">
                {typeof ev.result === 'string'
                  ? ev.result.slice(0, 800)
                  : JSON.stringify(ev.result, null, 2).slice(0, 800)}
              </pre>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}