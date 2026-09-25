"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BottomNav, PageFooter, TopNav } from "@/components/layout/Nav";
import { useAuth } from "@/context/AuthContext";
import {
  createComputeJob,
  createComputeQuote,
  getComputeJobDetail,
  getComputeJobs,
  getComputeServices,
  isLoggedIn,
  runComputeJob,
} from "@/lib/api";

const ASSETS = ["BNB", "USDT", "USDC"] as const;

const JOB_TONES: Record<string, string> = {
  DRAFT: "bg-slate-400/10 text-slate-100 border-slate-300/20",
  PENDING: "bg-amber-400/10 text-amber-100 border-amber-300/20",
  RUNNING: "bg-cyan-400/10 text-cyan-100 border-cyan-300/20",
  COMPLETED: "bg-emerald-400/10 text-emerald-100 border-emerald-300/20",
  FAILED: "bg-rose-400/10 text-rose-100 border-rose-300/20",
  REFUNDED: "bg-slate-400/10 text-slate-100 border-slate-300/20",
};

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

export default function ComputePage() {
  const { user } = useAuth();
  const [services, setServices] = useState<any[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [selected, setSelected] = useState("");
  const [asset, setAsset] = useState<string>("BNB");
  const [requestText, setRequestText] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);

  const load = useCallback(async () => {
    const [catalog, list] = await Promise.all([getComputeServices(), getComputeJobs()]);
    setServices(catalog.services);
    setDemoMode(catalog.demoMode);
    setJobs(list);
    if (!selected && catalog.services.length > 0) setSelected(catalog.services[0].slug);
  }, [selected]);

  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }
    void load().finally(() => setLoading(false));
  }, [load]);

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 7000);
  }

  const selectedService = useMemo(() => services.find((s) => s.slug === selected), [services, selected]);

  async function handleQuote() {
    setBusy(true);
    setQuote(null);
    setPayment(null);
    try {
      const result = await createComputeQuote({ serviceSlug: selected, asset, requestText });
      setQuote(result.quote);
      setPayment(result.paymentIntent);
      flash(demoMode ? "Demo quote created — the payment is SIMULATED until an admin verifies it." : "Quote created. Real verification requires SUPER_ADMIN attestation.");
    } catch (error: any) {
      flash(error?.message || "Could not create a quote.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateJob() {
    if (!quote) return;
    setBusy(true);
    try {
      const result = await createComputeJob(quote.id);
      flash(`Job ${result.job.status} created. It runs only after payment verification.`);
      setQuote(null);
      setPayment(null);
      await load();
    } catch (error: any) {
      flash(error?.message || "Could not create the job.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun(job: any) {
    setBusy(true);
    try {
      const result = await runComputeJob(job.id);
      flash(`Job ${result.job.status} — reward booked from verified revenue.`);
      await Promise.all([load(), openDetail(job.id)]);
    } catch (error: any) {
      flash(error?.message || "Could not run this job.");
    } finally {
      setBusy(false);
    }
  }

  const openDetail = useCallback(async (jobId: string) => {
    try {
      const data = await getComputeJobDetail(jobId);
      setDetail(data);
    } catch {
      setDetail(null);
    }
  }, []);

  const runnerStatus = (job: any) =>
    job.status === "RUNNING" ? "running" : job.status === "COMPLETED" ? "completed" : job.status;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050c18] flex flex-col">
        <TopNav />
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6">
          <div className="text-sm text-slate-400">Loading compute marketplace…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 pb-24 md:pb-6 page-enter">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mesh-panel glass-heavy rounded-[28px] p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">Compute marketplace</p>
              <h1 className="mt-2 text-3xl font-bold text-white">Revenue-backed agent compute</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                Buy a compute job from the catalog, pay at the server-priced quote, and the fleet delivers hashed
                output. The verified payment funds a contributor reward — computation is never money on its own.
              </p>
            </div>
            {demoMode && (
              <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-amber-100">
                Demo economy
              </span>
            )}
          </div>
          {message && (
            <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
              {message}
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-[28px] p-5"
        >
          <h2 className="text-lg font-semibold text-white">Request compute</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Service (server-priced)</span>
                <select
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                >
                  {services.map((service) => (
                    <option key={service.id} value={service.slug}>
                      {service.name} — {service.unitPriceBnb} BNB/job
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Payment asset</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ASSETS.map((option) => (
                    <button
                      key={option}
                      onClick={() => setAsset(option)}
                      className={`rounded-full border px-4 py-2 text-sm transition ${
                        asset === option
                          ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                          : "border-white/10 text-slate-300 hover:bg-white/5"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Request</span>
                <textarea
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                  rows={5}
                  placeholder="Describe the deliverable for this compute job…"
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/40"
                />
              </label>
              <button
                onClick={handleQuote}
                disabled={busy || !selected || !requestText.trim()}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500/20 to-teal-500/20 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:from-cyan-500/30 hover:to-teal-500/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Pricing…" : "Get server-priced quote"}
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Quote</p>
              {!quote ? (
                <p className="mt-3 text-sm text-slate-400">
                  {selectedService
                    ? `${selectedService.name} at ${selectedService.unitPriceBnb} BNB/job (set by the catalog, never by the client).`
                    : "Select a service to price it."}
                </p>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Amount ({quote.asset})</span>
                    <span className="font-medium text-white">{(BigInt(quote.amountWei) / 10n ** 18n).toString()} {quote.asset}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">BNB equivalent</span>
                    <span className="font-medium text-white">{(BigInt(quote.priceBnbWei) / 10n ** 18n).toString()} BNB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Platform margin</span>
                    <span className="text-slate-200">{(BigInt(quote.platformFeeBnbWei) / 10n ** 18n).toString()} BNB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Service cost</span>
                    <span className="text-slate-200">{(BigInt(quote.serviceCostBnbWei) / 10n ** 18n).toString()} BNB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Payment status</span>
                    <span className="uppercase tracking-wider text-slate-200">{payment?.status || quote.status}</span>
                  </div>
                  <p className="border-t border-white/10 pt-3 text-xs text-slate-500">
                    Price is cached in a signed payload ({quote.payloadHash.slice(0, 12)}…) and cannot be tampered with.
                  </p>
                  <button
                    onClick={handleCreateJob}
                    disabled={busy}
                    className="w-full rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? "Creating job…" : "Accept quote + create job"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-[28px] p-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">My compute jobs</h2>
              <p className="mt-1 text-sm text-slate-400">
                Jobs run only after an admin verifies the payment — then the job&apos;s revenue funds a contributor reward.
              </p>
            </div>
            <button
              onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}
              className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/5"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {jobs.length === 0 && <p className="text-sm text-slate-400">No compute jobs yet.</p>}
              {jobs.map((job) => {
                const tone = JOB_TONES[job.status] || JOB_TONES.DRAFT;
                return (
                  <div key={job.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {job.inputText || job.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {job.agent} · {formatTime(job.createdAt)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-wider ${tone}`}>
                        {runnerStatus(job)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(job.status === "PENDING" || job.status === "FAILED") && (
                        <button
                          onClick={() => handleRun(job)}
                          disabled={busy}
                          className="rounded-xl border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Run job
                        </button>
                      )}
                      <button
                        onClick={() => { void openDetail(job.id); }}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/5"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Job detail</p>
              {!detail?.job ? (
                <p className="mt-3 text-sm text-slate-400">Select a job to inspect its output, hash, and revenue state.</p>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status</span>
                    <span className="uppercase tracking-wider text-white">{detail.job.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Monetized revenue</span>
                    <span className="text-white">{detail.job.economicValueBnb ?? "0"} BNB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Verified</span>
                    <span className="text-white">{detail.job.revenueEventId ? "yes" : "no"}</span>
                  </div>
                  {detail.job.output && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Output hash</span>
                        <span className="font-mono text-[11px] text-emerald-200">{detail.job.output.resultHash.slice(0, 16)}…</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Size</span>
                        <span className="text-white">{detail.job.output.sizeBytes} bytes</span>
                      </div>
                    </>
                  )}
                  {detail.revenueEvent && (
                    <div className="border-t border-white/10 pt-3">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Revenue event</span>
                        <span className={detail.revenueEvent.simulated ? "text-amber-200" : "text-emerald-200"}>
                          {detail.revenueEvent.simulated ? "SIMULATED" : "REAL"} · {detail.revenueEvent.asset}
                        </span>
                      </div>
                    </div>
                  )}
                  {detail.job.failureReason && (
                    <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                      {detail.job.failureReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.section>

        <p className="text-center text-xs text-slate-600">
          Builds {user ? user.username : "a seamless compute-to-revenue experience"} — server-priced, payment-verified, revenue-backed.
        </p>
      </main>
      <BottomNav />
      <PageFooter />
    </div>
  );
}