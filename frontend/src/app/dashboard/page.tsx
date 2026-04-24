"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  createTask,
  deleteAllTasks,
  deleteTask,
  getRuntimeStatus,
  getTasks,
  isLoggedIn,
} from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";

const TEMPLATES = [
  "Research today's best DeFi yield opportunities with risks and expected returns.",
  "Check ETH arbitrage opportunities and summarize realistic execution paths.",
  "Write a concise market review thread for today's crypto setup.",
  "Prepare the safest next execution steps for routing agent earnings to my wallet.",
];

function tryParse(value: any) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sanitizePlainText(value: unknown) {
  return String(value || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[_*`#>|[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSummary(task: any) {
  const parsed = tryParse(task?.result);
  const raw = parsed?.summary || parsed?.output || parsed?.error || parsed || "";
  return sanitizePlainText(raw)
    .replace(/\. /g, ".\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function OutputModal({
  task,
  onClose,
}: {
  task: any;
  onClose: () => void;
}) {
  const lines = extractSummary(task);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div className="absolute inset-0 bg-slate-950/82 backdrop-blur-xl" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.24 }}
          className="relative max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,19,34,0.98),rgba(5,12,24,0.98))] shadow-[0_24px_120px_rgba(0,0,0,0.58)]"
        >
          <div className="border-b border-white/8 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Task summary</p>
                <h3 className="mt-2 text-2xl font-semibold leading-tight text-white">{task.action}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  {task.status} at {new Date(task.createdAt).toLocaleString()}
                </p>
              </div>
              <button onClick={onClose} className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">
                Close
              </button>
            </div>
          </div>

          <div className="max-h-[calc(88vh-140px)] overflow-auto px-6 py-6">
            {lines.length > 0 ? (
              <div className="rounded-[28px] border border-cyan-300/10 bg-cyan-400/[0.06] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">Readable response</div>
                <div className="mt-4 space-y-3">
                  {lines.map((line, index) => (
                    <motion.p
                      key={`${task.id}-${index}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.04 * index, duration: 0.2 }}
                      className="text-[15px] leading-8 text-slate-100"
                    >
                      {line}
                    </motion.p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5 text-slate-400">
                This task has no readable output yet.
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function TaskCard({
  task,
  onDelete,
  onReview,
}: {
  task: any;
  onDelete: (id: string) => Promise<void>;
  onReview: (task: any) => void;
}) {
  const hasOutput = extractSummary(task).length > 0;

  return (
    <motion.div
      layout
      className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 transition hover:border-white/15"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${
              task.status === "completed"
                ? "bg-emerald-300"
                : task.status === "failed"
                  ? "bg-rose-300"
                  : task.status === "running"
                    ? "bg-cyan-300 animate-pulse"
                    : "bg-amber-300"
            }`} />
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{task.status}</span>
          </div>
          <p className="mt-3 text-sm font-medium leading-7 text-white">{task.action}</p>
          <p className="mt-2 text-xs text-slate-500">{new Date(task.createdAt).toLocaleString()}</p>
        </div>

        <button onClick={() => onDelete(task.id)} className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/5 hover:text-white">
          Delete
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => onReview(task)}
          disabled={!hasOutput}
          className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Show summary
        </button>
        <span className="text-xs text-slate-500">
          {hasOutput ? "Opens in a focused reader." : "No response available yet."}
        </span>
      </div>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [runtime, setRuntime] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);

  const onEvent = useCallback((event: any) => {
    if (event?.type?.startsWith("task:")) {
      void getTasks().then(setTasks).catch(() => {});
    }
  }, []);

  const { connectionStatus } = useWebSocket({ onEvent });

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    void getTasks().then(setTasks).catch(() => setTasks([]));
    void getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null));
  }, []);

  async function launchTask(action: string) {
    if (!action.trim()) return;
    setCreating(action);
    try {
      const task = await createTask(action);
      setTasks((current) => [task, ...current]);
      setDraft("");
      setMessage("Task deployed.");
    } catch (error: any) {
      setMessage(error.message || "Could not create task.");
    } finally {
      setCreating(null);
    }
  }

  async function removeTaskFromHistory(id: string) {
    try {
      await deleteTask(id);
      setTasks((current) => current.filter((task) => task.id !== id));
      setMessage("Task archived.");
    } catch (error: any) {
      setMessage(error.message || "Could not delete task.");
    }
  }

  async function clearHistory() {
    if (!confirm("Archive all task history for this user?")) return;
    try {
      const result = await deleteAllTasks();
      setTasks([]);
      setMessage(`Archived ${result?.deleted ?? 0} task records.`);
    } catch (error: any) {
      setMessage(error.message || "Could not clear history.");
    }
  }

  const stats = useMemo(() => {
    const completed = tasks.filter((task) => task.status === "completed").length;
    const running = tasks.filter((task) => task.status === "running").length;
    const failed = tasks.filter((task) => task.status === "failed").length;
    return {
      total: tasks.length,
      completed,
      running,
      failed,
      earnings: (completed * 0.0035).toFixed(4),
    };
  }, [tasks]);

  const recentTasks = showAllRecent ? tasks.slice(0, 10) : tasks.slice(0, 3);

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={connectionStatus} />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mesh-panel glass-heavy rounded-[28px] p-6"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Mission control</p>
              <h1 className="mt-2 text-3xl font-bold text-white">
                Welcome back, {user?.displayName || user?.username || "operator"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
                This dashboard keeps fleet readiness, wallet state, and the latest task summaries in one responsive control surface.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Tasks</div>
                <div className="mt-2 text-lg font-semibold text-white">{stats.total}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Running</div>
                <div className="mt-2 text-lg font-semibold text-white">{stats.running}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Fleet</div>
                <div className="mt-2 text-lg font-semibold text-white">{runtime?.fleet?.length || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Estimated earnings</div>
                <div className="mt-2 text-lg font-semibold text-white">{stats.earnings} ETH</div>
              </div>
            </div>
          </div>
        </motion.section>

        {message && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100"
          >
            {message}
          </motion.div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35 }}
            className="glass rounded-[28px] p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Quick deploy</h2>
              <Link href="/agents" className="text-sm text-cyan-200 transition hover:text-white">
                Open fleet
              </Link>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {TEMPLATES.map((template, index) => (
                <button
                  key={template}
                  onClick={() => launchTask(template)}
                  disabled={creating === template}
                  className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/20"
                >
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Playbook {index + 1}</div>
                  <div className="mt-3 text-sm leading-7 text-white">{template}</div>
                  <div className="mt-4 text-sm text-cyan-200">{creating === template ? "Launching task" : "Launch task"}</div>
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm font-semibold text-white">Custom dispatch</div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Describe the exact task you want the agent fleet to run."
                rows={4}
                className="input-field mt-3 resize-none"
              />
              <button onClick={() => launchTask(draft)} className="mt-3 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                Deploy custom task
              </button>
            </div>
          </motion.section>

          <div className="space-y-5">
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35 }}
              className="glass rounded-[28px] p-5"
            >
              <h2 className="text-lg font-semibold text-white">Runtime readiness</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Socket</div>
                  <div className="mt-2 text-base font-semibold text-white">{connectionStatus}</div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Wallet</div>
                  <div className="mt-2 text-base font-semibold text-white">{runtime?.walletAddress ? "Connected" : "Not connected"}</div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">AI providers</div>
                  <div className="mt-2 text-base font-semibold text-white">{runtime?.providerCount ?? 0} loaded</div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Payout signer</div>
                  <div className="mt-2 text-base font-semibold text-white">{runtime?.payoutRuntime?.treasury?.evmReady ? "Ready" : "Needs setup"}</div>
                </div>
              </div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.35 }}
              className="glass rounded-[28px] p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Review lane</h2>
                <div className="flex items-center gap-3">
                  {tasks.length > 3 && (
                    <button onClick={() => setShowAllRecent((value) => !value)} className="text-sm text-cyan-200 transition hover:text-white">
                      {showAllRecent ? "Show fewer" : "View more"}
                    </button>
                  )}
                  <button onClick={clearHistory} className="text-sm text-slate-300 transition hover:text-white">
                    Clear history
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {recentTasks.length === 0 ? (
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5 text-sm text-slate-400">
                    No tasks yet. Launch a playbook to start the fleet.
                  </div>
                ) : (
                  recentTasks.map((task) => (
                    <TaskCard key={task.id} task={task} onDelete={removeTaskFromHistory} onReview={setSelectedTask} />
                  ))
                )}
              </div>
            </motion.section>
          </div>
        </div>
      </main>

      <PageFooter />
      <BottomNav />
      {selectedTask && <OutputModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
