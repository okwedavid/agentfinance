"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

function highlightOutput(result: any) {
  if (!result) return [];
  const lines = (typeof result === "string" ? result : JSON.stringify(result, null, 2)).split("\n");
  return lines.map((line, index) => {
    const tone =
      /reason|nextStep|recommendation|status|provider|mode|currentBalance|preparedTransaction/i.test(line)
        ? "text-cyan-100"
        : /error|failed/i.test(line)
          ? "text-rose-200"
          : /wallet|ETH|gas|amount|recipient|timestamp/i.test(line)
            ? "text-amber-100"
            : "text-slate-300";

    const decorated = line
      .replace(/"(status|reason|nextStep|provider|mode|walletAddress|preparedTransaction|currentBalance)"/g, "[$1]")
      .replace(/\b(ETH|gas|transfer|wallet|prepared|approval|broadcast)\b/gi, (match) => match.toUpperCase());

    return (
      <div key={`${index}-${line}`} className={`${tone} font-mono text-sm leading-7 tracking-[0.01em]`}>
        {decorated}
      </div>
    );
  });
}

function OutputModal({
  task,
  onClose,
}: {
  task: any;
  onClose: () => void;
}) {
  const parsed = tryParse(task?.result);
  const summary = typeof parsed === "object" && parsed ? parsed.summary || parsed.output || parsed.error : parsed;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,19,34,0.98),rgba(5,12,24,0.98))] shadow-[0_24px_120px_rgba(0,0,0,0.55)] animate-scale-in">
        <div className="border-b border-white/8 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Review output</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{task.action}</h3>
              <p className="mt-2 text-sm text-slate-400">
                {task.status} · {new Date(task.createdAt).toLocaleString()}
              </p>
            </div>
            <button onClick={onClose} className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[calc(85vh-140px)] overflow-auto px-6 py-6">
          {summary ? (
            <div className="space-y-4">
              <div className="rounded-[28px] border border-cyan-300/10 bg-cyan-400/[0.06] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-cyan-200/70">Response</div>
                <div className="mt-4 space-y-2">{highlightOutput(summary)}</div>
              </div>

              {typeof parsed === "object" && parsed && (
                <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Structured payload</div>
                  <pre className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">
                    {JSON.stringify(parsed, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5 text-slate-400">
              This task has no output yet.
            </div>
          )}
        </div>
      </div>
    </div>
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
  const parsed = tryParse(task.result);
  const hasOutput = parsed && (typeof parsed !== "object" || Object.keys(parsed).length > 0);

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 transition hover:border-white/15">
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
          <p className="mt-3 text-sm font-medium leading-6 text-white">{task.action}</p>
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
          Review output
        </button>
        <span className="text-xs text-slate-500">
          {hasOutput ? "Opens in a focused viewer." : "No response available yet."}
        </span>
      </div>
    </div>
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
      setMessage(`Archived ${result?.deleted ?? 0} task(s).`);
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

  const recentTasks = showAllRecent ? tasks.slice(0, 8) : tasks.slice(0, 3);

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={connectionStatus} />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <section className="mesh-panel glass-heavy rounded-[28px] p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Mission control</p>
              <h1 className="mt-2 text-3xl font-bold text-white">
                Welcome back, {user?.displayName || user?.username || "operator"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                The dashboard now surfaces runtime readiness, fleet capacity, wallet state, and live task health in one place instead of only showing task history.
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
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Est. earnings</div>
                <div className="mt-2 text-lg font-semibold text-white">{stats.earnings} ETH</div>
              </div>
            </div>
          </div>
        </section>

        {message && (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="glass rounded-[28px] p-5">
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
                  <div className="mt-3 text-sm leading-6 text-white">{template}</div>
                  <div className="mt-4 text-sm text-cyan-200">{creating === template ? "Launching..." : "Launch task"}</div>
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
          </section>

          <section className="space-y-5">
            <div className="glass rounded-[28px] p-5">
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
                  <div className="mt-2 text-base font-semibold text-white">
                    {runtime?.providerCount ?? 0} loaded
                  </div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Queue mode</div>
                  <div className="mt-2 text-base font-semibold text-white">{runtime?.queueEnabled ? "BullMQ" : "Inline fallback"}</div>
                </div>
              </div>
            </div>

            <div className="glass rounded-[28px] p-5">
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
                    No tasks yet. Launch a playbook to see live fleet activity.
                  </div>
                ) : (
                  recentTasks.map((task) => (
                    <TaskCard key={task.id} task={task} onDelete={removeTaskFromHistory} onReview={setSelectedTask} />
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      <PageFooter />
      <BottomNav />
      {selectedTask && <OutputModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}
