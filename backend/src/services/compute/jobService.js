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
import { toUnits, fromUnits } from '../../utils/decimal.js';
import { createRewardForComputeJob } from '../rewardService.js';
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
 */
export async function createComputeJobFromAcceptedQuote({ quoteId, sellerUserId, inputText }) {
  const request = validateComputeRequest(inputText);

  const quote = await prisma.computeQuote.findUnique({ where: { id: quoteId } });
  if (!quote) throw inputError('Quote not found.', 404);
  if (quote.status === 'REFUNDED') throw inputError('The quote was refunded and cannot be used.', 410);
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    throw inputError('Quote has expired. Request a new quote.', 410);
  }

  const existing = await prisma.computeJob.findUnique({ where: { quoteId } }).catch(() => null);
  if (existing) {
    return prisma.computeJob.update({ where: { id: existing.id }, data: { inputText: existing.inputText || request } });
  }

  const service = await prisma.serviceCatalog.findUnique({ where: { id: quote.serviceId } });
  if (!service || service.enabled === false) throw inputError('The quoted service is unavailable.', 409);

  const job = await prisma.computeJob.create({
    data: {
      quoteId: quote.id,
      serviceId: quote.serviceId,
      sellerUserId,
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
 */
export async function markComputeJobRefunded({ jobId, reason = null }) {
  const job = await prisma.computeJob.findUnique({ where: { id: jobId } });
  if (!job) throw inputError('Job not found.', 404);
  if (job.status === 'COMPLETED') {
    throw inputError('A completed job cannot be refunded.', 409);
  }
  const updated = await prisma.computeJob.update({
    where: { id: jobId },
    data: { status: 'REFUNDED', failureReason: reason ? String(reason).slice(0, 500) : 'Refunded before settlement.' },
  });
  if (job.revenueEventId) {
    await prisma.computeJob.update({ where: { id: jobId }, data: { revenueEventId: null } }).catch(() => {});
  }
  return updated;
}