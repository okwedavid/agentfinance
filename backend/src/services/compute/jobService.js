// jobService.js — ComputeJob lifecycle within the compute-to-revenue slice.
//
//   DRAFT (created for an accepted quote, unpaid)
//   PENDING (quote PAID + payment verified -> revenue booked, ready to run)
//   RUNNING -> COMPLETED | FAILED | REFUNDED
//
// Money rules:
//   - A job may only RUN once its quote is PAID and its payment VERIFIED
//     (revenueEventId present). Unmonetized jobs book zero reward.
//   - Output is hashed (sha256), cost is recorded (cost != revenue), and the
//     contributor reward equals the job's REWARD_FUNDING allocation exactly.
//   - The underlying agent Task is created for traceability but NEVER booked a
//     task reward (createRewardForTask is not invoked; reward is revenue-backed
//     and idempotent by RewardEvent.computeJobId).

import { randomUUID, createHash } from 'node:crypto';
import prisma from '../../prismaClient.js';
import logger from '../../utils/logger.js';
import { toUnits, fromUnits, sub, clampNonNegative } from '../../utils/decimal.js';
import { createRewardForComputeJob } from '../rewardService.js';
import { verifyQuoteBindings, quoteAmountCoversPrice } from './pricingEngine.js';
import { recordTokenUsage } from '../tokenUsage.js';
import { fleetComputeRunner } from './registry.js';

const MAX_REQUEST_LENGTH = 4000;

function inputError(message, status = 400, payload = null) {
  return Object.assign(new Error(message), { status, ...(payload ? { payload } : {}) });
}

export function validateComputeRequest(inputText) {
  if (typeof inputText !== 'string' || !inputText.trim()) {
    throw inputError('A compute request is required.', 400);
  }
  if (inputText.length > MAX_REQUEST_LENGTH) {
    throw inputError(`Compute request is too long (max ${MAX_REQUEST_LENGTH} characters).`, 400);
  }
  return inputText.trim();
}

/**
 * Create the DRAFT ComputeJob for an accepted quote. Idempotent per quote.
 * The customer request is captured here (inputText) so the quote-to-run chain
 * is fully traceable.
 *
 * J1.7: the quote is re-verified against its own signed payload before any job
 * exists. A job created from a tampered quote would book a reward from an
 * amount the server never priced, so the binding check now happens on the write
 * path instead of existing only as an unused helper.
 */
export async function createComputeJobFromAcceptedQuote({ quoteId, sellerUserId, payerUserId = null, inputText }) {
  const request = validateComputeRequest(inputText);

  const quote = await prisma.computeQuote.findUnique({ where: { id: quoteId } });
  if (!quote) throw inputError('Quote not found.', 404);
  if (quote.status === 'REFUNDED') throw inputError('The quote was refunded and cannot be used.', 410);
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    throw inputError('Quote has expired. Request a new quote.', 410);
  }

  // Reject a quote whose stored numbers no longer hash to its own payloadHash,
  // and whose charged amount would no longer cover the server-priced BNB value.
  if (!verifyQuoteBindings(quote)) {
    logger.error(`[compute] quote ${quoteId} failed payload binding verification; refusing to create a job.`);
    throw inputError('Quote integrity check failed. Request a new quote.', 409);
  }
  if (!quoteAmountCoversPrice(quote)) {
    logger.error(
      `[compute] quote ${quoteId} charges ${quote.amountWei} ${quote.asset}, which no longer covers `
      + `the server price of ${quote.priceBnbWei} BNB; refusing to create a job.`,
    );
    throw inputError('Quote amount verification failed. Request a new quote.', 409);
  }

  const existing = await prisma.computeJob.findUnique({ where: { quoteId } }).catch(() => null);
  if (existing) {
    return prisma.computeJob.update({ where: { id: existing.id }, data: { inputText: existing.inputText || request } });
  }

  const service = await prisma.serviceCatalog.findUnique({ where: { id: quote.serviceId } });
  if (!service || service.enabled === false) throw inputError('The quoted service is unavailable.', 409);

  // Payer and reward recipient must be distinct parties. When they are the same
  // identity, the "reward" is the payer's own money returning to them, so the job
  // is refused instead of booked as earned revenue.
  const payer = payerUserId || quote.userId;
  if (sellerUserId && payer === sellerUserId) {
    logger.error(
      `[compute] refusing to create job for quote ${quoteId}: payer ${payer} is also the reward recipient.`,
    );
    throw inputError(
      'Self-payment is not permitted: the party paying for a job cannot be the party rewarded for it.',
      409,
    );
  }

  const job = await prisma.computeJob.create({
    data: {
      quoteId: quote.id,
      serviceId: quote.serviceId,
      sellerUserId,
      payerUserId: payer,
      inputText: request,
      agent: service.agent || 'general',
      status: 'DRAFT',
      expectedPriceBnbWei: quote.priceBnbWei,
    },
  });

  await prisma.computeQuote.update({ where: { id: quote.id }, data: { status: 'PAID' } });

  return job;
}

/**
 * Execute a monetized job on the fleet, persist output + cost, and finalize the
 * contributor reward. `runner` is injectable so tests run deterministic fakes.
 * Returns the job with output and reward event attached.
 */
export async function runComputeJob({ job, runner = fleetComputeRunner, publish = async () => {} }) {
  if (!job || !job.id) throw inputError('Job not found.', 404);
  if (!job.revenueEventId) {
    throw inputError('This job is not monetized yet. Verify its payment before running it.', 409);
  }

  const emit = async (type, data) => {
    try {
      await publish(type, data);
    } catch {
      /* best effort */
    }
  };

  const running = await prisma.computeJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  }).catch((error) => {
    logger.error(`[compute] failed to mark job running ${error.message}`);
    return job;
  });

  await emit('compute:job:running', { id: job.id, status: 'RUNNING' });

  let run;
  try {
    run = await runner({ inputText: job.inputText, jobId: job.id });
  } catch (error) {
    const failed = await prisma.computeJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        failureReason: String(error?.message || 'Agent could not complete the compute job.').slice(0, 500),
        failureType: 'agent_execution',
      },
    });
    await emit('compute:job:failed', { id: job.id, status: 'FAILED' });
    return { job: failed };
  }

  const outputText = String(run.output || '').trim();
  if (!outputText) {
    const failed = await prisma.computeJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', completedAt: new Date(), failureReason: 'The job produced no output.', failureType: 'empty_output' },
    });
    await emit('compute:job:failed', { id: job.id, status: 'FAILED' });
    return { job: failed };
  }

  const resultHash = createHash('sha256').update(outputText).digest('hex');
  const sizeBytes = Buffer.byteLength(outputText, 'utf8');

  // Record the inference usage behind this job. A COST of serving the job,
  // never revenue: book it so the platform can state what delivering this work
  // cost, and keep it strictly separate from the revenue it was paid.
  if (run.usage) {
    void recordTokenUsage({ model: run.model || null, usage: run.usage, taskId: null }).catch(() => {});
  }

  // Traceability: materialize an agent Task row (never reward-scanned).
  const taskId = randomUUID();
  await prisma.task.create({
    data: {
      id: taskId,
      agentId: `agent-${job.agent}`,
      userId: job.sellerUserId,
      action: job.inputText,
      status: 'completed',
      completedAt: new Date(),
      result: JSON.stringify({
        output: outputText.slice(0, 8000),
        summary: outputText.slice(0, 1200),
        provider: run.provider,
        model: run.model || null,
        compute: true,
        computeJobId: job.id,
      }),
    },
  });

  await prisma.computeOutput.create({
    data: { jobId: job.id, resultText: outputText, resultHash, sizeBytes, engine: 'agent-fleet' },
  });

  const quote = await prisma.computeQuote.findUnique({ where: { id: job.quoteId } });
  const recordedCostWei = BigInt(quote?.serviceCostBnbWei || job.expectedPriceBnbWei);
  await prisma.computeCost.create({
    data: {
      jobId: job.id,
      costAsset: 'BNB',
      amountWei: fromUnits(recordedCostWei, 8),
      costKind: 'INFERENCE',
      source: 'INTERNAL',
    },
  });

  const completed = await prisma.computeJob.update({
    where: { id: job.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  await emit('compute:job:completed', {
    id: job.id,
    status: 'COMPLETED',
    outputHash: resultHash,
    sizeBytes,
    provider: run.provider,
    model: run.model || null,
    agent: run.agent || job.agent,
  });

  // Revenue-backed contributor reward = the job's REWARD_FUNDING allocation.
  const rewardEvent = await finalizeComputeJob({ jobId: job.id });

  return { job: { ...completed, output: { resultHash, sizeBytes, provider: run.provider, model: run.model || null } }, rewardEvent };
}

/**
 * Book the contributor reward for a COMPLETED, monetized job. Exact amount:
 * the job's REWARD_FUNDING allocation (bnbEquivalentWei). Idempotent.
 */
export async function finalizeComputeJob({ jobId }) {
  const job = await prisma.computeJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'COMPLETED' || !job.completedAt) return null;

  const allocation = await prisma.revenueAllocation.findFirst({
    where: { revenueEventId: job.revenueEventId, allocationType: 'REWARD_FUNDING' },
  }).catch(() => null);
  if (!allocation) {
    logger.warn(`[compute] compute job ${jobId} completed without a REWARD_FUNDING allocation; no reward booked.`);
    return null;
  }

  return createRewardForComputeJob({
    job: { ...job, status: 'COMPLETED', completedAt: job.completedAt },
    rewardAmountBnb: fromUnits(BigInt(allocation.bnbEquivalentWei), 8),
  });
}

/**
 * Refund path: reverses an un-settled booking at the job level (used when a
 * payment is refunded before settlement). Never touches booked/withdrawn money.
 *
 * Phase 0 (J1.5): the only caller of this function never existed, so refunding
 * a payment left the economic trail behind — the RevenueEvent stayed BOOKED,
 * its allocations stayed split, and the pool funding it created was never
 * returned. A refund that does not unwind its own allocations is a refund that
 * only changes a label. `unwindRevenueBookingTx` performs the actual reversal.
 */
export async function markComputeJobRefunded({ jobId, reason = null, requestedBy = null }) {
  const job = await prisma.computeJob.findUnique({ where: { id: jobId } });
  if (!job) throw inputError('Job not found.', 404);
  if (job.status === 'COMPLETED') {
    throw inputError('A completed job cannot be refunded.', 409);
  }
  if (job.status === 'REFUNDED') {
    // Idempotent: a repeated refund must not unwind the booking twice.
    return job;
  }

  const note = reason ? String(reason).slice(0, 500) : 'Refunded before settlement.';

  // The job status change and the revenue unwind must commit together. A refund
  // that marks the job refunded and then fails to unwind would leave the pool
  // credited by a booking nobody paid for — exactly the false-revenue state this
  // function exists to prevent.
  return prisma.$transaction(async (tx) => {
    const updated = await tx.computeJob.update({
      where: { id: jobId },
      data: { status: 'REFUNDED', failureReason: note },
    });

    if (job.revenueEventId) {
      const unwind = await unwindRevenueBookingTx(tx, {
        revenueEventId: job.revenueEventId,
        jobId,
        requestedBy,
        reason: note,
      });
      // Drop the pointer so nothing reads a live booking from a refunded job.
      // The audit trail lives on the revenue event, its allocations and the
      // funding event, all of which the unwind just reversed.
      await tx.computeJob.update({
        where: { id: jobId },
        data: { revenueEventId: null, failureReason: `${note} Unwound ${unwind?.fundingReturnedBnb || '0'} BNB of pool funding.` },
      });
    }

    return updated;
  });
}

/**
 * Unwind a booked revenue event when its payment is refunded.
 *
 * Must run inside the caller's transaction. Idempotent: an event that is no
 * longer BOOKED is left alone, so a repeated refund can never double-credit or
 * double-debit the pool.
 *
 * The amount returned to the pool is the event's REWARD_FUNDING allocation
 * exactly. It is debited from `fundedBnb`, which can legitimately take the pool
 * below `generatedBnb` — that is correct, and it is the honest consequence of
 * unwinding a booking that was never really backed.
 */
export async function unwindRevenueBookingTx(tx, { revenueEventId, jobId, requestedBy = null, reason = null }) {
  const event = await tx.revenueEvent.findUnique({ where: { id: revenueEventId } });
  if (!event) return null;
  if (event.status !== 'BOOKED') {
    logger.warn(`[compute] revenue event ${revenueEventId} is ${event.status}; no unwind performed.`);
    return null;
  }

  const allocation = await tx.revenueAllocation.findFirst({
    where: { revenueEventId, allocationType: 'REWARD_FUNDING' },
  });
  const fundingWei = allocation ? BigInt(allocation.bnbEquivalentWei || '0') : 0n;
  if (fundingWei <= 0n) {
    await tx.revenueEvent.update({ where: { id: revenueEventId }, data: { status: 'REFUNDED' } });
    return { revenueEventId, fundingReturnedBnb: '0' };
  }

  const pool = await tx.rewardPool.findFirst({ orderBy: { id: 'asc' } })
    || await tx.rewardPool.create({ data: { id: 'GLOBAL' } });
  const fundedNext = sub(toUnits(pool.fundedBnb || '0'), fundingWei);
  await tx.rewardPool.update({
    where: { id: pool.id },
    data: { fundedBnb: fromUnits(clampNonNegative(fundedNext), 8) },
  });

  // Mark the funding event itself so the composition report stops counting it.
  await tx.poolFundingEvent.updateMany({
    where: { reference: revenueEventId, status: 'CONFIRMED' },
    data: { status: 'REVERSED', note: `Reversed: ${reason || 'payment refunded'}` },
  });

  await tx.revenueAllocation.updateMany({
    where: { revenueEventId },
    data: { status: 'REVERSED' },
  });
  await tx.revenueEvent.update({ where: { id: revenueEventId }, data: { status: 'REFUNDED' } });

  if (jobId) {
    await tx.rewardEvent.updateMany({
      where: { computeJobId: jobId, status: 'CREDITED' },
      data: { status: 'REVERSED' },
    });
  }

  logger.info(
    `[compute] revenue booking unwound event=${revenueEventId} job=${jobId || 'n/a'} `
      + `returned=${fromUnits(fundingWei, 8)} requestedBy=${requestedBy || 'system'}`,
  );

  return { revenueEventId, fundingReturnedBnb: fromUnits(fundingWei, 8) };
}