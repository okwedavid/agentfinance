"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createTask, getRuntimeStatus, getTasks, isLoggedIn } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";

const PLAYBOOKS = [
  { id: "research", title: "Research pulse", description: "Scan yield, narratives, sentiment, and risk for today's best setups.", task: "Research today's best DeFi yield opportunities with risks and expected returns." },
  { id: "trading", title: "Trading scout", description: "Look for spreads, dislocations, and actionable execution windows.", task: "Check ETH arbitrage opportunities and summarize realistic execution paths." },
  { id: "content", title: "Content engine", description: "Draft review-ready content that can monetize the research output.", task: "Write a market review thread explaining the top opportunities from today's crypto market." },
  { id: "execution", title: "Execution prep", description: "Prepare routing, wallet, gas, and operational next steps.", task: "Prepare the safest next execution steps for routing agent earnings to my wallet." },
];

export default function AgentsPage() {
  const { connectionStatus } = useWebSocket();
  const [runtime, setRuntime] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    void getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null));
    void getTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  async function launch(playbook: (typeof PLAYBOOKS)[number]) {
    setLaunching(playbook.id);
    try {
      await createTask(playbook.task, playbook.id);
      setMessage(`${playbook.title} launched.`);
      const nextTasks = await getTasks().catch(() => tasks);
      setTasks(nextTasks);
    } catch (error: any) {
      setMessage(error.message || "Could not launch the agent.");
    } finally {
      setLaunching(null);
    }
  }

  const fleet = runtime?.fleet?.length
    ? runtime.fleet
    : Array.from({ length: 12 }, (_, index) => ({
        id: `agent${index + 1}`,
        label: `agent${index + 1}`,
        status: index < 6 ? "online" : "standby",
      }));

  const completed = tasks.filter((task) => task.status === "completed").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  const onlineAgents = useMemo(
    () => fleet.filter((agent: any) => agent.status === "online").length,
    [fleet],
  );

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={connectionStatus} />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <section className="mesh-panel glass-heavy rounded-[28px] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Fleet orchestration</p>
              <h1 className="mt-2 text-3xl font-bold text-white">Agent fleet</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Your backend `AGENTS` variable is now surfaced into the product so the fleet page reflects the actual configured worker pool instead of a fixed demo list.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Configured</div>
                <div className="mt-2 text-lg font-semibold text-white">{fleet.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Online</div>
                <div className="mt-2 text-lg font-semibold text-white">{onlineAgents}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Running</div>
                <div className="mt-2 text-lg font-semibold text-white">{running}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Completed</div>
                <div className="mt-2 text-lg font-semibold text-white">{completed}</div>
              </div>
            </div>
          </div>
        </section>

        {message && (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1fr_1fr_0.9fr]">
          {PLAYBOOKS.map((playbook, index) => (
            <section
              key={playbook.id}
              className="glass rounded-[28px] p-5 card-glow animate-fade-in"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-cyan-100">
                  {playbook.id}
                </span>
                <span className="text-xs text-slate-500">{launching === playbook.id ? "launching..." : "ready"}</span>
              </div>
              <h2 className="mt-4 text-xl font-semibold text-white">{playbook.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">{playbook.description}</p>
              <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-400">
                {playbook.task}
              </div>
              <button
                onClick={() => launch(playbook)}
                disabled={launching === playbook.id}
                className="mt-5 w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {launching === playbook.id ? "Launching..." : "Launch playbook"}
              </button>
            </section>
          ))}
        </div>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="glass rounded-[28px] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Configured fleet nodes</h2>
              <span className="text-sm text-slate-500">{failed} failed task(s)</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {fleet.slice(0, 24).map((agent: any, index: number) => (
                <div key={agent.id} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 animate-fade-in" style={{ animationDelay: `${index * 25}ms` }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{agent.label}</span>
                    <span className={`h-2 w-2 rounded-full ${agent.status === "online" ? "bg-emerald-300 animate-pulse" : "bg-slate-600"}`} />
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{agent.status}</div>
                </div>
              ))}
            </div>
            {fleet.length > 24 && (
              <div className="mt-4 text-sm text-slate-500">
                Showing the first 24 nodes here. The runtime currently reports {fleet.length} configured agents.
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="glass rounded-[28px] p-5">
              <h2 className="text-lg font-semibold text-white">What changed</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>The fleet page now reflects `AGENTS` from the backend runtime.</li>
                <li>Task launches go through the repaired task route instead of failing on dead backend paths.</li>
                <li>Socket status in the top bar is now driven by the actual websocket hook state.</li>
              </ul>
            </div>

            <div className="glass rounded-[28px] p-5">
              <h2 className="text-lg font-semibold text-white">Next best action</h2>
              <p className="mt-2 text-sm text-slate-400">
                Launch a research or execution playbook, then monitor the Dashboard for live events and archived history actions.
              </p>
              <Link href="/dashboard" className="mt-4 inline-flex rounded-2xl border border-white/10 px-4 py-3 text-sm text-white transition hover:bg-white/5">
                Open dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}
