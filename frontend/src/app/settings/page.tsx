"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  deleteAllTasks,
  getRuntimeStatus,
  isLoggedIn,
  saveWalletAddress,
} from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 rounded-full border transition ${on ? "border-cyan-300/40 bg-cyan-400/20" : "border-white/10 bg-white/5"}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${on ? "left-6" : "left-1"}`}
      />
    </button>
  );
}

const AGENT_SETTINGS = [
  { key: "autoRun", label: "Auto-run agents", desc: "Process new tasks immediately.", def: true },
  { key: "notifications", label: "Browser notifications", desc: "Alert when tasks complete.", def: true },
  { key: "autoSweep", label: "Auto-sweep earnings", desc: "Prepare wallet routing automatically.", def: false },
  { key: "conservative", label: "Conservative mode", desc: "Prioritize lower-risk opportunities.", def: true },
  { key: "collaboration", label: "Fleet collaboration", desc: "Let your agents coordinate across the fleet.", def: true },
  { key: "contentPublish", label: "Auto-publish content", desc: "Allow content agents to prepare publishing flows.", def: false },
];

const PROVIDER_GROUPS = [
  { title: "AI providers", keys: ["GROQ_API_KEY", "GOOGLE_AI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "TOGETHER_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY"] },
  { title: "Market and search", keys: ["COINGECKO_API_KEY", "CMC_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY"] },
  { title: "Wallet and on-chain", keys: ["ALCHEMY_API_KEY"] },
];

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const { connectionStatus } = useWebSocket();
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string>("");
  const [tab, setTab] = useState<"agent" | "runtime" | "danger">("agent");
  const [runtime, setRuntime] = useState<any>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    const stored = localStorage.getItem("af_settings");
    if (stored) {
      try {
        setSettings(JSON.parse(stored));
        return;
      } catch {
        // fall back to defaults
      }
    }

    const defaults: Record<string, boolean> = {};
    AGENT_SETTINGS.forEach((item) => {
      defaults[item.key] = item.def;
    });
    setSettings(defaults);
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) return;
    setLoadingRuntime(true);
    getRuntimeStatus()
      .then(setRuntime)
      .catch(() => setRuntime(null))
      .finally(() => setLoadingRuntime(false));
  }, []);

  function updateSetting(key: string, value: boolean) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("af_settings", JSON.stringify(next));
    setMessage("Preferences saved.");
    setTimeout(() => setMessage(""), 2000);
  }

  async function clearHistory() {
    if (!confirm("Delete all of your task history?")) return;
    try {
      const result = await deleteAllTasks();
      setMessage(`Archived ${result?.deleted ?? 0} task(s).`);
    } catch (error: any) {
      setMessage(error.message || "Could not clear history.");
    }
  }

  async function disconnectWallet() {
    if (!confirm("Disconnect your wallet?")) return;
    try {
      await saveWalletAddress(null);
    } catch {
      // Keep local cleanup even if backend is down.
    }
    localStorage.removeItem("agentfi_wallet");
    setMessage("Wallet disconnected.");
  }

  const providerSummary = useMemo(() => {
    if (!runtime?.providers) return { enabled: 0, total: 0 };
    const values = Object.values(runtime.providers);
    return {
      enabled: values.filter(Boolean).length,
      total: values.length,
    };
  }, [runtime]);

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={connectionStatus} />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <section className="mesh-panel glass-heavy rounded-[28px] p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Control room</p>
              <h1 className="mt-2 text-3xl font-bold text-white">Settings</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                This page now reflects real backend runtime state. Provider keys are never shown to other users here; only boolean configured/not-configured signals are exposed, and the provider panel is admin-only.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Socket</div>
                <div className="mt-2 text-lg font-semibold text-white">{connectionStatus}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Providers</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {providerSummary.enabled}/{providerSummary.total}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:col-span-1 col-span-2">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Fleet</div>
                <div className="mt-2 text-lg font-semibold text-white">{runtime?.fleet?.length || 0} agents</div>
              </div>
            </div>
          </div>
        </section>

        {message && (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        )}

        <div className="flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
          {[
            { id: "agent", label: "Fleet settings" },
            { id: "runtime", label: "Runtime" },
            { id: "danger", label: "Maintenance" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as typeof tab)}
              className={`flex-1 rounded-2xl px-4 py-3 text-sm transition ${tab === item.id ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400 hover:text-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "agent" && (
          <section className="glass rounded-[28px] p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Agent behavior</h2>
              <p className="text-sm text-slate-400">These preferences are personal to the current user and stored in the browser.</p>
            </div>
            <div className="space-y-3">
              {AGENT_SETTINGS.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                  <div>
                    <div className="text-sm font-medium text-white">{item.label}</div>
                    <div className="text-xs text-slate-400">{item.desc}</div>
                  </div>
                  <Toggle on={settings[item.key] ?? item.def} onChange={(value) => updateSetting(item.key, value)} />
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "runtime" && (
          <section className="space-y-4">
            <div className="glass rounded-[28px] p-5">
              <h2 className="text-lg font-semibold text-white">Deployment runtime</h2>
              <p className="mt-1 text-sm text-slate-400">
                The reason your newly added APIs were still not operative was the backend crash. Until the backend responds, the frontend can only show stale local settings.
              </p>
              {loadingRuntime ? (
                <div className="mt-4 text-sm text-slate-400">Loading runtime status...</div>
              ) : runtime ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Queue</div>
                    <div className="mt-2 text-base font-semibold text-white">{runtime.queueEnabled ? "BullMQ active" : "Inline mode"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Redis</div>
                    <div className="mt-2 text-base font-semibold text-white">{runtime.redis ? "Configured" : "Missing"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Wallet on file</div>
                    <div className="mt-2 truncate text-base font-semibold text-white">{runtime.walletAddress || "Not connected"}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                  Runtime status could not be loaded. That usually means the backend is still unreachable.
                </div>
              )}
            </div>

            {isAdmin && runtime?.providers && (
              <div className="grid gap-4 lg:grid-cols-3">
                {PROVIDER_GROUPS.map((group) => (
                  <div key={group.title} className="glass rounded-[28px] p-5">
                    <h3 className="text-base font-semibold text-white">{group.title}</h3>
                    <div className="mt-4 space-y-2">
                      {group.keys.map((key) => {
                        const enabled = !!runtime.providers[key];
                        return (
                          <div key={key} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                            <code className="text-xs text-slate-300">{key}</code>
                            <span className={`rounded-full px-2 py-1 text-[11px] ${enabled ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-slate-400"}`}>
                              {enabled ? "loaded" : "missing"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {group.title === "Wallet and on-chain" && (
                      <p className="mt-3 text-xs text-slate-500">
                        Wallet provider diagnostics are restricted to admins on this page.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "danger" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="glass rounded-[28px] border border-rose-400/15 p-5">
              <h2 className="text-lg font-semibold text-white">Archive task history</h2>
              <p className="mt-2 text-sm text-slate-400">
                This now calls the repaired backend archive route for the current user only.
              </p>
              <button onClick={clearHistory} className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-400/15">
                Delete task history
              </button>
            </div>

            <div className="glass rounded-[28px] border border-amber-300/15 p-5">
              <h2 className="text-lg font-semibold text-white">Disconnect wallet</h2>
              <p className="mt-2 text-sm text-slate-400">
                This clears both local storage and the backend wallet address instead of failing on `null`.
              </p>
              <button onClick={disconnectWallet} className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 transition hover:bg-amber-300/15">
                Disconnect wallet
              </button>
            </div>
          </section>
        )}
      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}
