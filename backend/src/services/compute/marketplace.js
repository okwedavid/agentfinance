// marketplace.js — marketplace + API-compute interfaces (ARCHITECTURE ONLY).
//
// Phase 4 exposes these contracts for future monetizers / marketplaces. They
// carry no functional endpoints in this milestone; they are type contracts the
// gateway / marketplace sections of the spec can be built against.

/**
 * @typedef {Object} MarketplaceListing
 * Describes a computable deliverable offered on a marketplace.
 * @property {string} id
 * @property {string} serviceSlug     // catalog service that can fulfill it
 * @property {string} title
 * @property {string} priceAsset      // BNB | USDT | USDC
 * @property {string} priceWei        // server-priced, never client-supplied
 * @property {'listed'|'sold'|'cancelled'} status
 */

/**
 * @typedef {Object} MarketplaceSale
 * A completed sale linking payer -> listing -> computation.
 * @property {string} id
 * @property {string} listingId
 * @property {string} jobId           // ComputeJob that fulfilled it
 * @property {string} customerId
 * @property {string} revenueEventId
 */

/**
 * apiComputeGateway — the external API-compute boundary contract.
 * Direct-to-marketplace compute requests arrive here; responses must be
 * serializable, deterministic and reference a booked RevenueEvent only after
 * verified payment.
 *
 * @typedef {Object} ComputeGatewayRequest
 * @property {string} requestText
 * @property {string} serviceSlug
 * @property {string} asset
 * @property {string} quoteNonce      // issued by ComputePricingEngine
 * @property {string} quotePayloadHash
 */

export const marketplaceApiContract = Object.freeze({
  version: '1.0.0',
  listing: ['id', 'serviceSlug', 'title', 'priceAsset', 'priceWei', 'status'].join(','),
  sale: ['id', 'listingId', 'jobId', 'customerId', 'revenueEventId'].join(','),
  gateway: ['requestText', 'serviceSlug', 'asset', 'quoteNonce', 'quotePayloadHash'].join(','),
});

// No money math here by design. Revenue creation stays exclusively in
// revenueService.js.