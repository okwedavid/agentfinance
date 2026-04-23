"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";
import {
  createTask,
  getRuntimeStatus,
  getTasks,
  getWalletBalance,
  isLoggedIn,
  saveWalletAddress,
} from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const CHAINS = [
  { id: "ethereum", name: "Ethereum", symbol: "ETH", explorer: "https://etherscan.io/address/" },
  { id: "polygon", name: "Polygon", symbol: "MATIC", explorer: "https://polygonscan.com/address/" },
  { id: "base", name: "Base", symbol: "ETH", explorer: "https://basescan.org/address/" },
  { id: "arbitrum", name: "Arbitrum", symbol: "ETH", explorer: "https://arbiscan.io/address/" },
];

function parseResult(value: any) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export default function WalletPage() {
  const { isAdmin } = useAuth();
  const [wallet, setWallet] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [chain, setChain] = useState(CHAINS[0]);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState<any>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [runtime, setRuntime] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [routingBusy, setRoutingBusy] = useState(false);

  const refreshTasks = async () => getTasks().then(setTasks).catch(() => setTasks([]));
  const refreshRuntime = async () => getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null));

  const onSocketEvent = useMemo(() => async (event: any) => {
    if (event?.type?.startsWith("task:")) {
      await refreshTasks();
    }
  }, []);

  const { connectionStatus } = useWebSocket({ onEvent: onSocketEvent });

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    const stored = localStorage.getItem("agentfi_wallet");
    if (stored) {
      setWallet(stored);
      setInput(stored);
      void refreshBalance(stored);
    }

    void refreshRuntime();
    void refreshTasks();
  }, []);

  async function refreshBalance(address: string) {
    setLoadingBalance(true);
    try {
      const next = await getWalletBalance(address);
      setBalance(next);
    } catch {
      setBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 3500);
  }

  async function connect(address: string) {
    const trimmed = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      flash("Enter a valid EVM wallet address.");
      return;
    }

    try {
      await saveWalletAddress(trimmed);
      localStorage.setItem("agentfi_wallet", trimmed);
      setWallet(trimmed);
      setInput(trimmed);
      await Promise.all([refreshBalance(trimmed), refreshRuntime()]);
      flash("Wallet connected.");
    } catch (error: any) {
      flash(error.message || "Could not save wallet.");
    }
  }

  async function connectMetaMask() {
    const provider = (window as any).ethereum;
    if (!provider) {
      flash("MetaMask is not installed on this device.");
      return;
    }

    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (accounts?.[0]) await connect(accounts[0]);
    } catch (error: any) {
      flash(error.message || "MetaMask connection was cancelled.");
    }
  }

  async function disconnectWallet() {
    try {
      await saveWalletAddress(null);
    } catch {
      // local cleanup still matters
    }
    localStorage.removeItem("agentfi_wallet");
    setWallet(null);
    setInput("");
    setBalance(null);
    await refreshRuntime();
    flash("Wallet disconnected.");
  }

  async function routeEarnings() {
    if (!wallet) {
      flash("Connect a wallet first.");
      return;
    }
    setRoutingBusy(true);
    try {
      const completedTasks = tasks.filter((task) => task.status === "completed").length;
      const amount = (completedTasks * 0.001).toFixed(4);
      const action = `Prepare routing plan for ${amount} ETH agent earnings to wallet ${wallet} on ${chain.name}. Check live balance first, then prepare the transaction but do not broadcast it.`;
      await createTask(action, "execution");
      await refreshTasks();
      flash("Routing plan queued.");
    } catch (error: any) {
      flash(error.message || "Could not queue the execution task.");
    } finally {
      setRoutingBusy(false);
    }
  }

  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const pendingEarnings = (completedTasks * 0.001).toFixed(4);
  const totalEarnings = (completedTasks * 0.0035).toFixed(4);

  const providerReady = !!runtime?.providers?.ALCHEMY_API_KEY;
  const walletStatus = useMemo(() => {
    if (!wallet) return "No wallet connected";
    if (connectionStatus === "offline") return "Wallet saved, socket offline";
    return "Wallet linked and ready";
  }, [wallet, connectionStatus]);

  const latestExecutionTask = useMemo(() => {
    return tasks.find((task) => /routing plan|route agent earnings|execution/i.test(task.action));
  }, [tasks]);

  const executionPayload = parseResult(latestExecutionTask?.result);

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={connectionStatus} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <section className="mesh-panel glass-heavy rounded-[28px] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Wallet operations</p>
              <h1 className="mt-2 text-3xl font-bold text-white">Earnings destination</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Your wallet receives routed earnings from completed agent runs once a real payout source and signer are configured.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Connection</div>
                <div className="mt-2 text-base font-semibold text-white">{walletStatus}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Alchemy</div>
                <div className="mt-2 text-base font-semibold text-white">{providerReady ? "Loaded" : "Missing"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pending</div>
                <div className="mt-2 text-base font-semibold text-white">{pendingEarnings} ETH</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Lifetime</div>
                <div className="mt-2 text-base font-semibold text-white">{totalEarnings} ETH</div>
              </div>
            </div>
          </div>
        </section>

        {message && (
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            {message}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="glass rounded-[28px] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Connected wallet</h2>
                <p className="mt-1 text-sm text-slate-400">Store one destination wallet per account for routing and balance checks.</p>
              </div>
              {wallet && (
                <button onClick={disconnectWallet} className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-400/15">
                  Disconnect
                </button>
              )}
            </div>

            <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Address</div>
              <div className="mt-2 break-all font-mono text-sm text-white">{wallet || "No wallet saved yet."}</div>
              {wallet && (
                <a href={`${chain.explorer}${wallet}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-cyan-200 underline-offset-4 hover:underline">
                  Open in explorer
                </a>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button onClick={connectMetaMask} className="rounded-[24px] border border-orange-300/20 bg-[linear-gradient(135deg,rgba(249,115,22,0.18),rgba(251,146,60,0.08))] p-4 text-left transition hover:-translate-y-0.5">
                <div className="text-sm font-semibold text-white">Connect MetaMask</div>
                <div className="mt-1 text-xs text-orange-100/80">Use the injected wallet from this browser.</div>
              </button>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">Manual address</div>
                <div className="mt-3 flex gap-2">
                  <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="0x..." className="input-field font-mono" />
                  <button onClick={() => connect(input)} className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CHAINS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setChain(option)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${chain.id === option.id ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100" : "border-white/8 bg-white/[0.03] text-slate-300 hover:bg-white/[0.05]"}`}
                >
                  <div className="text-sm font-medium">{option.name}</div>
                  <div className="text-xs text-slate-500">{option.symbol}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-5">
            <div className="glass rounded-[28px] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Live balance</h2>
                {wallet && (
                  <button onClick={() => refreshBalance(wallet)} className="text-sm text-cyan-200 transition hover:text-white">
                    Refresh
                  </button>
                )}
              </div>

              <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                {loadingBalance ? (
                  <div className="text-sm text-slate-400">Fetching on-chain balance...</div>
                ) : balance ? (
                  <>
                    <div className="text-3xl font-bold text-white">{balance.eth} ETH</div>
                    <div className="mt-2 text-sm text-slate-400">Approximately ${balance.usd} USD</div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-semibold text-white">Balance unavailable</div>
                    <div className="mt-2 text-sm text-slate-400">
                      {providerReady
                        ? "The provider is configured, but the request failed. Check the backend logs."
                        : "Live balance checks are currently unavailable."}
                    </div>
                    {isAdmin && !providerReady && (
                      <div className="mt-3 text-xs text-amber-200">
                        Admin note: add `ALCHEMY_API_KEY` in Railway backend variables to restore live balance checks.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="glass rounded-[28px] p-5">
              <h2 className="text-lg font-semibold text-white">Route earnings</h2>
              <p className="mt-2 text-sm text-slate-400">
                This now creates a live execution-preparation task that checks balance and prepares a payout transaction plan in real time.
              </p>
              <button
                onClick={routeEarnings}
                disabled={routingBusy}
                className="mt-4 w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {routingBusy ? "Preparing..." : "Prepare routing plan"}
              </button>
              <Link href="/agents" className="mt-3 inline-flex text-sm text-cyan-200 underline-offset-4 hover:underline">
                Open agent fleet
              </Link>
            </div>

            <div className="glass rounded-[28px] p-5">
              <h2 className="text-lg font-semibold text-white">Latest routing task</h2>
              {!latestExecutionTask ? (
                <p className="mt-2 text-sm text-slate-400">No routing task has been created yet.</p>
              ) : (
                <div className="mt-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{latestExecutionTask.status}</span>
                    <span className="text-xs text-slate-500">{new Date(latestExecutionTask.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-3 text-sm text-white">{latestExecutionTask.action}</div>
                  {executionPayload && (
                    <pre className="mt-4 whitespace-pre-wrap break-words text-xs leading-6 text-slate-300">
                      {JSON.stringify(executionPayload, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}
