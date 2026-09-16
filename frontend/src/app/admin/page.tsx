"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useWebSocket } from "@/hooks/useWebSocket";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";
import { useAuth } from "@/context/AuthContext";
import {
  approvePayout,
  getAdminPayoutQueue,
  getRuntimeStatus,
  isLoggedIn,
  rejectPayout,
} from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STATUS_TONES: Record<string, string> = {
  confirmed: "bg-emerald-400/10 text-emerald-100 border-emerald-300/20",
  broadcasted: "bg-cyan-400/10 text-cyan-100 border-cyan-300/20",
  approval_required: "bg-amber-400/10 text-amber-100 border-amber-300/20",
  rejected: "bg-rose-400/10 text-rose-100 border-rose-300/20",
  failed: "bg-rose-400/10 text-rose-100 border-rose-300/20",
  blocked: "bg-slate-400/10 text-slate-100 border-slate-300/20",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Completed",
  broadcasted: "Processing",
  approval_required: "Pending approval",
  rejected: "Rejected",
  failed: "Failed",
  blocked: "Blocked",
};

function shortId(id: string) {
  return id.length > 10 ? `…${id.slice(-10)}` : id;
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function explorerFor(network: string, address: string) {
  const base: Record<string, string> = {
    ethereum: "https://etherscan.io/address/",
    polygon: "https://polygonscan.com/address/",
    arbitrum: "https://arbiscan.io/address/",
    base: "https://basescan.org/address/",
    bsc: "https://bscscan.com/address/",
  };
  const prefix = network === "bitcoin" ? "https://mempool.space/address/" : base[network];
  return prefix ? `${prefix}${address}` : null;
}

function StatusPill({ status }: { status?: string }) {
  const tone = STATUS_TONES[status || ""] || "bg-slate-400/10 text-slate-100 border-slate-300/20";
  const label = STATUS_LABELS[status || ""] || String(status || "Unknown").replace(/_/g, " ");
  const live = status === "approval_required" || status === "broadcasted";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wider ${tone}`}>
      {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </span>
  );
}

export default function AdminPage() {
  const { user, refresh, isAdmin, isSuperAdmin } = useAuth();
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [approving, setApproving] = useState<any>(null);
  const [rejecting, setRejecting] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    try {
      setQueue(await getAdminPayoutQueue());
    } catch (error: any) {
      if (error?.status === 403 || error?.status === 401) {
        setMessage("You are not authorized to view the payout queue.");
      } else {
        setMessage(error?.message || "Could not load the payout queue.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }
    void Promise.all([load(), refresh(), getRuntimeStatus().catch(() => null)]);
  }, []);

  const onSocketEvent = useMemo(
    () => async (event: any) => {
      if (event?.type?.startsWith("task:") || event?.type?.startsWith("payout:")) {
        await load();
      }
    },
    [load],
  );
  const { connectionStatus } = useWebSocket({ onEvent: onSocketEvent });

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 6000);
  }

  async function handleApprove(payout: any) {
    setApproving(null);
    setBusyId(payout.id);
    try {
      await approvePayout(payout.id, payout.approvalToken);
      flash("Payout approved and broadcast.");
      await load();
    } catch (error: any) {
      flash(error?.message || "Could not approve this payout.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(payout: any) {
    setRejecting(null);
    setBusyId(payout.id);
    try {
      await rejectPayout(payout.id, rejectReason);
      flash("Payout rejected.");
      setRejectReason("");
      await load();
    } catch (error: any) {
      flash(error?.message || "Could not reject this payout.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050c18] flex flex-col">
        <TopNav wsStatus={connectionStatus} />
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6">
          <div className="text-sm text-slate-400">Loading payout queue…</div>
        </main>
      </div>
    );
  }

  const pending = queue.filter((row) => row.status === "approval_required");
  const settled = queue.filter((row) => row.status !== "approval_required");

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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">
                {isSuperAdmin ? "Super administrator" : "Administrator"} console
              </p>
              <h1 className="mt-2 text-3xl font-bold text-white">Withdrawal approval queue</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                Review routing plans from all users, approve or reject pending withdrawals, and track broadcast state. Only authorized administrators can approve a payout.
              </p>
            </div>
            <button
              onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/5"
            >
              Refresh queue
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Awaiting approval</div>
              <div className="mt-2 text-2xl font-bold text-amber-100">{pending.length}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Broadcast / confirmed</div>
              <div className="mt-2 text-2xl font-bold text-white">{queue.filter((row) => row.status === "broadcasted" || row.status === "confirmed").length}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Rejected</div>
              <div className="mt-2 text-2xl font-bold text-white">{queue.filter((row) => row.status === "rejected").length}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Total requests</div>
              <div className="mt-2 text-2xl font-bold text-white">{queue.length}</div>
            </div>
          </div>
        </motion.section>

        {!isAdmin && (
          <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            Your account does not have administrator rights. Requests made to this page are also blocked on the server for your role.
          </div>
        )}

        {message && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border px-4 py-3 text-sm ${message.includes("not authorized") || message.includes("Could not") ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"}`}
          >
            {message}
          </motion.div>
        )}

        {isAdmin && pending.length === 0 && (
          <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-6 text-sm text-slate-400">
            No withdrawal requests are awaiting approval right now.
          </div>
        )}

        {isAdmin && pending.map((row) => (
          <motion.section
            key={row.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-[28px] p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-mono text-xs text-slate-500">ID {shortId(row.id)}</div>
                  <StatusPill status={row.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className={`text-3xl font-bold ${row.status === "approval_required" ? "text-amber-100" : "text-white"}`}>
                    {row.amount} <span className="text-base font-semibold opacity-70">{row.assetSymbol}</span>
                  </div>
                  <span className="text-sm text-slate-500">on {row.network}</span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-400">
                  <div>
                    Requested by <span className="font-medium text-slate-200">{row.user?.displayName || row.user?.username || "Unknown user"}</span>
                    {row.user?.email ? <span className="text-slate-500"> ({row.user.email})</span> : null}
                  </div>
                  <div className="break-all">To <span className="font-mono text-slate-300">{row.recipientAddress}</span></div>
                  {row.txHash ? <div className="break-all">Tx <span className="font-mono text-cyan-200">{row.txHash}</span></div> : null}
                  {row.error ? <div className="text-slate-500">{row.error}</div> : null}
                </div>
              </div>

              <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:items-center">
                {explorerFor(row.network, row.recipientAddress) && (
                  <a href={explorerFor(row.network, row.recipientAddress)!} target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 px-4 py-3 text-center text-sm text-slate-300 transition hover:bg-white/5">
                    Explorer
                  </a>
                )}
                {row.status !== "rejected" && row.status !== "broadcasted" && row.status !== "confirmed" && (
                  <>
                    <button
                      onClick={() => setRejecting(row)}
                      disabled={busyId === row.id}
                      className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-400/15 disabled:opacity-60"
                    >
                      Reject
                    </button>
                    {row.status === "approval_required" && (
                      <button
                        onClick={() => setApproving(row)}
                        disabled={busyId === row.id}
                        className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
                      >
                        {busyId === row.id ? "Approving…" : "Approve & send"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-600">Submitted {formatTime(row.createdAt)} · Updated {formatTime(row.updatedAt)}</div>
          </motion.section>
        ))}

        {isAdmin && settled.length > 0 && (
          <section className="glass rounded-[28px] p-5">
            <h2 className="text-lg font-semibold text-white">Recent activity</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/8 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    <th className="py-2 pr-4">Request</th>
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Destination</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs text-slate-500">{shortId(row.id)}</td>
                      <td className="py-3 pr-4 text-slate-300">{row.user?.username || "Unknown"}</td>
                      <td className="py-3 pr-4 font-semibold text-white">{row.amount} {row.assetSymbol}</td>
                      <td className="max-w-[220px] truncate py-3 pr-4 font-mono text-xs text-slate-400">{row.recipientAddress}</td>
                      <td className="py-3 pr-4"><StatusPill status={row.status} /></td>
                      <td className="py-3 text-xs text-slate-500">{formatTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <Dialog open={!!approving} onOpenChange={(open) => { if (!open) setApproving(null); }}>
          <DialogContent className="border border-white/10 bg-[#0b1728] text-white">
            <DialogHeader>
              <DialogTitle>Approve payout for {approving?.user?.username || "this user"}?</DialogTitle>
            </DialogHeader>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              This will sign and broadcast <span className="font-semibold text-white">{approving?.amount} {approving?.assetSymbol}</span> to{" "}
              <span className="font-mono break-all">{approving?.recipientAddress}</span> on {approving?.network}. This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setApproving(null)} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-300">Cancel</button>
              <button onClick={() => handleApprove(approving)} className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950">Approve & send</button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
          <DialogContent className="border border-white/10 bg-[#0b1728] text-white">
            <DialogHeader>
              <DialogTitle>Reject payout for {rejecting?.user?.username || "this user"}?</DialogTitle>
            </DialogHeader>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The request for <span className="font-semibold text-white">{rejecting?.amount} {rejecting?.assetSymbol}</span> will be marked as rejected and no transaction will be broadcast.
            </p>
            <label className="mt-3 block text-xs uppercase tracking-[0.2em] text-slate-500">Reason (optional)</label>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-cyan-300/30"
              placeholder="Why was this request rejected?"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setRejecting(null)} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-300">Cancel</button>
              <button onClick={() => handleReject(rejecting)} className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-5 py-3 text-sm font-semibold text-rose-100">Reject request</button>
            </div>
          </DialogContent>
        </Dialog>
      </main>

      <PageFooter />
      <BottomNav />
    </div>
  );
}