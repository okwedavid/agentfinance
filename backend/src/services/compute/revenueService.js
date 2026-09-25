// revenueService.js — monetization booking: PaymentIntent -> RevenueEvent ->
// RevenueAllocation -> RewardPool funding, atomically.
//
// The ONLY writer of RevenueEvent / RevenueAllocation rows. Runs at
// SERIALIZABLE isolation so concurrent verifications can never lose an update
// or double-book a payment. Money that reaches RewardPool.fundedBnb passes
// exclusively through fundPoolFromRevenueTx inside this transaction.

import { Prisma } from '@prisma/client';
import prisma from '../../prismaClient.js';
import logger from '../../utils/logger.js';
import { toUnits, fromUnits, add } from '../../utils/decimal.js';
import {
  rewardFundingFromRevenueBnbWei,
  toBnbWei,
  computeDemoMode,
} from './config.js';
import { verifyPaymentPolicy } from './customerPaymentMonetizer.js';
import { fundPoolFromRevenueTx } from '../rewardService.js';

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 8000,
  timeout: 12000,
};

function moneyError(message, status, payload = null) {
  return Object.assign(new Error(message), { status, ...(payload ? { payload } : {}) });
}

/**
 * Verify a payment intent, book its RevenueEvent + allocations, and credit the
 * reward pool — all in one transaction. Idempotent per payment intent.
 *
 * @returns {{revenueEvent:any, allocations:any[], rewardFundingBnb:string, platformBnb:string, simulated:boolean, idempotent?:boolean}}
 */
export async function bookRevenueFromVerifiedPayment({ paymentIntentId, requestedBy, actorRole, attestation = null }) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw moneyError('Payment intent not found.', 404);

    const quote = await tx.computeQuote.findUnique({ where: { id: intent.quoteId } });
    if (!quote) throw moneyError('Payment intent references an unknown quote.', 409);

    const existing = await tx.revenueEvent.findFirst({ where: { paymentIntentId: intent.id } }).catch(() => null);
    if (existing) {
      const allocations = await tx.revenueAllocation.findMany({ where: { revenueEventId: existing.id } });
      return { revenueEvent: existing, allocations, simulated: existing.simulated, idempotent: true };
    }

    const job = await tx.computeJob.findUnique({ where: { quoteId: quote.id } }).catch(() => null);
    if (!job) {
      throw moneyError(
        'Create the compute job (POST /api/compute/jobs) before verifying its payment.',
        409,
      );
    }

    const verdict = verifyPaymentPolicy({ paymentIntent: intent, actorRole });
    if (!verdict.ok) throw moneyError(verdict.error, verdict.status || 403);

    if (verdict.verificationType === 'MANUAL_CERT') {
      const expected = verdict.attestation;
      if (!expected) throw moneyError('Attestation is not computable (operator secret missing).', 503);
      if (!attestation || String(attestation).trim() !== expected) {
        throw moneyError('Attestation mismatch. Real payment verification failed.', 403);
      }
    }

    const bnbWei = toBnbWei(intent.amountWei, intent.asset, intent.priceBnbPerUnit);
    if (bnbWei <= 0n) throw moneyError('Payment has no BNB-equivalent value.', 422);

    const rewardFundingWei = rewardFundingFromRevenueBnbWei(bnbWei);
    const platformWei = bnbWei - rewardFundingWei;
    const simulated = verdict.simulated === true;

    // Asset-unit split of the payment, proportional to the BNB split (floor).
    // stored amountWei is a raw integer (wei/minor-units), parsed with BigInt.
    const amountAssetWei = BigInt(intent.amountWei);
    const rewardFundingAssetWei = (amountAssetWei * rewardFundingWei) / bnbWei;
    const platformAssetWei = amountAssetWei - rewardFundingAssetWei;

    let revenueEvent;
    try {
      revenueEvent = await tx.revenueEvent.create({
        data: {
          jobId: job.id,
          paymentIntentId: intent.id,
          asset: intent.asset,
          amountWei: intent.amountWei,
          bnbEquivalentWei: String(bnbWei),
          source: 'COMPUTE_JOB',
          monetizerType: 'CUSTOMER_PAYMENT',
          external: true,
          simulated,
          status: 'BOOKED',
        },
      });
    } catch (error) {
      // A racing verification inserted the unique paymentIntentId first.
      // SERIALIZABLE abort / P2002 == idempotent: re-read and report the winner.
      if (String(error?.code) === 'P2002' || /Unique constraint/.test(String(error?.message))) {
        const existing = await tx.revenueEvent.findFirst({ where: { paymentIntentId: intent.id } }).catch(() => null);
        if (existing) {
          const allocations = await tx.revenueAllocation.findMany({ where: { revenueEventId: existing.id } });
          return { revenueEvent: existing, allocations, simulated: existing.simulated, idempotent: true };
        }
      }
      throw error;
    }

    await tx.revenueAllocation.create({
      data: {
        revenueEventId: revenueEvent.id,
        allocationType: 'REWARD_FUNDING',
        asset: intent.asset,
        amountWei: String(rewardFundingAssetWei),
        bnbEquivalentWei: String(rewardFundingWei),
        simulated,
      },
    });
    await tx.revenueAllocation.create({
      data: {
        revenueEventId: revenueEvent.id,
        allocationType: 'PLATFORM',
        asset: intent.asset,
        amountWei: String(platformAssetWei),
        bnbEquivalentWei: String(platformWei),
        simulated,
      },
    });

    await fundPoolFromRevenueTx(tx, {
      amountBnb: fromUnits(rewardFundingWei, 8),
      reference: revenueEvent.id,
      simulated,
      confirmedBy: requestedBy,
      note: 'Verified compute revenue -> reward funding.',
    });

    await tx.computeJob.update({
      where: { id: job.id },
      data: {
        revenueEventId: revenueEvent.id,
        economicValueBnb: fromUnits(bnbWei, 8),
        status: 'PENDING',
      },
    });

    const settled = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: requestedBy,
        settledAt: new Date(),
        note: `Verified via ${verdict.verificationType}.`,
      },
    });

    const allocations = await tx.revenueAllocation.findMany({ where: { revenueEventId: revenueEvent.id } });

    logger.info(
      `[compute] revenue booked intent=${intent.id} asset=${intent.asset} amount=${intent.amountWei} bnb=${fromUnits(bnbWei, 8)} funding=${fromUnits(rewardFundingWei, 8)} simulated=${simulated}`,
    );

    return {
      revenueEvent,
      allocations,
      rewardFundingBnb: fromUnits(rewardFundingWei, 8),
      platformBnb: fromUnits(platformWei, 8),
      simulated,
      settled,
      idempotent: false,
    };
  }, TX_OPTIONS);
}

// ── Report / admin aggregation ───────────────────────────────────────────────

function assetRowsWei(rows, field = 'bnbEquivalentWei') {
  let wei = 0n;
  for (const row of rows) wei = add(wei, toUnits(row[field] || '0'));
  return wei;
}

// Stored raw wei fields (bnbEquivalentWei) are exact integer strings: sum with
// BigInt(), never toUnits() (which scales decimal tokens by 1e18).
function rawWeiRowsSum(rows, field = 'bnbEquivalentWei') {
  let wei = 0n;
  for (const row of rows) wei += BigInt(row?.[field] || '0');
  return wei;
}

export function computeEconomySummary({ revenueEvents, allocations, computeJobs, computeRewardEvents, costs }) {
  const jobs = computeJobs || [];
  const events = revenueEvents || [];
  const rewards = computeRewardEvents || [];

  const realEvents = events.filter((e) => !e.simulated);
  const simulatedEvents = events.filter((e) => e.simulated);

  const realRevenueWei = rawWeiRowsSum(realEvents);
  const simulatedRevenueWei = rawWeiRowsSum(simulatedEvents);
  const totalRevenueWei = realRevenueWei + simulatedRevenueWei;

  const rewardFundingWei = rawWeiRowsSum((allocations || []).filter((a) => a.allocationType === 'REWARD_FUNDING' && !a.simulated));
  const simulatedRewardFundingWei = rawWeiRowsSum((allocations || []).filter((a) => a.allocationType === 'REWARD_FUNDING' && a.simulated));
  const platformWei = rawWeiRowsSum((allocations || []).filter((a) => a.allocationType === 'PLATFORM'));

  const costWei = assetRowsWei(costs || [], 'amountWei');
  const rewardWei = assetRowsWei(rewards, 'rewardAmountBnb');

  return {
    totalJobs: jobs.length,
    monetizedJobs: jobs.filter((j) => j.revenueEventId).length,
    revenueEvents: events.length,
    realRevenueBnb: fromUnits(realRevenueWei, 8),
    simulatedRevenueBnb: fromUnits(simulatedRevenueWei, 8),
    totalRevenueBnb: fromUnits(totalRevenueWei, 8),
    realRewardFundingBnb: fromUnits(rewardFundingWei, 8),
    simulatedRewardFundingBnb: fromUnits(simulatedRewardFundingWei, 8),
    platformBnb: fromUnits(platformWei, 8),
    computeCostBnb: fromUnits(costWei, 8),
    computeRewardsBnb: fromUnits(rewardWei, 8),
    // Hard rule restated explicitly in every surface: cost is a cost, never revenue.
    revenueNeverEqualToComputeCost: totalRevenueWei > 0n && totalRevenueWei !== costWei,
  };
}

export async function getComputeEconomyOverview() {
  const [
    computeJobs,
    revenueEvents,
    allocations,
    computeRewardEvents,
    costs,
    payments,
    computeFundingEvents,
  ] = await Promise.all([
    prisma.computeJob.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.revenueEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.revenueAllocation.findMany({ take: 1000 }),
    prisma.rewardEvent.findMany({ where: { rewardType: 'COMPUTE_JOB_REVENUE' }, take: 500 }),
    prisma.computeCost.findMany({ take: 1000 }),
    prisma.paymentIntent.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.poolFundingEvent.findMany({ where: { sourceType: 'COMPUTE_REVENUE' }, orderBy: { createdAt: 'desc' }, take: 500 }),
  ]);

  return {
    summary: computeEconomySummary({ revenueEvents, allocations, computeJobs, computeRewardEvents, costs }),
    revenueEvents,
    allocations,
    payments,
    computeJobs,
    computeRewardEvents,
    computeFundingEvents,
    demoMode: computeDemoMode(),
  };
}

export { TX_OPTIONS };