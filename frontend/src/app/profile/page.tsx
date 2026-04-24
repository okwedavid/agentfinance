"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";
import { useAuth } from "@/context/AuthContext";
import { getPayouts, getRuntimeStatus, getTasks, isLoggedIn, updateProfile } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

function sanitizePlainText(value: unknown) {
  return String(value || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NETWORK_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  polygon: "Polygon",
  base: "Base",
  arbitrum: "Arbitrum",
  bsc: "BNB Smart Chain",
  bitcoin: "Bitcoin",
};

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [runtime, setRuntime] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { connectionStatus } = useWebSocket();

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    void Promise.all([
      getTasks().then(setTasks).catch(() => setTasks([])),
      getPayouts().then(setPayouts).catch(() => setPayouts([])),
      getRuntimeStatus().then(setRuntime).catch(() => setRuntime(null)),
      refresh(),
    ]);
  }, []);

  useEffect(() => {
    setDisplayName(user?.displayName || user?.username || "");
    setBio(user?.bio || "");
  }, [user?.displayName, user?.bio, user?.username]);

  async function saveProfile() {
    setSaving(true);
    try {
      await updateProfile({
        displayName,
        bio,
        preferredNetwork: user?.preferredNetwork || runtime?.preferredNetwork || "ethereum",
      });
      await refresh();
      setEditing(false);
      setMessage("Profile saved.");
    } catch (error: any) {
      setMessage(error.message || "Could not save profile.");
    } finally {
      setSaving(false);
      window.setTimeout(() => setMessage(""), 3000);
    }
  }

  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const successRate = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  const earnings = (completed * 0.0035).toFixed(4);

  const walletProfiles = (user?.walletProfiles || runtime?.walletProfiles || {}) as Record<string, string>;
  const latestPayout = payouts[0];

  const headlineCards = useMemo(
    () => [
      { label: "Total tasks", value: String(tasks.length) },
      { label: "Completed", value: String(completed) },
      { label: "Success rate", value: `${successRate}%` },
      { label: "Estimated earned", value: `${earnings} ETH` },
    ],
    [completed, earnings, successRate, tasks.length],
  );

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={connectionStatus} />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mesh-panel glass-heavy rounded-[28px] p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Profile</p>
              <h1 className="mt-2 text-3xl font-bold text-white">{user?.displayName || user?.username || "Operator"}</h1>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                Manage your identity, review your routing setup, and track the live state of your account across devices.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {headlineCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{card.label}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{card.value}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {message && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100"
          >
            {message}
          </motion.div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35 }}
            className="glass rounded-[28px] p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Identity</h2>
                <p className="mt-1 text-sm text-slate-400">This profile is stored on the backend and follows your login session.</p>
              </div>
              {!editing && (
                <button onClick={() => setEditing(true)} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/5">
                  Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="mt-4 space-y-3">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Display name"
                  className="input-field"
                  autoFocus
                />
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  rows={4}
                  placeholder="Write a short profile bio."
                  className="input-field resize-none"
                />
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button onClick={saveProfile} disabled={saving} className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60">
                    {saving ? "Saving profile" : "Save profile"}
                  </button>
                  <button onClick={() => setEditing(false)} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/5">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-sm font-semibold text-white">{user?.displayName || user?.username}</div>
                <div className="mt-2 text-sm text-slate-400">@{user?.username}</div>
                <div className="mt-4 text-sm leading-7 text-slate-200">
                  {user?.bio ? sanitizePlainText(user.bio) : "Add a short bio to personalize the account."}
                </div>
              </div>
            )}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.35 }}
            className="glass rounded-[28px] p-5"
          >
            <h2 className="text-lg font-semibold text-white">Routing setup</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Preferred network</div>
                <div className="mt-2 text-sm font-semibold text-white">{NETWORK_LABELS[user?.preferredNetwork || runtime?.preferredNetwork || "ethereum"] || "Ethereum"}</div>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Saved addresses</div>
                <div className="mt-3 space-y-3">
                  {Object.keys(walletProfiles).length === 0 ? (
                    <div className="text-sm text-slate-400">No network wallet has been saved yet.</div>
                  ) : (
                    Object.entries(walletProfiles).map(([network, address]) => (
                      <div key={network} className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{NETWORK_LABELS[network] || network}</div>
                        <div className="mt-2 break-all text-sm leading-7 text-white">{address}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <Link href="/wallet" className="inline-flex rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/5">
                Open wallet center
              </Link>
            </div>
          </motion.section>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
            className="glass rounded-[28px] p-5"
          >
            <h2 className="text-lg font-semibold text-white">Payout readiness</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Socket status</div>
                <div className="mt-2 text-sm font-semibold text-white">{connectionStatus}</div>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">EVM signer</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {runtime?.payoutRuntime?.treasury?.evmReady ? "Ready" : "Needs setup"}
                </div>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Bitcoin signer</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {runtime?.payoutRuntime?.treasury?.btcReady ? "Ready" : "Needs setup"}
                </div>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Current issue</div>
                <div className="mt-2 text-sm leading-7 text-slate-300">
                  {runtime?.payoutRuntime?.treasury?.issue || "No blocking payout issue is currently reported."}
                </div>
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.35 }}
            className="glass rounded-[28px] p-5"
          >
            <h2 className="text-lg font-semibold text-white">Latest payout</h2>
            {!latestPayout ? (
              <p className="mt-2 text-sm text-slate-400">No payout has been prepared yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</div>
                  <div className="mt-2 text-sm font-semibold text-white">{latestPayout.status}</div>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Summary</div>
                  <div className="mt-3 space-y-2">
                    {sanitizePlainText(latestPayout.summary || "")
                      .replace(/\. /g, ".\n")
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line, index) => (
                        <p key={`${latestPayout.id}-${index}`} className="text-sm leading-7 text-slate-200">
                          {line}
                        </p>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </motion.section>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.35 }}
          className="glass rounded-[28px] overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <h2 className="text-lg font-semibold text-white">Recent activity</h2>
            <div className="text-sm text-slate-400">
              {completed} completed, {running} running, {failed} failed
            </div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {tasks.length === 0 ? (
              <div className="p-8 text-sm text-slate-400">No activity yet. Launch a task from the dashboard to start the fleet.</div>
            ) : (
              tasks.slice(0, 8).map((task) => (
                <div key={task.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm leading-7 text-white">{sanitizePlainText(task.action)}</p>
                    <p className="text-xs text-slate-500">{new Date(task.createdAt || Date.now()).toLocaleString()}</p>
                  </div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{task.status}</div>
                </div>
              ))
            )}
          </div>
        </motion.section>
      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}
