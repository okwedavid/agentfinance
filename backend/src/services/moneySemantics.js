// moneySemantics.js — the single source of truth for ECONOMIC VALUE STATE.
//
// WHY THIS FILE EXISTS
// --------------------
// AgentFinance books numbers in its own database. Those numbers are NOT money
// unless an external economic actor put real assets in, and evidence of that
// lives outside this platform. Before this module the platform used one word
// ("earned", "revenue", "earnings") for five economically different things.
//
// The economic invariant this module enforces:
//
//     ACCOUNTING_VALUE  is NOT  REAL_EXTERNAL_REVENUE
//     ACCOUNTING_VALUE  is NOT  WITHDRAWABLE_ASSET
//
// A completed task produces ACCOUNTING_VALUE. It never produces an asset. Only
// evidence from outside the platform can raise a value's tier, and no such
// evidence source is configured in this deployment (see EXTERNAL_REVENUE_PATH).
//
// This module is deliberately PURE: no database, no network, no side effects.
// It only classifies and labels. Tests import it directly.

/**
 * Economic value tiers, ordered from weakest to strongest.
 *
 *  - ACCOUNTING_VALUE          A number in our own ledger. Deterministic and
 *                              auditable. Explicitly NOT a claim that any asset
 *                              exists anywhere.
 *  - FUNDED_VALUE              Accounting value with a declared funding source
 *                              behind it. The source may be operator money or
 *                              revenue; this tier says only "backed".
 *  - VERIFIED_EXTERNAL_REVENUE Value received from an economic actor outside the
 *                              platform, evidenced by something outside our
 *                              control. NOT REACHABLE in this deployment.
 *  - ALLOCATED_REWARD          A share of a revenue event assigned to a
 *                              beneficiary.
 *  - SETTLEABLE_VALUE          An entitlement that passed the funding gate and
 *                              may enter the withdrawal pipeline. Still an
 *                              internal claim until broadcast.
 *  - WITHDRAWABLE_ASSET        A settled on-chain transfer to a user-controlled
 *                              address. The only tier backed by a real asset.
 */
export const VALUE_TIER = Object.freeze({
  ACCOUNTING_VALUE: 'ACCOUNTING_VALUE',
  FUNDED_VALUE: 'FUNDED_VALUE',
  VERIFIED_EXTERNAL_REVENUE: 'VERIFIED_EXTERNAL_REVENUE',
  ALLOCATED_REWARD: 'ALLOCATED_REWARD',
  SETTLEABLE_VALUE: 'SETTLEABLE_VALUE',
  WITHDRAWABLE_ASSET: 'WITHDRAWABLE_ASSET',
});

/**
 * How a payment was evidenced.
 *
 *  - SIMULATED          A demo-mode synthetic payer. No money exists.
 *  - OPERATOR_ASSERTED  A human operator declared the payment happened. The
 *                       evidence is self-referential (an HMAC the server both
 *                       issues and checks). It establishes INTENT, never
 *                       receipt. Must never be presented as external proof.
 *  - EXTERNAL_VERIFIED  Evidence produced outside this platform (a payment
 *                       processor, a chain receipt, an independent verifier).
 *                       Reserved. NOT PRODUCIBLE in this deployment.
 */
export const VERIFICATION_METHOD = Object.freeze({
  SIMULATED: 'SIMULATED',
  OPERATOR_ASSERTED: 'OPERATOR_ASSERTED',
  EXTERNAL_VERIFIED: 'EXTERNAL_VERIFIED',
});

/**
 * Where pool funding came from.
 *
 *  - EXTERNAL_REVENUE  Only legitimately backed by EXTERNAL_VERIFIED revenue.
 *  - OPERATOR_FUNDING  The operator's own money. A subsidy or capital
 *                      injection. Real assets, but NOT user-attributable
 *                      external revenue and never earned by an agent.
 *  - TEST_FUNDING      Explicitly seeded for development/testing. Must never be
 *                      representable as a real economic event.
 *  - UNCLASSIFIED      Legacy rows predating this taxonomy. Deliberately
 *                      un-attributed rather than guessed at.
 */
export const FUNDING_CLASS = Object.freeze({
  EXTERNAL_REVENUE: 'EXTERNAL_REVENUE',
  OPERATOR_FUNDING: 'OPERATOR_FUNDING',
  TEST_FUNDING: 'TEST_FUNDING',
  UNCLASSIFIED: 'UNCLASSIFIED',
});

/**
 * Whether a revenue/payment path is available right now, derived from real
 * configuration. Mirrors the agentRegistry.js honesty pattern: status is
 * computed from actual conditions, never asserted.
 */
export const ECONOMIC_PATH = Object.freeze({
  /** No evidence source outside the platform is configured. */
  EXTERNAL_REVENUE_PATH_UNAVAILABLE: 'EXTERNAL_REVENUE_PATH_UNAVAILABLE',
  /** An evidence source exists and is usable. Not the case today. */
  EXTERNAL_REVENUE_PATH_AVAILABLE: 'EXTERNAL_REVENUE_PATH_AVAILABLE',
  /** Compute services can execute and be priced. */
  COMPUTE_AVAILABLE: 'COMPUTE_AVAILABLE',
  /** Compute is disabled on this deployment. */
  COMPUTE_DISABLED: 'COMPUTE_DISABLED',
  /** Demo/simulated economy is on: every figure is SIMULATED. */
  SIMULATED_ECONOMY: 'SIMULATED_ECONOMY',
});

/**
 * The platform's economic capability report.
 *
 * EXTERNAL_REVENUE_PATH_AVAILABLE is hard-coded false because it is derived
 * from an exhaustive audit (see docs/AGENT_REVENUE_ORCHESTRATOR_GAP_ANALYSIS.md
 * §C): the repository contains no payment processor, no inbound webhook, no
 * independent receipt verifier, and no external reward source. Every
 * "verification" currently implemented is operator-asserted.
 *
 * When a real verifier is integrated, flip this ONLY alongside a verifier that
 * lives outside the platform's trust boundary, and never as a UI toggle.
 */
export const EXTERNAL_REVENUE_PATH = Object.freeze({
  available: false,
  reason:
    'No external payment or reward verifier is configured. Payments are operator-asserted; ' +
    'they establish operator intent, not receipt of funds.',
});

/** True only for the reserved, currently unreachable, strongest revenue tier. */
export function isVerifiedExternalRevenue(verificationMethod) {
  return verificationMethod === VERIFICATION_METHOD.EXTERNAL_VERIFIED;
}

/**
 * Map a legacy stored PaymentIntent.verificationType onto the current
 * verification vocabulary. Legacy 'MANUAL_CERT' is an operator assertion, never
 * external verification — this mapping is the J1.2 reclassification.
 */
export function verificationMethodFor(verificationType, simulated = false) {
  const raw = String(verificationType || '').trim().toUpperCase();
  if (raw === VERIFICATION_METHOD.SIMULATED || simulated === true) {
    return VERIFICATION_METHOD.SIMULATED;
  }
  if (raw === VERIFICATION_METHOD.OPERATOR_ASSERTED) {
    return VERIFICATION_METHOD.OPERATOR_ASSERTED;
  }
  // 'MANUAL_CERT' and anything unrecognised: treat as operator assertion, which
  // is the most conservative non-simulated classification.
  return VERIFICATION_METHOD.OPERATOR_ASSERTED;
}

/** Human-facing wording. Deliberately never uses "income" or "profit". */
export const TIER_LABEL = Object.freeze({
  [VALUE_TIER.ACCOUNTING_VALUE]: 'Reward accounting value (not real money)',
  [VALUE_TIER.FUNDED_VALUE]: 'Reward accounting value with declared funding behind it',
  [VALUE_TIER.VERIFIED_EXTERNAL_REVENUE]: 'Externally verified revenue',
  [VALUE_TIER.ALLOCATED_REWARD]: 'Allocated reward share',
  [VALUE_TIER.SETTLEABLE_VALUE]: 'Settleable withdrawal entitlement',
  [VALUE_TIER.WITHDRAWABLE_ASSET]: 'Withdrawn on-chain asset',
});

export const VERIFICATION_LABEL = Object.freeze({
  [VERIFICATION_METHOD.SIMULATED]: 'Simulated — no money exists',
  [VERIFICATION_METHOD.OPERATOR_ASSERTED]: 'Operator-asserted — not independent proof of payment',
  [VERIFICATION_METHOD.EXTERNAL_VERIFIED]: 'Externally verified',
});

export const FUNDING_LABEL = Object.freeze({
  [FUNDING_CLASS.EXTERNAL_REVENUE]: 'External revenue funding',
  [FUNDING_CLASS.OPERATOR_FUNDING]: 'Operator funding (operator’s own money, not earned by agents)',
  [FUNDING_CLASS.TEST_FUNDING]: 'Test funding (development only)',
  [FUNDING_CLASS.UNCLASSIFIED]: 'Unclassified legacy funding',
});

/**
 * Normalise an operator/test funding request. Rejects any attempt to label
 * operator money as external revenue — that is the J1.3 guarantee.
 */
export function normaliseFundingClass(requested, { simulated = false } = {}) {
  const raw = String(requested || '').trim().toUpperCase();
  if (raw === FUNDING_CLASS.EXTERNAL_REVENUE) {
    // Operator money can never be self-declared as external revenue.
    throw Object.assign(
      new Error(
        'EXTERNAL_REVENUE funding cannot be requested by an operator. External revenue funding ' +
          'is only ever created by a verified external payment. Use OPERATOR_FUNDING or TEST_FUNDING.',
      ),
      { status: 422 },
    );
  }
  if (raw === FUNDING_CLASS.TEST_FUNDING) return FUNDING_CLASS.TEST_FUNDING;
  if (raw === FUNDING_CLASS.OPERATOR_FUNDING) {
    return simulated ? FUNDING_CLASS.TEST_FUNDING : FUNDING_CLASS.OPERATOR_FUNDING;
  }
  if (raw === FUNDING_CLASS.UNCLASSIFIED || raw === '') {
    return simulated ? FUNDING_CLASS.TEST_FUNDING : FUNDING_CLASS.OPERATOR_FUNDING;
  }
  throw Object.assign(new Error(`Unsupported fundingClass: ${requested}`), { status: 422 });
}

/**
 * The economic capability report for this deployment. Mirrors
 * getAgentStatus(): every field is derived from actual configuration.
 */
export function economicCapabilityReport({
  computeEconomyEnabled = true,
  computeDemoMode = false,
  paymentVerifierConfigured = false,
} = {}) {
  const externalAvailable = Boolean(paymentVerifierConfigured) && EXTERNAL_REVENUE_PATH.available;
  return {
    computeAvailable: computeEconomyEnabled && !computeDemoMode,
    computeDemoMode,
    externalRevenuePath: externalAvailable
      ? ECONOMIC_PATH.EXTERNAL_REVENUE_PATH_AVAILABLE
      : ECONOMIC_PATH.EXTERNAL_REVENUE_PATH_UNAVAILABLE,
    externalRevenueReason: externalAvailable ? null : EXTERNAL_REVENUE_PATH.reason,
    // No agent may be described as revenue-generating while this is false.
    revenueGeneratingAgentsAvailable: false,
    tiers: Object.values(VALUE_TIER),
    verificationMethods: Object.values(VERIFICATION_METHOD),
    fundingClasses: Object.values(FUNDING_CLASS),
    invariant:
      'ACCOUNTING_VALUE is never REAL_EXTERNAL_REVENUE and never a WITHDRAWABLE_ASSET. ' +
      'A completed task does not create money.',
  };
}

/**
 * Describe a user balance using explicit tier metadata. `availableToWithdrawBnb`
 * is an internal entitlement gated by the funding ratio; it is NOT an asset
 * until a payout settles against a confirmed chain receipt.
 */
export function describeUserValue({
  totalEarnedBnb,
  pendingRewardBnb,
  availableToWithdrawBnb,
  reservedBnb,
  settledBnb,
  fundingRatio,
  pool,
  simulated = false,
}) {
  return {
    totalEarned: { amount: totalEarnedBnb, asset: 'BNB', tier: VALUE_TIER.ACCOUNTING_VALUE },
    pendingReward: { amount: pendingRewardBnb, asset: 'BNB', tier: VALUE_TIER.ACCOUNTING_VALUE },
    availableToWithdraw: {
      amount: availableToWithdrawBnb,
      asset: 'BNB',
      tier: VALUE_TIER.SETTLEABLE_VALUE,
      isAsset: false,
      note: 'Entitlement to request a withdrawal. No asset exists until a payout is settled on-chain.',
    },
    reserved: { amount: reservedBnb, asset: 'BNB', tier: VALUE_TIER.SETTLEABLE_VALUE, isAsset: false },
    settled: { amount: settledBnb, asset: 'BNB', tier: VALUE_TIER.WITHDRAWABLE_ASSET, isAsset: true },
    fundingRatio,
    pool,
    simulated,
    semantics:
      'totalEarned and pendingReward are accounting value. availableToWithdraw is a settleable ' +
      'entitlement capped by the funded share of the pool. Only settled amounts correspond to a ' +
      'real on-chain asset, and they are paid from the operator treasury, not from agent earnings.',
  };
}

/** Describe the pool using explicit tier metadata. */
export function describePoolValue({ generatedBnb, fundedBnb, settledBnb, reservedBnb, simulated = false }) {
  return {
    generated: {
      amount: generatedBnb,
      asset: 'BNB',
      tier: VALUE_TIER.ACCOUNTING_VALUE,
      note: 'Deterministic reward accounting value of delivered work. Not a claim that BNB exists.',
    },
    funded: {
      amount: fundedBnb,
      asset: 'BNB',
      tier: VALUE_TIER.FUNDED_VALUE,
      note: 'Has a declared funding source. Composition is reported in fundingComposition.',
    },
    settled: { amount: settledBnb, asset: 'BNB', tier: VALUE_TIER.WITHDRAWABLE_ASSET, isAsset: true },
    reserved: { amount: reservedBnb, asset: 'BNB', tier: VALUE_TIER.SETTLEABLE_VALUE, isAsset: false },
    simulated,
    semantics:
      'generated is accounting value; funded is whatever sources the operator declared; settled is ' +
      'real on-chain asset paid out of the operator treasury. No agent-attributable external ' +
      'revenue exists in this deployment.',
  };
}

export default {
  VALUE_TIER,
  VERIFICATION_METHOD,
  FUNDING_CLASS,
  ECONOMIC_PATH,
  EXTERNAL_REVENUE_PATH,
  TIER_LABEL,
  VERIFICATION_LABEL,
  FUNDING_LABEL,
  isVerifiedExternalRevenue,
  verificationMethodFor,
  normaliseFundingClass,
  economicCapabilityReport,
  describeUserValue,
  describePoolValue,
};