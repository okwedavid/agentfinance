"use client";
import React from 'react';

/**
 * Human-facing task stage labels so users never see raw internal statuses.
 * Maps every backend status string to a friendly label + tone.
 */
const STAGES: Record<string, { label: string; tone: string; pulsing?: boolean }> = {
  pending: { label: 'Preparing', tone: 'bg-yellow-500/15 text-yellow-300 border-yellow-400/25', pulsing: true },
  queued: { label: 'Preparing', tone: 'bg-yellow-500/15 text-yellow-300 border-yellow-400/25', pulsing: true },
  running: { label: 'Running', tone: 'bg-blue-500/15 text-blue-300 border-blue-400/25', pulsing: true },
  retrying: { label: 'Retrying', tone: 'bg-orange-500/15 text-orange-300 border-orange-400/25', pulsing: true },
  completed: { label: 'Completed', tone: 'bg-green-500/15 text-green-300 border-green-400/25' },
  failed: { label: 'Failed', tone: 'bg-red-500/15 text-red-300 border-red-400/25' },
  timed_out: { label: 'Timed out', tone: 'bg-amber-500/15 text-amber-300 border-amber-400/25' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-500/15 text-slate-300 border-slate-400/25' },
};

const isActive = (status: string) => ['pending', 'queued', 'running', 'retrying'].includes(status);

export default function TaskStatusBadge({ status, showSpinner = true }: { status: string; showSpinner?: boolean }) {
  const normalized = String(status || 'queued').toLowerCase();
  const stage = STAGES[normalized] || { label: normalized || 'Preparing', tone: 'bg-white/10 text-gray-300 border-white/15' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${stage.tone}`}>
      {stage.pulsing && showSpinner && (
        <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
      )}
      {stage.label}
    </span>
  );
}

/** Brief terminal reason shown to the user (parsed from stored result). */
export function taskTerminalReason(result: string | null | undefined): string | null {
  if (!result) return null;
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const direct = parsed?.error || parsed?.message;
    if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 500);
  } catch {
    const raw = String(result || '');
    if (raw.trim().startsWith('{"error"')) return null;
  }
  return null;
}

export function isActiveTask(status: string) {
  return isActive(status);
}