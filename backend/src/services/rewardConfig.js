// rewardConfig.js — deterministic, server-side coefficient table for the
// reward economy. Every value is env-overridable so the factory owner can tune
// the economy without a code deploy. All money math stays in BigInt via
// decimal.js; multipliers are { num, den } ratios.
//
// Reward formula (see rewardCalculator.js):
//   rewardWei = taskValueWei
//       × rewardRate × qualityMultiplier × difficultyMultiplier × reliabilityMultiplier
//
// Capped at REWARD_MAX_PER_TASK and floored at REWARD_MIN_PER_TASK (a task
// whose computed reward is below the floor books nothing, protecting the pool
// from being flooded with dust).

import { toUnits, toFraction } from '../utils/decimal.js';

export const REWARD_ASSET = 'BNB';

export function envDecimal(name, fallback) {
  const raw = String(process.env[name] ?? '').trim();
  return /^\d+(\.\d*)?$/.test(raw) && raw !== '' ? raw : String(fallback);
}

export function envFlag(name) {
  const v = String(process.env[name] || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function calculationVersion() {
  return String(process.env.REWARD_CALC_VERSION || '1.0.0');
}

// Default base economic value of a completed, delivered task (BNB), keyed by
// the deterministic agent type. This is an accounting VALUE of the generated
// reward pool, NOT a claim about real BNB existing on-chain.
export function agentTaskValueBnb(agent) {
  const key = String(agent || 'general').toLowerCase();
  switch (key) {
    case 'research':
      return envDecimal('REWARD_TASK_VALUE_RESEARCH', '0.0012');
    case 'content':
      return envDecimal('REWARD_TASK_VALUE_CONTENT', '0.0008');
    case 'general':
    default:
      return envDecimal('REWARD_TASK_VALUE_GENERAL', '0.0010');
  }
}

export function agentTaskValueWei(agent) {
  return toUnits(agentTaskValueBnb(agent));
}

// Fraction of the task's economic value that actually becomes a user reward.
// The remainder is the platform's gross margin on the generated pool.
export function rewardRateFraction() {
  return toFraction(envDecimal('REWARD_RATE', '0.35'));
}

export function maxRewardPerTaskWei() {
  return toUnits(envDecimal('REWARD_MAX_PER_TASK', '0.004'));
}

export function minRewardPerTaskWei() {
  return toUnits(envDecimal('REWARD_MIN_PER_TASK', '0.00005'));
}

// Deterministic quality grade from the persisted result size. Bigger, complete
// output = higher grade. This is a proxy for delivered work depth that cannot
// be gamed from the browser (the client can never write task.result).
export function qualityMultiplier(resultLength) {
  const length = Math.max(0, Number(resultLength) || 0);
  if (length >= 2000) {
    return { num: 95n, den: 100n, label: 'excellent' };
  }
  if (length >= 800) {
    return { num: 85n, den: 100n, label: 'good' };
  }
  if (length >= 300) {
    return { num: 75n, den: 100n, label: 'adequate' };
  }
  return { num: 60n, den: 100n, label: 'minimal' };
}

// Difficulty factor per deterministic agent type (harder work earns more).
export function difficultyMultiplier(agent) {
  const key = String(agent || 'general').toLowerCase();
  switch (key) {
    case 'research':
      return { num: 110n, den: 100n, label: 'research', valueLabel: '1.10' };
    case 'content':
      return { num: 90n, den: 100n, label: 'content', valueLabel: '0.90' };
    case 'general':
    default:
      return { num: 100n, den: 100n, label: 'general', valueLabel: '1.00' };
  }
}

// Reliability factor from the persisted retryCount: a task that needed retries
// earned the platform less margin, so the user reward is discounted.
export function reliabilityMultiplier(retryCount) {
  const retries = Number(retryCount) || 0;
  if (retries > 0) {
    return { num: 85n, den: 100n, label: `retried(${retries})`, valueLabel: '0.85' };
  }
  return { num: 100n, den: 100n, label: 'first-attempt', valueLabel: '1.00' };
}

export function rewardEconomyEnabled() {
  return !envFlag('REWARD_ECONOMY_DISABLED');
}

export function demoMode() {
  // Explicit demo switch. When on, every pool figure is tagged SIMULATED and
  // payout broadcasting is refused. When off, pool figures are REAL accounting
  // of generated/funded/settled BNB — but still never a claim that generated
  // BNB exists on-chain until a real funding event is confirmed.
  return envFlag('REWARD_DEMO_MODE');
}

export function getRewardConfig() {
  return {
    version: calculationVersion(),
    asset: REWARD_ASSET,
    rateBnb: envDecimal('REWARD_RATE', '0.35'),
    maxPerTaskBnb: envDecimal('REWARD_MAX_PER_TASK', '0.004'),
    minPerTaskBnb: envDecimal('REWARD_MIN_PER_TASK', '0.00005'),
    taskValuesBnb: {
      research: envDecimal('REWARD_TASK_VALUE_RESEARCH', '0.0012'),
      general: envDecimal('REWARD_TASK_VALUE_GENERAL', '0.0010'),
      content: envDecimal('REWARD_TASK_VALUE_CONTENT', '0.0008'),
    },
    demoMode: demoMode(),
  };
}