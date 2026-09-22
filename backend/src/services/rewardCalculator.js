// rewardCalculator.js — deterministic, explainable reward computation.
//
// Given the SAME persisted task, this function ALWAYS returns the SAME reward
// (pure function; no randomness, no wall-clock dependence, no user input beyond
// the task row itself). Every input and multiplier is captured in
// `taskValueMetric` so any reward can be re-derived and audited by hand.

import { routeTask } from '../agents/agentRegistry.js';
import { toUnits, fromUnits, applyFraction, min } from '../utils/decimal.js';
import {
  agentTaskValueWei,
  rewardRateFraction,
  qualityMultiplier,
  difficultyMultiplier,
  reliabilityMultiplier,
  maxRewardPerTaskWei,
  minRewardPerTaskWei,
  calculationVersion,
  REWARD_ASSET,
} from './rewardConfig.js';

export function classifyRewardAgent(task) {
  const action = String(task?.action || '');
  try {
    return routeTask(action).agent;
  } catch {
    return 'general';
  }
}

export function calculateRewardForTask(task) {
  const agent = classifyRewardAgent(task);
  const resultLength = String(task?.result || '').length;
  const retryCount = Number(task?.retryCount) || 0;

  const quality = qualityMultiplier(resultLength);
  const difficulty = difficultyMultiplier(agent);
  const reliability = reliabilityMultiplier(retryCount);
  const rateFraction = rewardRateFraction();
  const taskValueWei = agentTaskValueWei(agent);

  let wei = taskValueWei;
  wei = applyFraction(wei, rateFraction);
  wei = applyFraction(wei, quality);
  wei = applyFraction(wei, difficulty);
  wei = applyFraction(wei, reliability);

  const cap = maxRewardPerTaskWei();
  const floor = minRewardPerTaskWei();
  if (wei > cap) wei = cap;
  if (wei < floor) wei = 0n;

  const taskValueBnb = fromUnits(taskValueWei, 8);
  const rewardAmountBnb = fromUnits(wei, 8);

  const taskValueMetric = {
    taskId: task?.id || null,
    agent,
    taskValueBnb,
    rewardRate: rateFractionRatioLabel(rateFraction),
    qualityMultiplier: ratioLabel(quality),
    difficultyMultiplier: { ...difficulty, ratio: ratioLabel(difficulty) },
    reliabilityMultiplier: { ...reliability, ratio: ratioLabel(reliability) },
    rawResultLength: resultLength,
    retryCount,
    capBnb: fromUnits(cap, 8),
    floorBnb: fromUnits(floor, 8),
    capped: wei === cap,
    flooredToZero: rewardAmountBnb === '0',
    explain:
      `${taskValueBnb} BNB task value × rate(${rateFractionRatioLabel(rateFraction)}) × ` +
      `quality(${quality.label} ${ratioLabel(quality)}) × difficulty(${ratioLabel(difficulty)}) × ` +
      `reliability(${ratioLabel(reliability)}) = ${rewardAmountBnb} BNB`,
  };

  return {
    agent,
    rewardAmountBnb,
    rewardAmountWei: wei,
    calculationVersion: calculationVersion(),
    rewardAsset: REWARD_ASSET,
    taskValueMetric,
  };
}

function ratioLabel(fraction) {
  return `${Number(fraction.num)}/${Number(fraction.den)}`;
}

function rateFractionRatioLabel(fraction) {
  return `${Number(fraction.num)}/${Number(fraction.den)}`;
}

// Compatibility helper used by tests: number BNB ↔ wei via decimal.js.
export function bnbToWei(value) {
  return toUnits(value);
}