"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";
import {
  approvePayout,
  getPayouts,
  getRuntimeStatus,
  getTasks,
  getWalletBalanceForNetwork,
  isLoggedIn,
  preparePayout,
  refreshPayoutStatus,
  saveWalletAddress,
} from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const CHAINS = [
  { id: "ethereum", name: "Ethereum", symbol: "ETH", type: "evm", explorer: "https://etherscan.io/address/" },
  { id: "polygon", name: "Polygon", symbol: "MATIC", type: "evm", explorer: "https://polygonscan.com/address/" },
  { id: "base", name: "Base", symbol: "ETH", type: "evm", explorer: "https://basescan.org/address/" },
  { id: "arbitrum", name: "Arbitrum", symbol: "ETH", type: "evm", explorer: "https://arbiscan.io/address/" },
  { id: "bsc", name: "BNB Smart Chain", symbol: "BNB", type: "evm", explorer: "https://bscscan.com/address/" },
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", type: "btc", explorer: "https://mempool.space/address/" },
];

function sanitizePlainText(value: unknown) {
  return String(value || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[_*`#>|[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSummary(summary: string) {
  return sanitizePlainText(summary)
    .replace(/\. /g, ".\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isValidAddress(address: string, chainType: string) {
  const value = address.trim();
  if (chainType === "btc") return /^(bc1|[13])[a-zA-Z0-9]{24,87}$/.test(value);
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function PayoutStatusPill({ status }: { status: string }) {
  const tone =
    status === "confirmed"
      ? "bg-emerald-400/10 text-emerald-100 border-emerald-300/20"
      : status === "broadcasted"
        ? "bg-cyan-400/10 text-cyan-100 border-cyan-300/20"
        : status === "approval_required"
          ? "bg-amber-400/10 text-amber-100 border-amber-300/20"
          : "bg-rose-400/10 text-rose-100 border-rose-300/20";

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${tone}`}>
      {status}
    </span>
  );
}

export default function WalletPage() {
  const { user, refresh, isAdmin } = useAuth();
  const [chainId, setChainId] = useState("ethereum");
  const [wallet, setWallet] = useState("");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState<any>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [runtime, setRuntime] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const chain = useMemo(
    () => CHAINS.find((item) => item.id === chainId) || CHAINS[0],
    [chainId],
  );

  const refreshRuntime = async () => getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null));
  const refreshTasks = async () => getTasks().then(setTasks).catch(() => setTasks([]));
  const refreshPayoutsList = async () => getPayouts().then(setPayouts).catch(() => setPayouts([]));

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 3500);
  }

  const onSocketEvent = useMemo(
    () => async (event: any) => {
      if (event?.type?.startsWith("task:")) {
        await Promise.all([refreshTasks(), refreshPayoutsList(), refreshRuntime()]);
      }
    },
    [],
  );

  const { connectionStatus } = useWebSocket({ onEvent: onSocketEvent });

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    void Promise.all([refreshRuntime(), refreshTasks(), refreshPayoutsList(), refresh()]);
  }, []);

  useEffect(() => {
    const preferred = runtime?.preferredNetwork || user?.preferredNetwork;
    if (preferred && CHAINS.some((item) => item.id === preferred)) {
      setChainId(preferred);
    }
  }, [runtime?.preferredNetwork, user?.preferredNetwork]);

  useEffect(() => {
    const profiles = (user?.walletProfiles || runtime?.walletProfiles || {}) as Record<string, string>;
    const nextWallet = profiles?.[chain.id] || (chain.type === "evm" ? user?.walletAddress : "") || "";
    setWallet(nextWallet);
    setInput(nextWallet);
    if (nextWallet) {
      void refreshBalance(nextWallet, chain.id);
    } else {
      setBalance(null);
    }
  }, [chain.id, chain.type, runtime?.walletProfiles, user?.walletAddress, user?.walletProfiles]);

  async function refreshBalance(address: string, network = chain.id) {
    setLoadingBalance(true);
    try {
      const next = await getWalletBalanceForNetwork(address, network);
      setBalance(next);
    } catch {
      setBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }

  async function connect(address: string) {
    const trimmed = address.trim();
    if (!isValidAddress(trimmed, chain.type)) {
      flash(`Enter a valid ${chain.name} wallet address.`);
      return;
    }

    try {
      await saveWalletAddress(trimmed, chain.id);
      await Promise.all([refresh(), refreshRuntime(), refreshPayoutsList()]);
      setWallet(trimmed);
      setInput(trimmed);
      await refreshBalance(trimmed, chain.id);
      flash(`${chain.name} wallet connected.`);
    } catch (error: any) {
      flash(error.message || "Could not save wallet.");
    }
  }

  async function connectMetaMask() {
    if (chain.type !== "evm") {
      flash("Use a Bitcoin address manually for the Bitcoin network.");
      return;
    }

    const provider = (window as any).ethereum;
    if (!provider) {
      flash("MetaMask is not installed on this device.");
      return;
    }

    try {
      if (chain.id === "bsc") {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        }).catch(() => null);
      }

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (accounts?.[0]) await connect(accounts[0]);
    } catch (error: any) {
      flash(error.message || "Wallet connection was cancelled.");
    }
  }

  async function disconnectWallet() {
    try {
      await saveWalletAddress(null, chain.id);
      await Promise.all([refresh(), refreshRuntime(), refreshPayoutsList()]);
      setWallet("");
      setInput("");
      setBalance(null);
      flash(`${chain.name} wallet disconnected.`);
    } catch (error: any) {
      flash(error.message || "Could not disconnect wallet.");
    }
  }

  async function routeEarnings() {
    if (!wallet) {
      flash("Connect a wallet first.");
      return;
    }

    setRoutingBusy(true);
    try {
      const completedTasks = tasks.filter((task) => task.status === "completed").length;
      const amount = chain.type === "btc"
        ? Math.max(completedTasks * 0.00001, 0.00001)
        : Math.max(completedTasks * 0.001, 0.001);

      const action = `Prepare routing plan for ${amount.toFixed(chain.type === "btc" ? 8 : 6)} ${chain.symbol} agent earnings to wallet ${wallet} on ${chain.name}.`;
      await preparePayout({
        action,
        amount: amount.toFixed(chain.type === "btc" ? 8 : 6),
        network: chain.id,
        recipientAddress: wallet,
      });
      await Promise.all([refreshTasks(), refreshPayoutsList(), refreshRuntime()]);
      flash("Routing plan prepared.");
    } catch (error: any) {
      flash(error.message || "Could not prepare the routing plan.");
    } finally {
      setRoutingBusy(false);
    }
  }

  async function approveLatestPayout(payoutId: string) {
    setApprovingId(payoutId);
    try {
      await approvePayout(payoutId);
      await Promise.all([refreshPayoutsList(), refreshTasks()]);
      flash("Payout approval submitted.");
    } catch (error: any) {
      flash(error.message || "Could not approve this payout.");
    } finally {
      setApprovingId(null);
    }
  }

  async function refreshLatestStatus(payoutId: string) {
    try {
      await refreshPayoutStatus(payoutId);
      await refreshPayoutsList();
    } catch (error: any) {
      flash(error.message || "Could not refresh transaction status.");
    }
  }

  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const pendingEarnings = chain.type === "btc"
    ? (completedTasks * 0.00001).toFixed(8)
    : (completedTasks * 0.001).toFixed(6);
  const lifetimeEarnings = chain.type === "btc"
    ? (completedTasks * 0.000035).toFixed(8)
    : (completedTasks * 0.0035).toFixed(6);

  const walletStatus = !wallet
    ? "No wallet connected"
    : connectionStatus === "offline"
      ? "Wallet saved and waiting for live sync"
      : "Wallet linked and live";

  const latestPayout = payouts[0];
  const latestSummary = latestPayout?.summary ? formatSummary(latestPayout.summary) : [];

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
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Wallet operations</p>
              <h1 className="mt-2 text-3xl font-bold text-white">Routing and payout center</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                Your routing wallet, approval flow, and payout tracking now stay attached to your account. When you log in on another device, the latest saved address and payout state follow you.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Connection</div>
                <div className="mt-2 text-base font-semibold text-white">{walletStatus}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Selected network</div>
                <div className="mt-2 text-base font-semibold text-white">{chain.name}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Pending routing</div>
                <div className="mt-2 text-base font-semibold text-white">{pendingEarnings} {chain.symbol}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Lifetime routed</div>
                <div className="mt-2 text-base font-semibold text-white">{lifetimeEarnings} {chain.symbol}</div>
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

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35 }}
            className="glass rounded-[28px] p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Connected wallet</h2>
                <p className="mt-1 text-sm text-slate-400">Save one address per network and route earnings to the right chain.</p>
              </div>
              {wallet && (
                <button onClick={disconnectWallet} className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-400/15">
                  Disconnect this network
                </button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {CHAINS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setChainId(option.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${chain.id === option.id ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_0_1px_rgba(103,232,249,0.05)]" : "border-white/8 bg-white/[0.03] text-slate-300 hover:bg-white/[0.05]"}`}
                >
                  <div className="text-sm font-medium">{option.name}</div>
                  <div className="text-xs text-slate-500">{option.symbol}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Saved destination</div>
              <div className="mt-2 break-all text-sm leading-7 text-white">{wallet || `No ${chain.name} wallet saved yet.`}</div>
              {wallet && (
                <a href={`${chain.explorer}${wallet}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm text-cyan-200 underline-offset-4 hover:underline">
                  Open in explorer
                </a>
              )}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
              <button
                onClick={connectMetaMask}
                className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${chain.type === "evm" ? "border-cyan-300/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.18),rgba(59,130,246,0.10))]" : "border-white/8 bg-white/[0.03] opacity-70"}`}
              >
                <div className="text-sm font-semibold text-white">{chain.type === "evm" ? "Connect browser wallet" : "Browser wallet unavailable"}</div>
                <div className="mt-1 text-xs text-slate-300">
                  {chain.type === "evm" ? `Use the injected wallet for ${chain.name}.` : "Bitcoin uses manual address entry in this release."}
                </div>
              </button>

              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">Manual address</div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={chain.type === "btc" ? "bc1..." : "0x..."} className="input-field font-mono" />
                  <button onClick={() => connect(input)} className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                    Save
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-500">This address is stored on your account and will appear when you sign in on another device.</div>
              </div>
            </div>
          </motion.section>

          <div className="space-y-5">
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35 }}
              className="glass rounded-[28px] p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Live balance</h2>
                {wallet && (
                  <button onClick={() => refreshBalance(wallet, chain.id)} className="text-sm text-cyan-200 transition hover:text-white">
                    Refresh
                  </button>
                )}
              </div>

              <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                {loadingBalance ? (
                  <div className="text-sm text-slate-400">Fetching the latest on chain balance.</div>
                ) : balance ? (
                  <>
                    <div className="text-3xl font-bold text-white">{balance.balance} {balance.symbol}</div>
                    <div className="mt-2 text-sm text-slate-400">
                      {balance.usd ? `Approximately $${balance.usd} USD.` : "USD valuation is not available right now."}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-lg font-semibold text-white">Balance unavailable</div>
                    <div className="mt-2 text-sm leading-7 text-slate-400">
                      {runtime?.payoutRuntime?.networks?.find((item: any) => item.id === chain.id)?.rpcConfigured
                        ? "The balance lookup failed. Check the backend network credentials or RPC health."
                        : `No live ${chain.name} provider is configured yet.`}
                    </div>
                    {isAdmin && (
                      <div className="mt-3 text-xs text-amber-200">
                        Admin note: configure the RPC or chain API for {chain.name} in Railway to restore live balance checks.
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.35 }}
              className="glass rounded-[28px] p-5"
            >
              <h2 className="text-lg font-semibold text-white">Prepare routing plan</h2>
              <p className="mt-2 text-sm leading-7 text-slate-400">
                This creates a real payout plan, links it to your account, and keeps the latest routing status visible across devices.
              </p>
              <button
                onClick={routeEarnings}
                disabled={routingBusy}
                className="mt-4 w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
              >
                {routingBusy ? "Preparing routing plan" : `Prepare ${chain.symbol} routing plan`}
              </button>
              <div className="mt-3 text-xs text-slate-500">Latest plan uses the wallet saved for {chain.name} and the payout signer configured on the backend.</div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.35 }}
              className="glass rounded-[28px] p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Latest payout</h2>
                {latestPayout && <PayoutStatusPill status={latestPayout.status} />}
              </div>

              {!latestPayout ? (
                <p className="mt-2 text-sm text-slate-400">No payout plan has been created yet.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Readable summary</div>
                    <div className="mt-3 space-y-3">
                      {latestSummary.map((line, index) => (
                        <motion.p
                          key={`${latestPayout.id}-${index}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.04 * index, duration: 0.2 }}
                          className="text-sm leading-7 text-slate-200"
                        >
                          {line}
                        </motion.p>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Recipient</div>
                      <div className="mt-2 break-all text-sm leading-7 text-white">{latestPayout.recipientAddress}</div>
                    </div>
                    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Amount</div>
                      <div className="mt-2 text-sm font-semibold text-white">{latestPayout.amount} {latestPayout.assetSymbol}</div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    {latestPayout.status === "approval_required" && (
                      <button
                        onClick={() => approveLatestPayout(latestPayout.id)}
                        disabled={approvingId === latestPayout.id}
                        className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
                      >
                        {approvingId === latestPayout.id ? "Approving payout" : "Approve payout"}
                      </button>
                    )}
                    {(latestPayout.status === "broadcasted" || latestPayout.status === "confirmed") && (
                      <button
                        onClick={() => refreshLatestStatus(latestPayout.id)}
                        className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/5"
                      >
                        Refresh status
                      </button>
                    )}
                    <Link href="/agents" className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/5">
                      Open fleet
                    </Link>
                  </div>
                </div>
              )}
            </motion.section>
          </div>
        </div>
      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}
