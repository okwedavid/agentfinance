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

import { createHmac, randomUUID } from 'node:crypto';
import prisma from '../../prismaClient.js';
import {
  computeDemoMode,
  computeEconomyEnabled,
} from './config.js';
import { toUnits } from '../../utils/decimal.js';

export const VERIFICATION_TYPE = Object.freeze({
  SIMULATED: 'SIMULATED',
  MANUAL_CERT: 'MANUAL_CERT',
});

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
    return { ok: true, verificationType: VERIFICATION_TYPE.SIMULATED, simulated: true };
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
  return { ok: true, verificationType: VERIFICATION_TYPE.MANUAL_CERT, simulated: false, attestation };
}

// ── Adapter: refund ──────────────────────────────────────────────────────────

/**
 * Refund an un-settled payment intent. Rejected once verified/settled so a
 * refund can never walk back already-booked revenue.
 */
export async function refundPayment({ paymentIntentId, note = null }) {
  const existing = await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
  if (!existing) throw Object.assign(new Error('Payment intent not found.'), { status: 404 });
  if (existing.status !== 'PENDING') {
    throw Object.assign(new Error(`A ${existing.status} payment cannot be refunded.`), { status: 409 });
  }
  return prisma.paymentIntent.update({
    where: { id: paymentIntentId },
    data: { status: 'REFUNDED', note: note || 'Refunded before settlement.' },
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