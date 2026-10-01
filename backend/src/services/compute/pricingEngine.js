// pricingEngine.js — server-authoritative compute pricing (ComputePricingEngine).
//
// The engine derives the fixed price for one job of a catalog service. It never
// accepts an amount from a client; the customer can only present the quote
// nonce/payloadHash back. Every price is deterministic and recorded on the
// quote so later booking refers to an immutable, audited number.

import { createHash, randomUUID } from 'node:crypto';
import { toUnits } from '../../utils/decimal.js';
import {
  SUPPORTED_ASSETS,
  assetToBnbReference,
  platformFeeBnbWei,
  toBnbWei,
} from './config.js';

const QUOTE_TTL_MS = 15 * 60 * 1000; // quotes expire in 15 minutes

export function quoteTtlMs() {
  return Number(process.env.COMPUTE_QUOTE_TTL_MS) > 0
    ? Number(process.env.COMPUTE_QUOTE_TTL_MS)
    : QUOTE_TTL_MS;
}

function canonicalPayload({ service, asset, priceBnbWei, amountWei, nonce, expiresAt, priceBnbPerUnit }) {
  return {
    v: 'compute-quote-1',
    service: service.slug,
    asset,
    priceBnbWei: String(priceBnbWei),
    amountWei: String(amountWei),
    priceBnbPerUnit: priceBnbPerUnit || null,
    nonce,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload, null, 0)).digest('hex');
}

/**
 * Build the server-side quote computation for one job of `service`.
 *
 * Returns plain data (never persisted here): the caller writes the ComputeQuote
 * row. Rejects unsupported assets and disabled services.
 */
export async function generateComputeQuote({ service, asset, userId, nowMs = Date.now() }) {
  if (!service || !service.slug || !service.unitPriceBnb) {
    throw Object.assign(new Error('Unknown compute service.'), { status: 404 });
  }
  if (service.enabled === false) {
    throw Object.assign(new Error(`Service "${service.slug}" is disabled.`), { status: 422 });
  }
  const assetKey = String(asset || '').toUpperCase();
  if (!SUPPORTED_ASSETS.includes(assetKey)) {
    throw Object.assign(new Error(`Unsupported payment asset: ${assetKey}. Supported: ${SUPPORTED_ASSETS.join(', ')}.`), { status: 422 });
  }

  const priceBnbWei = toUnits(service.unitPriceBnb);
  if (priceBnbWei <= 0n) {
    throw Object.assign(new Error('Service has an invalid price.'), { status: 500 });
  }

  let amountWei = priceBnbWei;
  let priceBnbPerUnit = null;
  if (assetKey !== 'BNB') {
    const ref = assetToBnbReference(assetKey);
    if (ref === null) {
      throw Object.assign(
        new Error(`No operator BNB reference price configured for ${assetKey}.`),
        { status: 422, payload: { hint: `Set COMPUTE_ASSET_BNB_PRICE_${assetKey}.` } },
      );
    }
    // price(asset units) = ceil(priceBnb / ref) so customers are never charged
    // less than the BNB price when converted back.
    priceBnbPerUnit = ref;
    const { num: n, den: d } = toFractionRef(ref);
    amountWei = n <= 0n ? 0n : (priceBnbWei * d + n - 1n) / n;
  }

  const platformFeeBnb = platformFeeBnbWei(priceBnbWei);
  const serviceCostBnb = priceBnbWei - platformFeeBnb;
  if (serviceCostBnb <= 0n) {
    throw Object.assign(new Error('Pricing margins are invalid (service cost must be positive).'), { status: 500 });
  }

  const expiresAt = new Date(nowMs + quoteTtlMs());
  const nonce = randomUUID();
  const payload = canonicalPayload({ service, asset: assetKey, priceBnbWei, amountWei, nonce, expiresAt, priceBnbPerUnit });
  const payloadHash = hashPayload(payload);

  return {
    serviceId: service.id,
    slug: service.slug,
    userId,
    asset: assetKey,
    amountWei: String(amountWei),
    priceBnbWei: String(priceBnbWei),
    priceBnbPerUnit,
    platformFeeBnbWei: String(platformFeeBnb),
    serviceCostBnbWei: String(serviceCostBnb),
    nonce,
    payloadHash,
    expiresAt,
  };
}

/**
 * Verify a client-supplied nonce/payloadHash against the persisted quote.
 * Guards against tampered amounts: recomputes the hash from the quote's own
 * fields and requires an exact match.
 */
export function verifyQuoteBindings(quote) {
  const payload = canonicalPayload({
    service: { slug: quote.slug || quote.serviceSlug },
    asset: quote.asset,
    priceBnbWei: quote.priceBnbWei,
    amountWei: quote.amountWei,
    nonce: quote.nonce,
    expiresAt: new Date(quote.expiresAt),
    priceBnbPerUnit: quote.priceBnbPerUnit || null,
  });
  return hashPayload(payload) === quote.payloadHash;
}

export function quoteAmountBnbEqualTo(quote, amountWei) {
  return toUnits(amountWei) === toBnbWei(quote.amountWei, quote.asset, quote.priceBnbPerUnit);
}

/**
 * Whether the quote's own charged amount still covers the price the server
 * computed for it.
 *
 * The check is deliberately one-directional: for non-BNB assets the pricing
 * engine rounds the charged amount UP, so the valuation of the charged amount is
 * always >= the BNB price. Requiring equality here would reject every valid
 * non-BNB quote, and accepting a shortfall is exactly the tampering this guards
 * against (a quote whose amountWei was edited downward).
 *
 * BNB quotes are exact: the charged amount IS the price.
 */
export function quoteAmountCoversPrice(quote) {
  // priceBnbWei and amountWei are RAW wei integer strings, so they are compared
  // as BigInt. They must not go through toUnits(), which treats its input as a
  // decimal token and would scale an already-scaled value by 1e18.
  const rawPrice = String(quote.priceBnbWei ?? '').trim();
  if (!/^\d+$/.test(rawPrice)) return false;
  const priceWei = BigInt(rawPrice);
  if (priceWei <= 0n) return false;

  let chargedWei;
  try {
    chargedWei = toBnbWei(quote.amountWei, quote.asset, quote.priceBnbPerUnit);
  } catch {
    // A missing asset reference price makes the charge unverifiable, which is
    // exactly the case that must not be allowed to proceed.
    return false;
  }
  return chargedWei >= priceWei;
}

function toFractionRef(value) {
  const s = String(value).trim();
  const [int, frac = ''] = s.split('.');
  const digits = (int + frac).replace(/^0+/, '') || '0';
  const den = 10n ** BigInt(frac.length);
  return { num: BigInt(digits), den: den || 1n };
}