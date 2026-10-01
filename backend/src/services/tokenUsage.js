// tokenUsage.js — record normalized provider token usage (J1.9).
//
// TokenUsage rows were defined in the schema but never written: agentRunner
// received `usage` from callProvider on every successful call and dropped it on
// the floor. The table being permanently empty meant the platform had no record
// of the inference cost of the work it booked rewards for.
//
// ECONOMIC TRUTH: recorded usage is a COST, never revenue. A cost must never be
// subtracted from a revenue figure to manufacture a "profit" — the
// revenueNeverEqualToComputeCost rule in compute/revenueService.js exists for
// the same reason. costCents stays 0 until the operator configures a real
// per-model price; the token counts are the honest part and are recorded
// regardless of pricing.
//
// This is deliberately best-effort: a usage-recording failure must never fail
// the agent run that produced it. Callers should not await-then-check.

import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';

/**
 * Normalize the provider-specific usage shapes emitted by parseContent().
 * Accepts {promptTokens, completionTokens}, OpenAI-style
 * {prompt_tokens, completion_tokens}, and Google's usageMetadata. Returns null
 * when no usable counts are present, so a provider that omits usage is recorded
 * as "unknown" rather than as zero.
 */
export function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;

  const rawPrompt = usage.promptTokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? null;
  const rawCompletion = usage.completionTokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? null;
  const rawTotal = usage.totalTokens ?? usage.total_tokens ?? usage.totalTokenCount ?? null;

  const promptTokens = toCount(rawPrompt);
  const completionTokens = toCount(rawCompletion);
  if (promptTokens === null && completionTokens === null) return null;

  const totalTokens = toCount(rawTotal) ?? (promptTokens ?? 0) + (completionTokens ?? 0);

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? 0,
  };
}

function toCount(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * Persist one usage record. Returns the created row, or null when there was
 * nothing to record. Never throws.
 */
export async function recordTokenUsage({ model, usage, taskId = null, costCents = 0 }) {
  const normalized = normalizeTokenUsage(usage);
  if (!normalized) return null;
  if (!model) return null;

  try {
    return await prisma.tokenUsage.create({
      data: {
        taskId: taskId || null,
        model: String(model).slice(0, 200),
        promptTokens: normalized.promptTokens,
        completionTokens: normalized.completionTokens,
        totalTokens: normalized.totalTokens,
        // 0 means "not priced yet", never "free". See the file header.
        costCents: Number.isFinite(costCents) && costCents > 0 ? Math.trunc(costCents) : 0,
      },
    });
  } catch (error) {
    logger.warn('[tokens] failed to record token usage', error?.message);
    return null;
  }
}

/**
 * Aggregate recorded usage. Reported as a cost, never as revenue or profit.
 */
export async function summariseTokenUsage({ take = 1000 } = {}) {
  const rows = await prisma.tokenUsage.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 1000, 5000),
  });

  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let costCents = 0;
  for (const row of rows) {
    promptTokens += row.promptTokens || 0;
    completionTokens += row.completionTokens || 0;
    totalTokens += row.totalTokens || 0;
    costCents += row.costCents || 0;
  }

  return {
    records: rows.length,
    promptTokens,
    completionTokens,
    totalTokens,
    costCents,
    pricingConfigured: rows.some((r) => (r.costCents || 0) > 0),
    unit: 'TOKENS',
    isMoney: false,
    note:
      'Inference token usage for completed agent work. This is a COST of operating the platform. '
      + 'It is not revenue, and it must never be netted against revenue to imply a profit.',
  };
}
