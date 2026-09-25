// valueEngine.js — ComputeValueAdapter contract + EconomicValueEngine.
//
// The EconomicValueEngine measures the economic value OPINION of delivered
// work from deterministic server-side signals (output size, provider, agent).
// Its output is labelled an ESTIMATE and is NEVER money: monetary value only
// exists after a verified PaymentIntent -> RevenueEvent chain. This keeps the
// disembodied "AI generated value" from ever posing as revenue.

import { toUnits, fromUnits } from '../../utils/decimal.js';

const baseValueBnb = '0.0010';

function sizeGrade(sizeBytes) {
  const s = Number(sizeBytes) || 0;
  if (s >= 4000) return { num: 130n, den: 100n, label: 'comprehensive' };
  if (s >= 1500) return { num: 110n, den: 100n, label: 'substantial' };
  if (s >= 600) return { num: 100n, den: 100n, label: 'standard' };
  if (s >= 200) return { num: 85n, den: 100n, label: 'concise' };
  return { num: 70n, den: 100n, label: 'minimal' };
}

/**
 * Deterministic economic-value OPINION of a piece of delivered work.
 *
 * Returns an estimate only. generatedReward / fundedReward / settleableReward
 * derived from this figure are zero until the job is monetized through a
 * verified external payment.
 */
export function estimateComputeValueBnb({ serviceBnb, sizeBytes, retries = 0 }) {
  const baseWei = toUnits(serviceBnb && toUnits(serviceBnb) > 0n ? serviceBnb : baseValueBnb);
  const grade = sizeGrade(sizeBytes);
  const reliability = retries > 0 ? { num: 90n, den: 100n, label: `retried(${retries})` } : { num: 100n, den: 100n, label: 'first-attempt' };
  const estimateWei = (baseWei * grade.num * reliability.num) / (grade.den * reliability.den);

  return {
    estimateBnb: fromUnits(estimateWei, 8),
    grade: grade.label,
    reliability: reliability.label,
    model: 'deterministic-server-signal',
    disclaimer: 'Economic value estimate only — not money. Monetary value exists only after a verified external payment.',
  };
}

/**
 * ComputeValueAdapter — contract converting job proof/output into value signals.
 *
 * Implementations consume the immutable output record (+ hash, engine, cost)
 * and emit a value opinion. No implementation ever writes money itself; the
 * revenue service is the only writer of RevenueEvent/Allocation rows.
 *
 * @typedef {Object} ComputeValueAdapter
 * @property {(job:any, output:any) => Promise<{estimateBnb:string, grade:string}>} valueOpinion
 */
export function isComputeValueAdapter(value) {
  return Boolean(value && typeof value.valueOpinion === 'function');
}

export const EconomicValueEngine = Object.freeze({
  estimateComputeValueBnb,
  baseValueBnb,
});