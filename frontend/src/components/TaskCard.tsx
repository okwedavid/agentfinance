"use client";
import React from 'react';
import TaskStatusBadge, { taskTerminalReason, isActiveTask } from './TaskStatusBadge';

function snippet(result: string | null | undefined, status: string): string {
  if (!result) return '';
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    if (status === 'completed') {
      const text = parsed?.summary || parsed?.output || parsed?.markdown || '';
      return String(text).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ').slice(0, 180);
    }
  } catch {
    return String(result).trim().slice(0, 180);
  }
  return '';
}

export default function TaskCard({ task, onOpen, onRetry }: { task: any; onOpen: (id: string) => void; onRetry?: (id: string) => void }) {
  const canRetry = ['failed', 'timed_out', 'cancelled'].includes(String(task?.status || '').toLowerCase());
  const reason = isActiveTask(task?.status) ? null : taskTerminalReason(task?.result);
  const summary = snippet(task?.result, task?.status);

  return (
    <div className="bg-gray-800 p-4 rounded-xl shadow">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-200 line-clamp-2">{task.action}</div>
          <div className="text-xs text-gray-500 mt-1">{new Date(task.createdAt).toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TaskStatusBadge status={task.status} />
          <button onClick={() => onOpen(task.id)} className="px-2 py-1 bg-indigo-600 rounded text-sm hover:bg-indigo-500">Open</button>
        </div>
      </div>
      {summary && <p className="mt-3 text-sm text-gray-400 line-clamp-2">{summary}</p>}
      {reason && <p className="mt-2 text-xs text-red-400/90 line-clamp-2">Reason: {reason}</p>}
      {canRetry && onRetry && (
        <button
          onClick={(e) => { e.stopPropagation(); onRetry(task.id); }}
          className="mt-3 px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-400/25 text-amber-200 text-xs font-medium hover:bg-amber-600/30 transition-colors"
        >
          Retry safely
        </button>
      )}
    </div>
  );
}