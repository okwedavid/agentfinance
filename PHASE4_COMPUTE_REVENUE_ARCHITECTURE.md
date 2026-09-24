# Phase 4 — Compute-to-Revenue Engine: Architecture Map

Produced before implementation. This is the internal design map for extending
AgentFinance from a *task-reward pool* economy into a *compute-to-revenue*
economy where computational work produces real, externally-paid economic output.

## 1. North-star rules (non-negotiable)

1. **Computation is not money.** A completed job has a deterministic
   `economicValueEstimate` (analysis/planning only). It has monetary value only
   after an external payer's payment is verified.
2. **Revenue is only ever money that originated with an external economic
   actor** (a customer, not our treasury, not our wallet, not our internal
   ledger, not the AI).
3. **Never**: fake BNB, treasury as revenue source, `COMPUTATION` as a revenue
   source, "BNB mining", counting internal AI/ledger/wallet figures as revenue.
4. **The payer and the reward recipient may differ.** The vertical slice models
   exactly that: an external customer pays; a platform contributor is rewarded
   from the revenue-backed pool.
5. **Deterministic server-side money math only.** Prices come from the server
   pricing engine; asset→BNB conversions use an operator-supplied reference
   price, never a self-derived/market-derived number.
6. **Simulation never masquerades as real.** `COMPUTE_ECONOMY_DEMO_MODE`
   optionally powers an explicitly-labeled SIMULATED economy. Real and
   simulated figures are always separated in reports/admin surfaces.
7. **No fake rewriting of history**; no destroying existing rows. All Prisma
   changes are additive migrations. Legacy payout
   `cmuby7zpx000k6zvc3elsyq0s` is preserved.
8. **Every BNB booked as "funded" must be backed by verified external money.**
   Reward funding is credited to the existing `RewardPool.fundedBnb` only from
   a verified `PaymentIntent` -> `RevenueEvent` -> `RevenueAllocation` chain.

## 2. Economic invariant chain (the acceptance trace)

```
Customer (external payer)
  -> ComputeQuote (server price, expiration, nonce, payloadHash)
  -> PaymentIntent (asset, amountWei, verificationType, external=true)
  -> Verification (MANUAL_CERT by SUPER_ADMIN | SIMULATED by ADMIN in demo)
  -> RevenueEvent        (source=COMPUTE_JOB, monetizerType=CUSTOMER_PAYMENT,
                          external=true, simulated flag, bnbEquivalentWei)
  -> RevenueAllocation   (REWARD_FUNDING | PLATFORM, exact integer split)
  -> RewardPool.fundedBnb  (fundPoolFromRevenueTx, PoolFundingEvent
                            sourceType=COMPUTE_REVENUE)
  -> RewardEvent (computeJobId unique, rewardType=COMPUTE_JOB_REVENUE)
  -> UserRewardBalance.totalEarnedBnb
  -> availableToWithdrawBnb = floor(totalEarned * funded/generated)
     - reserved - settled   (existing phase 3 settleable semantics)
  -> Withdrawal (existing payout pipeline, unaffected)
```

Compute → money bridge (required: **all seven** present before a job's reward
is booked):
economicValueEstimate -> proof of work -> actual cost -> monetizable output ->
monetization -> revenue -> reward funding. In this slice a job is monetized
only when its `PaymentIntent` is verified first; an unmonetized job books
`generatedReward/fundedReward/settleableReward = 0`.

## 3. Vertical slice (FIRST complete production-grade slice)

**Compute-as-a-Service** — a customer requests a job, receives a server-side
price, pays, the payment is verified (real or simulated), the job executes on
the existing agent fleet, output is hashed and delivered, cost is recorded, and
the resulting revenue funds contributor rewards that are withdrawable through
the existing payout pipeline.

Endpoints (all under `backend/src/routes/compute.js`):
- `GET /api/compute/services` — public catalog (server-managed pricing).
- `POST /api/compute/quote` — server quote + PaymentIntent creation (never a
  client-supplied price).
- `POST /api/compute/payments/:id/verify` — admin; the ONLY way a payment
  becomes VERIFIED. Real: SUPER_ADMIN + attestation (HMAC). Demo: any admin;
  event flagged SIMULATED.
- `POST /api/compute/jobs` — create + execute job once the quote is PAID.
- `GET /api/compute/jobs`, `GET /api/compute/jobs/:id` — history + lineage.
- `GET /api/admin/compute/overview` — monetization totals, REAL vs SIMULATED
  separation, and the full revenue→reward trace.

## 4. Component map

| Component | File | Responsibility |
|---|---|---|
| Economy config | `backend/src/services/compute/config.js` | `computeEconomyEnabled()`, `computeDemoMode()` (COMPUTE_ECONOMY_DEMO_MODE), reward-funding share, platform share, per-asset BNB reference prices, computation-economy env values |
| Service catalog | `backend/src/services/compute/catalogService.js` | server-managed `ServiceCatalog` rows (additive seed; never client-written) |
| Pricing engine | `backend/src/services/compute/pricingEngine.js` | deterministic `ComputePricingEngine.generateQuote(service, asset)`; returns priceWei(asset), priceBnbWei, platformFee, serviceCost, nonce, payloadHash, expiry; rejects client amounts |
| Value engine | `backend/src/services/compute/valueEngine.js` | `EconomicValueEngine.estimateComputeValueBnb(jobMeta)` — deterministic, explicitly "estimate, not money"; bridges to revenue only in conjunction with verified payment |
| Monetization adapter | `backend/src/services/compute/customerPaymentMonetizer.js` | `CustomerPaymentMonetizer` implementing `MonetizationAdapter` (quote/submit/verify/settle/refund) over `PaymentIntent` + `ComputeCustomer` |
| Revenue service | `backend/src/services/compute/revenueService.js` | `bookRevenueFromVerifiedPayment` (SERIALIZABLE): RevenueEvent + allocations + pool funding in one transaction |
| Reward integration | `backend/src/services/rewardService.js` (extended) | `COMPUTE_REVENUE` source type, `fundPoolFromRevenueTx`, `createRewardForComputeJob` (idempotent via unique `RewardEvent.computeJobId`) |
| Job service | `backend/src/services/compute/jobService.js` | `createComputeJobFromAcceptedQuote` -> run -> record `ComputeOutput`/`ComputeCost` -> `finalizeComputeJob` books the contributor reward |
| Worker model | `backend/src/services/compute/registry.js` | `computeWorkerRegistry` (serviceId -> worker {source, run, idle capacity}) + `computeScheduler` (BullMQ `compute-jobs` queue when REDIS_URL present, inline otherwise) |
| Routes | `backend/src/routes/compute.js` | public + admin compute API with dedicated rate limits |
| UI: market | `frontend/src/app/compute/page.tsx` | catalog, quote, pay note, job submit, output (hash/size/engine) |
| UI: admin | `frontend/src/app/admin/page.tsx` (extended) | COMPUTE REVENUE ECONOMY panel: totals, REAL vs SIMULATED, payment verification (demo), trace |
| API client | `frontend/src/lib/api.ts` | compute endpoints |

## 5. Data models (Phase 4, additive; full detail in the migration)

- `ServiceCatalog` — slug, name, description, agent (research/general/content),
  `unitPriceBnb`, `category`, `enabled`.
- `ComputeQuote` — serviceId, userId, asset, `amountWei` (asset units),
  `priceBnbWei`, nonce, `payloadHash`, status, expiry, `priceBnbPerUnit` (the
  recorded operator reference for non-BNB assets).
- `PaymentIntent` — quoteId (unique), asset, `amountWei`, status
  (PENDING/VERIFIED/SETTLED/FAILED/REFUNDED), `verificationType`
  (SIMULATED/MANUAL_CERT), `external=true`, txHash, verifiedBy/At, note.
- `ComputeCustomer` — displayName, type (SIMULATED/EXTERNAL), creditsPaid.
- `ComputeJob` — quoteId, serviceId, `sellerUserId` (reward recipient, payer
  differs), agent, taskId (underlying agent Task for traceability), status,
  `economicValueBnb` (0 until monetized), `revenueEventId`, costs.
- `ComputeOutput` — jobId (unique), `resultText` (+ text ref), `resultHash`
  (sha256), `sizeBytes`, engine.
- `ComputeCost` — jobId, costAsset, amountWei, costKind
  (INFERENCE/COMPUTE/ELECTRICITY), source (INTERNAL/EXTERNAL).
- `RevenueEvent` — jobId, paymentIntentId, asset, amountWei, `bnbEquivalentWei`,
  source=COMPUTE_JOB, monetizerType=CUSTOMER_PAYMENT, external, simulated.
- `RevenueAllocation` — revenueEventId, allocationType (REWARD_FUNDING /
  PLATFORM), asset, amountWei, `bnbEquivalentWei`, simulated.
- `RewardEvent` extended: nullable unique `computeJobId`.

No FK constraints onto User are added so the existing account-deletion
transaction and legacy rows remain untouched; user references are indexed
strings.

## 6. Money rules enforced in code

- The only path that raises `RewardPool.fundedBnb` from compute revenue is
  `fundPoolFromRevenueTx` inside the same SERIALIZABLE transaction that books
  the `RevenueEvent`. Partial-failure rolls back the whole booking.
- Quote price and asset conversion are computed by the server; the customer can
  only submit the quote nonce. `payloadHash` binds amount/asset/service.
- A `ComputeJob` books a reward exactly once: uniqueness on
  `RewardEvent.computeJobId`, and the underlying agent `Task` never goes
  through `createRewardForTask` (grep-verified single caller pattern).
- Reward funding never exceeds the verified revenue allocation (exact integer
  share, floor semantics via `decimal.js`).
- REFUND path: reverses the payment intent, removes the unaffected allocation,
  and zeroes the job's revenue link without touching already-withdrawn funds.

## 7. Demo mode semantics

`COMPUTE_ECONOMY_DEMO_MODE=true` enables a simulated customer (invisible payer)
end-to-end. Every related figure is labeled SIMULATED; real-vs-simulated totals
are kept separate everywhere; production never inlines a simulation fallback.
`REWARD_DEMO_MODE` (phase 3) continues to gate payout broadcasting.

## 8. Provided // Interfaces (architecture only, no functional endpoints)

- `ComputeValueAdapter` — contract mapping job proof/output into value signals.
- `MonetizationAdapter` — the contract implemented by `CustomerPaymentMonetizer`.
- `MarketplaceListing` / `MarketplaceSale` — future marketplace interfaces.
- `apiComputeGateway` — the external API-compute contract (route boundaries
  for direct-to-marketplace compute later).

## 9. Verification gates

`backend: npm test` (in-memory prisma stub), `npx prisma validate`,
`npx prisma generate` (build), `frontend: npx tsc --noEmit` and
`npm run build` (NEXT_PUBLIC_API_URL=http://localhost:4000). Final totals in
`PHASE4_IMPLEMENTATION_REPORT.md`.