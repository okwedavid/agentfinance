// customerPaymentMonetizer.js — CustomerPaymentMonetizer (MonetizationAdapter).
//
// The first real monetizer: an external customer pays a server-priced quote.
// Money becomes "revenue" only at the moment verifyPayment succeeds, and only
// verification binds it to a RevenueEvent (revenueService owns that write).
//
// MonetizationAdapter contract (kept for future monetizers):
//   quote(service, asset)                                     -> quote data
//   submit(payment)                                           -> payment row
//   verify(payment, ctx) -> {ok, verificationType, simulated} -> policy verdict
//   settle(payment)
//   refund(payment)
//
// Verification policy:
//   SIMULATED   - COMPUTE_ECONOMY_DEMO_MODE on, any ADMIN. Tagged SIMULATED.
//   MANUAL_CERT - SUPER_ADMIN + HMAC attestation over "{id}:{amountWei}" using
//                 COMPUTE_PAYMENT_CERT_SECRET. Production real-money path.
//
// ── J1.2 TRUTH CORRECTION ────────────────────────────────────────────────────
// MANUAL_CERT is an OPERATOR_ASSERTED payment, not externally verified revenue,
// and the naming never made that obvious. The HMAC proves the operator who owns
// COMPUTE_PAYMENT_CERT_SECRET signed off — it is a self-referential attestation
// produced by the same trust domain it purports to confirm. It establishes
// INTENT, never RECEIPT of funds. It is not evidence that any external actor
// transferred anything, and it must never be counted as external revenue.
//
// The stored value stays MANUAL_CERT for backwards compatibility; the true
// economic class is derived through VERIFICATION_METHOD so that every caller
// reads OPERATOR_ASSERTED rather than having to re-derive it (and so that no
// future reader mistakes the column name for an independent check).
// EXTERNAL_VERIFIED is reserved for a verifier living outside this platform and
// is not producible here.

import { createHmac, randomUUID } from 'node:crypto';
import prisma from '../../prismaClient.js';
import {
  computeDemoMode,
  computeEconomyEnabled,
} from './config.js';
import { toUnits } from '../../utils/decimal.js';
import {
  VERIFICATION_METHOD,
  verificationMethodFor,
  isVerifiedExternalRevenue,
} from '../moneySemantics.js';
import { unwindRevenueBookingTx } from './jobService.js';

export const VERIFICATION_TYPE = Object.freeze({
  SIMULATED: 'SIMULATED',
  MANUAL_CERT: 'MANUAL_CERT',
});

/**
 * The honest economic class of a stored verification type. Exported so routes
 * and the revenue service can never accidentally treat MANUAL_CERT as external
 * proof.
 */
export { VERIFICATION_METHOD, verificationMethodFor, isVerifiedExternalRevenue };

/** Human-facing wording for a verification type. Never says "verified payment". */
export function verificationLabel(verificationType, simulated = false) {
  return verificationMethodFor(verificationType, simulated) === VERIFICATION_METHOD.SIMULATED
    ? 'Simulated — no money was transferred'
    : 'Operator-asserted — the platform owner declared this payment; not independent proof of funds';
}

export function paymentAttestation(paymentIntent) {
  const secret = (process.env.COMPUTE_PAYMENT_CERT_SECRET || '').trim();
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(`${paymentIntent.id}:${String(paymentIntent.amountWei)}`)
    .digest('hex');
}

export function requireComputeEconomy() {
  if (!computeEconomyEnabled()) {
    throw Object.assign(new Error('Compute economy is disabled.'), { status: 503 });
  }
}

function isAdminRole(role) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

// ── Adapter: quote ───────────────────────────────────────────────────────────

/**
 * Persist a PaymentIntent for an accepted quote. Verification type is fixed at
 * creation time: simulation never becomes real, and real never becomes a
 * simulation.
 */
export async function createPaymentIntentFromQuote({ quote, note = null }) {
  requireComputeEconomy();
  const simulated = computeDemoMode();
  return prisma.paymentIntent.create({
    data: {
      quoteId: quote.id,
      asset: quote.asset,
      amountWei: quote.amountWei,
      priceBnbPerUnit: quote.priceBnbPerUnit || null,
      status: 'PENDING',
      verificationType: simulated ? VERIFICATION_TYPE.SIMULATED : VERIFICATION_TYPE.MANUAL_CERT,
      external: true,
      payerLabel: simulated ? 'SIMULATED_CUSTOMER' : null,
      note,
    },
  });
}

// ── Adapter: submit / verify / settle / refund ───────────────────────────────

/**
 * Customer "sends" payment. Persists payer/tx metadata; does NOT verify money.
 */
export async function submitPayment({ paymentIntentId, payerLabel = null, txHash = null, customerId = null }) {
  requireComputeEconomy();
  const existing = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
  if (!existing) throw Object.assign(new Error('Payment intent not found.'), { status: 404 });
  if (existing.status !== 'PENDING') return existing;

  return prisma.paymentIntent.update({
    where: { id: paymentIntentId },
    data: {
      payerLabel: payerLabel || existing.payerLabel,
      txHash: txHash || existing.txHash,
      customerId: customerId || existing.customerId,
    },
  });
}

/**
 * Policy verdict for a payment intent. NEVER persists by itself — the caller
 * (revenueService) applies the verdict atomically with the RevenueEvent.
 */
export function verifyPaymentPolicy({ paymentIntent, actorRole }) {
  if (!paymentIntent || paymentIntent.status !== 'PENDING') {
    return { ok: false, error: 'Only PENDING payment intents can be verified.', status: 409 };
  }
  if (!isAdminRole(actorRole)) {
    return { ok: false, error: 'Admin role required to verify payments.', status: 403 };
  }

  if (paymentIntent.verificationType === VERIFICATION_TYPE.SIMULATED) {
    if (!computeDemoMode()) {
      return { ok: false, error: 'Simulated payment intents are only permitted in COMPUTE_ECONOMY_DEMO_MODE.', status: 422 };
    }
    return {
      ok: true,
      verificationType: VERIFICATION_TYPE.SIMULATED,
      verificationMethod: VERIFICATION_METHOD.SIMULATED,
      simulated: true,
    };
  }

  if (actorRole !== 'SUPER_ADMIN') {
    return { ok: false, error: 'Only the owner (SUPER_ADMIN) can verify real external payments.', status: 403 };
  }
  const attestation = paymentAttestation(paymentIntent);
  if (!attestation) {
    return {
      ok: false,
      error: 'Real payment verification requires COMPUTE_PAYMENT_CERT_SECRET to be configured by the operator.',
      status: 503,
    };
  }
  // Note the verdict carries verificationMethod, not just the legacy column
  // value: the outcome is an operator assertion. Callers must persist
  // OPERATOR_ASSERTED, never EXTERNAL_VERIFIED.
  return {
    ok: true,
    verificationType: VERIFICATION_TYPE.MANUAL_CERT,
    verificationMethod: VERIFICATION_METHOD.OPERATOR_ASSERTED,
    simulated: false,
    attestation,
    evidenceNote:
      'Signed by the platform owner (SUPER_ADMIN). Self-referential attestation: it records operator ' +
      'intent, not receipt of funds from an external party.',
  };
}

// ── Adapter: refund ──────────────────────────────────────────────────────────

/**
 * Refund a payment intent and unwind every economic record it created.
 *
 * A payment reaches the revenue ledger through two separate tables: the
 * `PaymentIntent` and the `RevenueEvent` booked when the job started. Refunding
 * only the intent leaves the booked revenue and the pool funding it produced in
 * place, so the pool keeps money that was never paid. Any consumed intent is
 * therefore unwound transactionally, and intents whose job already completed
 * are refused outright.
 */
export async function refundPayment({ paymentIntentId, note = null, requestedBy = null }) {
  const existing = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
  if (!existing) throw Object.assign(new Error('Payment intent not found.'), { status: 404 });
  if (existing.status === 'REFUNDED') {
    // Idempotent: a repeated refund must not unwind a booking twice.
    return existing;
  }
  if (existing.status === 'SETTLED') {
    throw Object.assign(new Error('A settled payment has already funded settled payouts and cannot be refunded here.'), { status: 409 });
  }

  // ComputeJob links to the intent through the frozen quote id, which is unique
  // on PaymentIntent. There is no direct paymentIntentId column on the job.
  const jobs = await prisma.computeJob.findMany({
    where: { quoteId: existing.quoteId },
    select: { id: true, status: true, revenueEventId: true },
  });
  if (jobs.some((job) => job.status === 'COMPLETED')) {
    throw Object.assign(
      new Error('This payment funded a completed job, so its reward was already credited. Refund is not permitted.'),
      { status: 409 },
    );
  }

  const refundNote = note || 'Refunded before settlement.';

  return prisma.$transaction(async (tx) => {
    for (const job of jobs) {
      if (!job.revenueEventId) continue;
      const unwind = await unwindRevenueBookingTx(tx, {
        revenueEventId: job.revenueEventId,
        jobId: job.id,
        requestedBy,
        reason: refundNote,
      });
      await tx.computeJob.update({
        where: { id: job.id },
        data: {
          revenueEventId: null,
          failureReason: `${refundNote} Unwound ${unwind?.fundingReturnedBnb || '0'} BNB of pool funding.`,
        },
      });
    }

    return tx.paymentIntent.update({
      where: { id: paymentIntentId },
      data: { status: 'REFUNDED', note: refundNote },
    });
  });
}

export { randomUUID };

// Helper for tests / future wallet-based verification: immutable frozen quote
// binding (nothing client-provided ever enters the money path).
export function freezePaymentAmount(amountWei) {
  const raw = String(amountWei).trim();
  const wei = /^\d+$/.test(raw) ? BigInt(raw) : toUnits(raw);
  return {
    amountWei: raw,
    ok: wei > 0n,
  };
}