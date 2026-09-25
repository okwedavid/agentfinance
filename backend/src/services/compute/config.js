// config.js — Phase 4 compute-to-revenue economy coefficients.
//
// Deterministic, server-side only. Every tunable is env-overridable so the
// owner can adjust the economy without a code deploy. ALL money math stays in
// BigInt via decimal.js; shares are { num, den } ratios.
//
// Hard rule: revenue is only money verified as coming from an EXTERNAL payer.
// These flags never turn internal bookkeeping into revenue — they only gate
// the optional SIMULATED demo economy.

import { envDecimal, envFlag } from '../rewardConfig.js';
import { toUnits, toFraction } from '../../utils/decimal.js';

export const SUPPORTED_ASSETS = Object.freeze(['BNB', 'USDT', 'USDC']);

export function computeEconomyEnabled() {
  return !envFlag('COMPUTE_ECONOMY_DISABLED');
}

// Explicit demo switch. When on, a simulated customer can pay end-to-end and
// every related figure is tagged SIMULATED. When off, the demo payer list is
// empty and no simulation fallback is inlined anywhere.
export function computeDemoMode() {
  return envFlag('COMPUTE_ECONOMY_DEMO_MODE');
}

// Share of verified revenue that is allocated to reward funding (the pool).
// The remainder is the platform's gross margin. shares must sum to 1 (nominal
// invariant checked at first use — see rewardFundingShareFraction()).
export function rewardFundingShareFraction() {
  return toFraction(envDecimal('COMPUTE_REWARD_FUNDING_SHARE', '0.55'));
}

export function platformShareFraction() {
  return toFraction(envDecimal('COMPUTE_PLATFORM_SHARE', '0.45'));
}

// Operator-supplied reference prices: BNB per 1 unit of the asset. Used only
// when converting a non-BNB payment into the BNB-denominated reward pool. The
// number is a recorded reference, never self-derived from market data.
export function assetToBnbReference(asset) {
  const key = String(asset || '').toUpperCase();
  if (key === 'BNB') return null;
  if (!SUPPORTED_ASSETS.includes(key)) return null;
  const envKey = `COMPUTE_ASSET_BNB_PRICE_${key}`;
  const configured = (process.env[envKey] || '').trim();
  if (/^\d+(\.\d*)?$/.test(configured) && toUnits(configured) > 0n) return configured;
  // Demo mode has explicit operator references; production REQUIRES the env.
  if (computeDemoMode()) {
    const fallback = key === 'BNB' ? '1' : '0.0017';
    return envDecimal(envKey, fallback);
  }
  return null;
}

// Conversion: amountWei(asset units, stored as raw integer wei-string) -> BNB wei.
// Stored wei strings are exact integers (BigInt scale), NOT decimal tokens, so
// they are parsed with BigInt() — never toUnits() (which would scale ×1e18).
export function toBnbWei(amountWei, asset, priceBnbPerUnit) {
  const raw = String(amountWei).trim();
  const units = typeof amountWei === 'bigint' ? amountWei : /^\d+$/.test(raw) ? BigInt(raw) : toUnits(raw);
  const upper = String(asset || '').toUpperCase();
  if (upper === 'BNB') return units;
  const ref = priceBnbPerUnit !== undefined && priceBnbPerUnit !== null
    ? String(priceBnbPerUnit).trim()
    : (assetToBnbReference(upper) || '');
  if (!/^\d+(\.\d*)?$/.test(ref) || toUnits(ref) <= 0n) {
    throw Object.assign(
      new Error(`No operator BNB reference price configured for ${upper}. Payments in ${upper} are disabled until COMPUTE_ASSET_BNB_PRICE_${upper} is set.`),
      { status: 422 },
    );
  }
  const { num: n, den: d } = toFraction(ref);
  if (d <= 0n) return 0n;
  return (units * n) / d;
}

// Deterministic platform fee = price × platform share (floor).
export function platformFeeBnbWei(priceBnbWei) {
  return applyWei(priceBnbWei, platformShareFraction());
}

export function rewardFundingFromRevenueBnbWei(amountBnbWei) {
  return applyWei(amountBnbWei, rewardFundingShareFraction());
}

function applyWei(wei, ratio) {
  const units = typeof wei === 'bigint' ? wei : toUnits(wei);
  if (ratio.den <= 0n) return 0n;
  return (units * ratio.num) / ratio.den;
}

export function computeVersion() {
  return String(process.env.COMPUTE_CALC_VERSION || '1.0.0');
}

export function getComputeEconomyConfig() {
  return {
    version: computeVersion(),
    enabled: computeEconomyEnabled(),
    demoMode: computeDemoMode(),
    supportedAssets: SUPPORTED_ASSETS,
    rewardFundingShare: envDecimal('COMPUTE_REWARD_FUNDING_SHARE', '0.55'),
    platformShare: envDecimal('COMPUTE_PLATFORM_SHARE', '0.45'),
  };
}