# AgentFinance → Agent-Revenue Orchestrator: Architecture Gap Analysis

**Date:** 2026-10-01
**Investigated commit:** `a4d61e8` (feat(phase4): compute-to-revenue engine)
**Status:** Investigation only. **No source file was modified.**
**Method:** Full read of schema, migrations, services, routes, tests, docs, frontend; plus
`git log --all` archaeology including pickaxe searches for abandoned concepts.

---

## 0. Executive Summary (read this first)

The engineering discipline in Phases 3–4 is genuinely good: BigInt money math,
SERIALIZABLE transactions, DB-level idempotency, real/simulated separation,
server-side-only pricing. That work must be preserved, not rewritten.

But the investigation found **three structural facts** that determine what can
and cannot be built next:

### Fact 1 — The "external payer" is structurally unreachable in the current API

`PHASE4_COMPUTE_REVENUE_ARCHITECTURE.md:108` and `schema.prisma:361` both intend
that the payer differs from the reward recipient:

```
sellerUserId      String   // reward recipient (contributor); payer differs
```

**In the implemented API, they cannot differ.** The quote is owned by the
requester and the job can only be created by that same owner:

- `backend/src/routes/compute.js:76` — `ComputeQuote.userId = req.user.sub`
- `backend/src/routes/compute.js:101` — `if (!quote || quote.userId !== req.user.sub) → 404`
- `backend/src/routes/compute.js:107` — `sellerUserId: req.user.sub`

The `sellerUserId` field is always the quote owner. A verified external payment
therefore always pays the person who requested the work. **The system cannot
currently express "User A pays, User B earns."** This is the single hardest
blocker on the Agent-Revenue Orchestrator path, and it is a routing/ownership
defect, not a crypto problem.

### Fact 2 — "Real payment verification" is a self-referential HMAC, not external evidence

`MANUAL_CERT` is the only path that produces a non-simulated `RevenueEvent`. It
requires SUPER_ADMIN plus an attestation that the **server itself computes and
the server itself compares**:

- `customerPaymentMonetizer.js:32-38` — `HMAC-SHA256(COMPUTE_PAYMENT_CERT_SECRET, "{id}:{amountWei}")`
- `customerPaymentMonetizer.js:118-126` — returns that same HMAC as the expected verdict
- `revenueService.js:62-68` — compares the request body to that computed HMAC

There is no payment processor, no webhook, no chain receipt of an *incoming*
transfer, no asymmetric signature, and no second party. A SUPER_ADMIN can mint
any amount of "real external revenue" by calling one endpoint with one secret
they already hold. The role gate and the idempotency constraints are real and
tested; the *money evidence* is not.

### Fact 3 — The reward pool can be funded by an admin typing a number

`POST /api/admin/rewards/fund` + `/fund/:id/confirm` credits
`RewardPool.fundedBnb` from an operator-typed amount with **zero verification**:

- `routes/rewards.js:122-137` → `createFundingEvent` (`rewardService.js:587-607`)
- `routes/rewards.js:139-146` → `confirmFundingEvent` (`rewardService.js:609-639`)
- `rewardService.js:603` — `simulated: demoMode()`, normally **`false`**
- Guard is `requireAdmin` = `ADMIN` **or** `SUPER_ADMIN` (`middleware/auth.js:93-95`)

The route's own response text is honest (`routes/rewards.js:132`: *"accounting
only; on-chain funds remain operator-controlled"*), but the DB row is
indistinguishable from genuine `COMPUTE_REVENUE` funding. Combined with
`computeFundedCapacityWei` (`rewardService.js:107-110`), an admin can make any
user's task rewards fully withdrawable without a single external payment.

**Consequence:** a complete withdrawal with **zero revenue** is reachable today
through an admin typing two numbers. Every downstream "earn → withdraw" figure
is therefore not attributable to external economic activity.

### Net position

| Question | Answer |
|---|---|
| Can a user earn real, externally-sourced money today? | **No.** Not in any verifiable sense. |
| Can a user withdraw real crypto today? | **Yes, conditionally** — it is a real `ethers` native transfer from the operator's hot wallet, gated by role + token + cap. It is paid out of the **operator's own funds**, not out of user-attributable revenue. |
| Does the compute economy create real external revenue? | **No.** It books revenue whose verification is self-attested (Fact 2), with payer ≡ seller (Fact 1). |
| Is the agent/task/compute execution layer real? | **Yes** — genuinely real LLM execution via a multi-provider abstraction. This is the strongest asset in the repo. |
| Is there any multi-agent / cross-user / swarm capability? | **No.** Zero. Not partial — absent. |
| Is there any user-to-user agent communication? | **No.** The only artifact is a hardcoded `count: 1` (`routes/sessions.js:19`). |

---

## 0.1 Value Taxonomy (used precisely throughout this document)

The following are **distinct** and the codebase partially conflates them. This
document never uses a lower tier's name for a higher tier.

| Tier | Definition | External source required? | Exists today? |
|---|---|---|---|
| **ACCOUNTING VALUE** | A number in the platform's own ledger. Deterministic, auditable, explainable. **Not a claim that any asset exists.** | No | **Yes** — extensive |
| **REAL EXTERNAL REVENUE** | Value received from an economic actor outside the platform, evidenced by something outside the platform's control. | **Yes** | **No** |
| **EXTERNAL REWARD** | Value granted by a third-party protocol/network, verifiable from that network. | **Yes** | **No** |
| **USER ENTITLEMENT** | A user's contractual claim on the platform for work delivered. Internal until settled. | No | Yes (withdrawable is gated by funding) |
| **SETTLEABLE FUNDS** | Entitlement that passed the funding-ratio gate and can enter the withdrawal pipeline. | No | Yes (gated) |
| **ON-CHAIN ASSET** | A balance at an address, readable by anyone. | n/a | Only the operator's treasury |
| **WITHDRAWABLE ASSET** | A settled on-chain transfer to a user-controlled address. | n/a | **Yes, operationally** — funded by the operator |

Terminology rule for this project:
`generatedBnb`, `taskValue`, `economicValueEstimate`, `RewardEvent`,
`UserRewardBalance.totalEarnedBnb`, and every UI "earnings" figure are
**ACCOUNTING VALUE**. They must never be described as revenue, income,
profit, or earnings in user-facing copy.

---

## A. WHAT CURRENTLY WORKS

Real, working, production-grade. Preserve all of it.

### A1. Agent execution layer — genuinely real work

- **Agent registry + router** (`backend/src/agents/agentRegistry.js`). Three
  active agents — `research`, `general`, `content` — each with declared
  capabilities, an executor, and a provider list (`:31-56`).
- **Executor contract** documented and enforced:
  `run(taskCtx) -> { success, output, provider, model }` (`agentRegistry.js:18-22`).
  Every executor resolves or throws; no task is left hanging.
- **Deterministic routing** — `routeTask` (`agentRegistry.js:118-129`) classifies
  by keyword, no LLM round-trip. Capability-first: returns agent *and* executor.
- **Honest availability derivation** (`getAgentStatus`, `agentRegistry.js:169-203`)
  computes `ACTIVE` / `DEGRADED` / `UNAVAILABLE` / `DISABLED` from real
  conditions: executor registered ∧ provider key present ∧ (for research) a live
  data source. It never fabricates readiness.
- **Research honesty guard** (`agentRegistry.js:74-85`) — if a non-Groq provider
  answered, the output is appended with a capability notice stating it is model
  analysis, not live research. This is exactly the discipline the rest of the
  project needs.
- **Multi-provider abstraction** — `services/llmProvider.js` (20 KB) +
  `providers/{providerFactory,providerConfig,normalizedError}.js`. Providers:
  groq, gemini, cerebras, with fallback. Real LLM calls.
- **Tools** — `tools/toolDefinitions.js`, `tools/toolExecutor.js`.
- **Fleet executor for compute** — `compute/registry.js:22-51` `fleetComputeRunner`
  routes real agent work with a timeout. All three compute "workers" map to this
  same real runner (`:53-63`) — the BullMQ `computeScheduler` branch (`:89-105`)
  is architecture-only and never called in production.

### A2. Task system + lifecycle

`Task` with retry, archived flag, lifecycle gating (`services/taskLifecycle.js`),
analytics, per-agent activity, inline WS + Redis bus under the `agentfi:`
namespace. Task→agent routing was activated in `2ac112b`.

### A3. Money-math discipline (the strongest part of the repo)

- `utils/decimal.js` — exact BigInt arithmetic, floor semantics.
- `rewardService.js` — SERIALIZABLE transactions, per-user ledger invariant
  (`:13-15`), pool invariant `funded − settled − reserved ≥ 0`.
- Server-authoritative pricing: `ComputePricingEngine` never accepts a client
  amount; the client may only present a `quoteId` (`pricingEngine.js:48`).
- **DB-enforced idempotency** — `RevenueEvent_paymentIntentId_key` UNIQUE
  (migration `ddaaf70`) guarantees one revenue event per payment under
  concurrency, not just in application logic.
- Withdrawal reservation/settlement/release with a real `SettlementRecord`
  lifecycle (`rewardService.js:352` / `421` / `479`).
- Role checks are server-authoritative, read from the DB on every request
  (`middleware/auth.js:74-91`) — never trusted from the JWT or body.

### A4. Real withdrawal pipeline (the one real on-chain capability)

`services/payoutService.js` contains a genuine `ethers` v6 native transfer:

- `broadcastEvmPayout` (`:394-445`) — real `JsonRpcProvider` (`:412`), real
  `new Wallet(privateKey)` (`:413`), real `signer.sendTransaction` (`:422`).
- Real receipt polling — `refreshPayoutStatus` (`:666`), `getTransactionReceipt` (`:680`).
- Gates: `authMiddleware` + `requireAdmin` at the route, `approvalToken` match
  (`:502-504`), self-approval blocked except SUPER_ADMIN (`:496-498`), hard
  amount cap re-checked at approval (`:513-520`), demo mode hard-refuses
  broadcast (`:487-492`), no re-broadcast (`:506-507`).
- **Bitcoin is honestly hard-disabled** (`:539-549`) rather than faked.
- Frontend has EIP-6963 wallet discovery and a network picker; the user chooses
  their own destination address.

**This is a working withdrawal rail. It is paid from the operator's own hot
wallet. It is not connected to any revenue.**

### A5. Authentication / authorization

Session-bound JWT (`AuthSession`, single active device), bcrypt, email
verification, OAuth, server-authoritative roles, EIP-6963 discovery, rate
limiters. `middleware/auth.js` is well written and consistent.

### A6. Real-time infrastructure

Inline WebSocket in `index.js` plus Redis pub/sub on `agentfi:tasks` and
`agentfi:compute` (`routes/compute.js:46-52`). Best-effort, DB is source of
truth — correct posture.

### A7. Tests

125 backend tests, 0 failing, including 20 Phase-4 economic-invariant tests.
They assert **authorization and accounting invariants** rigorously (rejected
paths book zero revenue; concurrent verify books exactly one event; reward ==
funding allocation exactly; unmonetized jobs book zero).

**Limitation, stated plainly:** `reward_engine.test.mjs:165-176` and
`compute_economy.test.mjs:276-287` replace Prisma with an in-memory object.
No test touches a database, an RPC, a signer, or a broadcast.
`broadcastEvmPayout` is never exercised. The suite proves the *ledger is
consistent*, not that *money moved*.

---

## B. WHAT CURRENTLY ONLY SIMULATES ACCOUNTING VALUE

Explicitly: these produce **ACCOUNTING VALUE** (tier 1). None is revenue.

### B1. Task completion rewards — the largest source

`createRewardForTask` (`rewardService.js:135-211`) mints a reward for every
completed, result-bearing task that has an `agentId`. The amount is a pure
function of env constants and two integer counters:

```
calculateRewardForTask (rewardCalculator.js:31-51)
  = agentTaskValueWei(agent)        // 0.0012 / 0.0008 / 0.0010 BNB — rewardConfig.js:35-46
  × rewardRateFraction()            // 0.35                    — rewardConfig.js:54
  × qualityMultiplier(len(result))  // 0.60–0.95 by STRING LENGTH — rewardConfig.js:69-81
  × difficultyMultiplier(agent)     // 1.10 / 0.90 / 1.00     — rewardConfig.js:84-95
  × reliabilityMultiplier(retry)    // 0.85 if any retry       — rewardConfig.js:99-105
  → clamped to [REWARD_MIN_PER_TASK, REWARD_MAX_PER_TASK]
```

Worked example: a first-attempt research task with a 2500-char result books
`0.0012 × 0.35 × 0.95 × 1.10 = 0.0004386 BNB` **into existence**. The only
input beyond an env constant is how many characters the LLM wrote and whether
it was retried. The word count of an AI response *is* the economic value model.

The code comments are honest — `rewardConfig.js:32-34`: *"an accounting VALUE of
the generated reward pool, NOT a claim about real BNB existing on-chain."* The
problem is not the comment; it is that this number is rendered to users as
"Total Earned … BNB" (`frontend/src/app/wallet/page.tsx:365`) and "Auto
earnings" (`frontend/src/app/login/page.tsx:157`).

### B2. ETH "earnings" ledger — display-only

`backend/src/services/earningsService.js:1-6`: *"Default rate: EARNING_RATE_ETH
(0.0035 ETH per completed task)."* Credits `eligible.length × rate` (`:40`).
No pool, no funding, no holdings, no chain. BigInt/wei formatting lends it
visual authority it has not earned.

It is recomputed **client-side in four places**, hardcoded:
- `frontend/src/app/analytics/page.tsx:34`
- `frontend/src/app/dashboard/page.tsx:246`
- `frontend/src/app/profile/page.tsx:81`
- plus a flat `$3200/ETH` conversion in `analytics/page.tsx:29-35`

### B3. Compute "economic value"

`compute/valueEngine.js` — `estimateComputeValueBnb`, a size-grade × reliability
formula returning `baseValueBnb = 0.0010` scaled 0.70–1.30 by output bytes. It
correctly self-labels `'Economic value estimate only — not money.'` (`:40`).
It is imported by **no production route or service** (test-only). This one is
honest and unused — the right default.

### B4. Compute cost — derived, not measured

`ComputeCost` (`jobService.js:163-173`) records the quote's own
`serviceCostBnbWei` — i.e. the 45% remainder of the sale price — as an
`INFERENCE` cost with `source: 'INTERNAL'`. It is **not** measured token spend.

The honest cost model was designed and never written: `TokenUsage`
(`schema.prisma:129-138`, `promptTokens`/`completionTokens`/`totalTokens`/
`costCents`) is **orphaned** — zero writers, zero readers. Real token data is
produced by `llmProvider.callProvider` and discarded (`agentRunner.js:361-367`).
So the platform does not actually know what its work costs it.

### B5. Simulated compute revenue

`COMPUTE_ECONOMY_DEMO_MODE=true` → any ADMIN verifies a payment from an
invisible `SIMULATED_CUSTOMER` (`customerPaymentMonetizer.js:69`), figures tagged
`simulated` and excluded from real totals. Correctly isolated throughout
(`revenueService.js:200-208`). Safe — but note that
`compute_economy.test.mjs:568` asserts `availableToWithdrawBnb > 0` **in demo
mode**, i.e. simulated money produces a non-zero withdrawable balance. The
`simulated` flag is stored but **never checked** in `computeSettleableWei`.

---

## C. WHAT CURRENTLY REPRESENTS REAL EXTERNAL VALUE

**Nothing.** This section is deliberately short.

Searched exhaustively: no payment-processor SDK, no Stripe/PayPal/LemonSqueezy,
no Gumroad/Shopify/Etsy integration in `backend/src`, no inbound transfer
listener, no webhook handler, no chain receipt verification of an incoming
payment, no bridge, no faucet claim, no protocol reward claim, no bounty claim,
no relayer, no mint.

The only real value artifacts anywhere in the system are:

1. **An outbound on-chain transfer** (`payoutService.js:422`) — real, but money
   leaving the operator. It is not a *revenue* event.
2. **Real LLM inference** — genuine economic cost incurred, correctly never
   booked as revenue. This is the platform's real-world economic activity today:
   it *spends*, it does not *earn*.
3. **`ComputeOutput.resultHash`** (sha256) — a real cryptographic artifact
   attesting to delivered work. Genuinely useful as a delivery proof. It is not
   money, but it is the seed of a real attribution mechanism.

The closest thing to a real external revenue channel is the **digital factory**,
and it is not wired:

- `DigitalProduct.price` (default 49) exists (`schema.prisma:256`).
- `digital-factory/src/publishers/gumroad.js:32-44` makes a **real HTTPS call**
  to `POST https://api.gumroad.com/v2/products` with a real access token —
  **if** `GUMROAD_ACCESS_TOKEN` is set. This is the only code path in the
  repository that could transact with a real external economic actor.
- **But**: file upload is explicitly skipped (`gumroad.js:41-42`
  *"Implementation skipped - requires multipart"*), so a listed product has no
  deliverable. Same omission in `shopify.js`, `etsy.js`, `woocommerce.js`.
  `payhip.js:5-17` returns a manual instruction string and makes no API call.
  `etsy.js:29` uses a placeholder `taxonomy_id: 123`.
- These are standalone CLI scripts. `factoryService.js` **never imports them**.
  `backend/src/routes/factory.js` has **no publish endpoint**.
- No live listing URL for any product exists in the repository.
- `digital-factory/catalog/approved_products.json` contains LLM-generated
  validation claims (*"3-5 qualified leads/week, 60% close rate, $2k+ per
  client"*) committed as if they were market data. **This is AI output presented
  as market validation and must not be reused as a revenue model.**

**Verdict: the only credible route to real external revenue is selling an actual
digital product to an actual customer through a real marketplace with a real
payment processor. That channel is ~70% unbuilt (file delivery + publish wiring)
and requires merchant credentials, which do not exist in this repo.**

---

## D. WHAT CAN CURRENTLY BE WITHDRAWN TO A REAL WALLET

### D1. The mechanism is real

`Payout` → prepare → admin approve → `broadcastEvmPayout` → on-chain transfer →
receipt polling. Networks: Ethereum, Polygon, Arbitrum, Base, BSC
(`payoutService.js:22-70`). Bitcoin is disabled.

### D2. What is actually withdrawn

**The operator's own funds.** Precisely:

- `RewardPool.fundedBnb` is a Postgres `TEXT` column (`schema.prisma:210`).
  It is **not connected to any wallet**. Nothing reads it before signing.
- `broadcastEvmPayout` (`:404-426`) debits whatever is in
  `TREASURY_PRIVATE_KEY`. The code never funds it, never sweeps into it, and
  **never checks the balance before signing** — the only balance awareness is
  the error sanitiser's *"Insufficient funds in the treasury wallet"* (`:380`).
- `onChainTreasuryBalanceBnb` is hardcoded `null` in `getPoolOverview`
  (`rewardService.js:579`) and only populated for the **admin** overview
  (`routes/rewards.js:104-106`). The public `/api/rewards/pool` always returns
  `null`.

### D3. So a withdrawal today is

> The operator transfers their own crypto to a user, sized by an internal
> accounting number, approved by an admin.

That may be a perfectly good subsidy, reward, or stipend programme. **It is not
revenue, and it is not a marketplace.** The distinction must be stated in the
product, not just in code comments.

### D4. Three defects that corrupt settlement correctness

These are code bugs, not design disagreements. They are listed because they sit
directly on the settlement path the orchestrator depends on.

1. **A reverted withdrawal is never reversed.**
   `payoutService.js:701-702` calls `releaseReservation`, but
   `rewardService.js:484` early-returns when the record is already `SETTLED`.
   Since settlement is booked at broadcast (`:595`), a reverted payout leaves
   `UserRewardBalance.settledBnb` permanently debited. The compensating warning
   at `payoutService.js:713-718` is therefore **unreachable dead code**.

2. **Settlement is booked on a tx hash, not on a receipt.**
   `payoutService.js:591-601` settles immediately after `sendTransaction`
   returns. Combined with (1), the ledger can permanently over-report settled
   withdrawals.

3. **Cross-asset unit conflation.** `payoutService.js:339` reserves from the
   **BNB**-denominated pool using an amount denominated in the payout network's
   native asset. A 0.05 **ETH** withdrawal reserves 0.05 "BNB". No FX
   conversion on the payout side.

Also: `approvalToken` is returned to clients in `listPayouts` (`:737`) and
`listPayoutsForAdmin` (`:657-663`) and read straight off the admin queue object
by `frontend/src/app/admin/page.tsx:150`. It is not a secret and does not
function as one.

---

## E. WHAT PREVENTS COMPUTE/TASK REVENUE FROM BECOMING A REAL USER ASSET

Ordered by severity. Each is a specific blocker, not a theme.

### E1. No external payer can exist (payer ≡ seller)

`compute.js:76` + `:101` + `:107`. A user cannot buy compute on behalf of
another user. There is no route where User A's verified payment credits User B's
balance. **Everything downstream — attribution, collaboration, cross-user
swarms — is blocked on this.** Fixing it is a routing/ownership change, not a
blockchain change.

### E2. "Verification" is self-attested

`customerPaymentMonetizer.js:32-38` + `:118-126`; `revenueService.js:62-68`.
A SUPER_ADMIN with the operator secret can certify any amount. There is no
evidence from outside the platform. Combined with `requireAdmin` including
plain `ADMIN` for *submit* and *refund*, plus a `MANUAL_CERT` intent that
defaults when the secret is unset, the boundary between "externally paid" and
"internally declared" is a policy setting, not a fact.

### E3. The pool can be funded by fiat-typing

`routes/rewards.js:122-146` → `rewardService.js:587-639`. Admin-typed
`amountBnb` → `fundedBnb`, with `simulated: demoMode()` (normally `false`), so
the row is **indistinguishable from real revenue funding**. `SOURCE_TYPES`
(`rewardService.js:42-49`) explicitly permits `TREASURY_ALLOCATION`,
`APPROVED_LOAD`, `OTHER` — i.e. the *intent* to permit unbacked funding is
baked into the schema-level vocabulary.

This is the direct answer to *"what prevents task revenue from becoming a real
user asset"*: **nothing currently verifies that revenue was ever received.**

### E4. No custody of the revenue between booking and withdrawal

`RevenueEvent` is booked from an attestation, but the corresponding assets are
**never actually received** by the platform. `PaymentIntent.settledAt` is set
(`revenueService.js:156`) at the moment of *certification*, not settlement.
`Payout` then pays out of an unrelated treasury balance. The two ledgers are
never reconciled. There is no `RevenueEvent → Payout` link, no per-revenue
balance, no sweep, no reconciliation job.

### E5. Refunds do not unwind pool funding

`jobService.js:232-234` nulls `job.revenueEventId` on refund but leaves the
`RevenueEvent`, both `RevenueAllocation` rows, and the `RewardPool.fundedBnb`
credit **in place**. A refunded payment therefore permanently inflates the
`funded/generated` ratio, raising every user's `availableToWithdrawBnb`.

### E6. The funding ratio is global, not attributable

`computeFundedCapacityWei` (`rewardService.js:107-110`) pro-rates a user's total
earned by the *pool-wide* `funded/generated`. Task rewards (unfunded) dilute
compute rewards (funded) and vice versa. Rewards are not attributable to the
revenue that created them. **There is no per-revenue-event or per-job entitlement
ledger.** This is a prerequisite for multi-party reward splitting.

### E7. No customer identity for external buyers

`ComputeCustomer` (`schema.prisma:348-355`) is a display-name stub with no
credentials, no auth, no payment method. An external payer **cannot
authenticate to buy compute**. The original repo had exactly this and lost it:
the root schema at `19fda2f` had `Agent.apiKeyHash` + `AgentSession` and
`routes/auth.ts` registered agents by API key. That was deleted at `1881df3`.

### E8. No real cost basis for pricing or margin

`ComputeCost` is derived from the sale price (`jobService.js:163-173`).
`TokenUsage` is orphaned. The platform cannot compute gross margin, so it
cannot price honestly or prove profitability. (`revenueService.js:227`
`revenueNeverEqualToComputeCost` is a tautology — revenue = price, cost = 45% of
price, so they are structurally never equal. It asserts nothing.)

### E9. Front-of-house copy contradicts the money layer

| Claim | Location | Reality |
|---|---|---|
| "AI agents that generate income for you" | `login/page.tsx:72` | No external income path exists |
| "Auto earnings" 💰 | `login/page.tsx:157` | A counter × `0.0035`, unfunded |
| "Estimated earnings … ETH" | `dashboard/page.tsx:294-295` | Client-side formula |
| "Total Earned … BNB" | `wallet/page.tsx:365` | Accounting value, unfunded ratio |
| "Autonomous Yield Operating System" | `layout.tsx:6-8` | No yield mechanism exists |

The wallet page itself is the good counter-example — `:561` correctly states that
withdrawals are capped by the funded share. The problem is that the *growth*
metric ("Total Earned") is unbounded while the *withdrawable* metric is zero, and
the marketing pages describe the first as income.

### E10. Dead integrity mechanisms

`verifyQuoteBindings` and `quoteAmountBnbEqualTo` (`pricingEngine.js:114`, `:127`)
are **never called**. The `payloadHash` integrity binding described in
`PHASE4_COMPUTE_REVENUE_ARCHITECTURE.md:85` is inert. Quote amounts are frozen
by immutability instead, which is weaker than the advertised binding.

---

## F. WHAT AGENT CAPABILITIES ALREADY EXIST

Solid, real, and reusable as the execution core of an orchestrator.

| Capability | Evidence | Status |
|---|---|---|
| Agent registry with declared capabilities | `agentRegistry.js:31-56` | Real |
| Task classification / routing | `agentRegistry.js:118-129`, `taskClassifier.js` | Real, deterministic |
| Executor contract | `agentRegistry.js:18-22` | Real, 6 executors |
| Research / General / Content agents | `agentRegistry.js:74-97` | Real |
| Multi-provider LLM + fallback | `services/llmProvider.js`, `providers/*` | Real (groq/gemini/cerebras) |
| Tool execution | `tools/toolExecutor.js`, `toolDefinitions.js` | Real |
| Web search for research | `agentRegistry.js:63-67` (Tavily/Serper) | Real, optional |
| Honesty guards on degraded capability | `agentRegistry.js:74-85`, `:169-203` | Real — **exemplary, replicate this pattern** |
| Task lifecycle + retry + recovery | `services/taskLifecycle.js`, `workers/agentWorker.js` | Real |
| Output hashing / delivery proof | `jobService.js:135-136` | Real (sha256) |
| Real-time event bus | `agentfi:tasks`, `agentfi:compute` | Real |
| Task→reward linkage | `rewardService.js:135` | Real, but see B1 |

There is exactly **one** worker/executor per active agent type. There is no
competition, no bidding, no selection among multiple candidates for a job.

---

## G. WHAT MULTI-AGENT CAPABILITIES ALREADY EXIST

**Effectively none. This is a greenfield area, not an evolution of existing code.**

Repo-wide term sweep across `backend/src`, `frontend/src`, `shared`,
`coordinator`, `subtask-worker`, `worker/src`, `websocket/src`:

| Term | Hits |
|---|---|
| `swarm` | **0** |
| `consortium` | **0** |
| `peerAgent` / `agentToAgent` | **0** |
| `orchestrat*` | 3 — **all UI strings** (`agents/page.tsx:71`, `TaskFlowChart.tsx:7`, a commented line in `app/page.tsx:12`). No backend module. |
| `participant` | Backend: **one hardcoded literal** `count: 1` at `routes/sessions.js:19` |

### G1. What exists in history but is orphaned

This is the closest thing to recoverable multi-agent architecture, and it is
**schema-live but runtime-dead**:

- `CoordinatorTask` / `SubTask` models (`schema.prisma:95-120`) — hierarchical
  plan → fan-out → reconcile, with `attempts` / `maxAttempts` / `lastError` per
  subtask and an `AuditLog` trail.
- `coordinator/index.js` and `subtask-worker/index.js` — implemented services
  that poll, plan, fan out over Redis lists, and publish results.
- **Zero consumers in `backend/src`** (verified by grep). The whole tree runs as
  one flat `Task` through one BullMQ queue.
- `PUBLIC_READINESS_AUDIT.md:35` confirms these services are "**NOT** deployed in
  the Render two-service setup"; `:481` lists their broken start scripts and
  ESM/CJS mismatch as cleanup items.

So: a **plan/decompose/fan-out** substrate exists on disk and in the live
database, but is not running and was not verified running.

### G2. Other abandoned infrastructure

- `utils/agentQueue.js` — shortest-queue load balancing (`chooseAgents`,
  `pushTask`), still mounted at `/api/dispatch` with a **hardcoded
  `AGENTS || 'alpha,beta,gamma'` fallback**. This is a genuine task-auction
  primitive that Phase 4 bypasses entirely (quotes route to a
  `ServiceCatalog.agent` column, not to competing agents).
- `agent:queue:*` Redis lists are **write-only** — 2 hits repo-wide, both the
  writer. No consumer.
- `agentfi:coord` `perform:subtask` bus — a live, admin-gated, authenticated
  publish with **no in-process subscriber**; only the undeployed
  `worker/src/index.js:20-39`.
- `websocket/src/ws.js` — JWT rooms, 5 s presence heartbeat, Redis-Streams
  bridge. Broken: `wss` instantiation is **commented out** at `websocket/src/ws.js:22`,
  so any use throws `ReferenceError`. Notably, the only *real* participant-count
  implementation lives in this non-booting file
  (`websocket/src/ws.js:171,196`), while the live one is the hardcoded `1`.
- `frontend/src/context/CollabContext.tsx` — exists; `CollabProvider` is
  **never mounted** (`layout.tsx:18-29`).
- `compute/marketplace.js` — `MarketplaceListing` / `MarketplaceSale` /
  `ComputeGatewayRequest` are JSDoc typedefs plus a frozen array of
  comma-joined column names. Self-labelled "ARCHITECTURE ONLY". Zero imports.
  Worth reviving as a schema contract; contains no logic.

### G3. What must be built for swarms (nothing exists today)

Every one of the swarm requirements is absent:

| Requirement | Status |
|---|---|
| participants | Absent (one hardcoded `1`) |
| roles | Partial — `Agent.role` is a free-text prompt field, not an assignment |
| contribution | Partial — `ComputeOutput.resultHash` per job; nothing per participant |
| reward allocation | Absent for swarms — only single-seller `finalizeComputeJob` |
| authorization | Single-owner only (`quote.userId === req.user.sub` blocks all collaboration) |
| completion state | Partial — `ComputeJob.status` exists, job-level only |
| payment/reward source | Single customer, unreachable externally (E1) |
| settlement record | `SettlementRecord` exists but is one-payout-per-user only |

---

## H. WHAT USER-TO-USER AGENT COMMUNICATION ALREADY EXISTS

**Nothing.** Not partial — absent.

- No agent-to-agent protocol, no message envelope between users, no A2A
  transport, no agent credential that would let one user's agent act for another.
- The only cross-user shape is `CollabSession` in the **root** schema at `19fda2f`
  — deleted from the backend schema, along with `Agent.apiKeyHash`,
  `AgentSession`, `AgentEvent`, `SessionLog`, and the API-key registration route
  `backend/src/routes/auth.ts`. All removed at merge `1881df3`.
- `routes/sessions.js` is the only live artifact: a `POST /api/sessions/join`
  that writes `{type:'join', user, ts}` to a Redis stream and publishes a
  **hardcoded** participant count of 1 (`:19`). It cannot express two users.
- `Task.userId` is single-valued; `RewardEvent.userId` is single-valued. The data
  model has no way to say "these two users did this job."

**Auth is the hard stop.** The only principal is `User` with a bcrypt password
(`middleware/auth.js`). An agent acting on behalf of a user cannot be
authenticated as anything but that user, so User A's agent cannot be
distinguished from User A. Every agent-to-agent primitive requires an agent
identity with its own credentials — which the repo had and deleted.

---

## I. WHAT IS MISSING

Grouped by the dependency order in which they must be built.

### I0. Foundations (everything else depends on these)

1. **A verified external payment channel.** A real gateway (processor or direct
   on-chain inbound with receipt verification) whose success is provable without
   operator trust. **This is the gate on the entire product thesis.**
2. **A custody + reconciliation layer.** Revenue received must be held,
   attributed per event, and reconcilable against payouts. Today it is not
   received at all.
3. **Agent identity with its own credentials.** Restore the `apiKeyHash` /
   session model so an agent is a first-class principal that can be authorized,
   scoped, and revoked independently of a user session.
4. **A value taxonomy enforced in the type system.** `ACCOUNTING` vs
   `EXTERNAL_REVENUE` vs `SETTLEABLE` vs `WITHDRAWABLE` as distinct types/fields,
   not conventions in comments.

### I1. Economic integrity (must precede any multi-user feature)

5. Remove or hard-restrict admin-typable pool funding; treasury allocation must
   never be commingled with revenue-derived funding (`rewardService.js:587-639`).
6. Replace self-HMAC attestation with external verification, or rename the
   concept to what it is (`OPERATOR_ASSERTED`) and never surface it as external
   revenue.
7. Per-event entitlement ledger replacing the global `funded/generated` ratio
   (`rewardService.js:107-110`).
8. Make refund unwind revenue **and** pool funding (`jobService.js:232-234`).
9. Fix settlement-on-receipt, not settlement-on-broadcast, and fix the
   unreachable reversal branch (§D4.1–2).
10. Multi-asset reservation with FX, or restrict payouts to the reward asset.
11. Revoke `approvalToken` from client-visible payloads.
12. Call `verifyQuoteBindings` (`pricingEngine.js:114`) or delete it.

### I2. Multi-agent / orchestration

13. Revive and verify `CoordinatorTask`/`SubTask` + coordinator/subtask-worker,
    or design a replacement. Plan → fan-out → reconcile with per-participant
    records.
14. A `Job` aggregate: participants, roles, contributions, authorization,
    completion state, allocation policy, settlement record.
15. Agent selection as a real decision: multiple candidate executors per
    capability, with a selection rule (capability match, load, cost).
16. Bring `websocket/src/ws.js` to a booting state, or fold presence/rooms into
    the inline server.
17. Mount `CollabProvider` or delete it.

### I3. Cross-user economics

18. **Break payer ≡ seller** (§E1). A job must be able to have a payer and a
    different beneficiary. This is the enabling change for sections 2–3 of the
    target flow.
19. Buyer-side authentication and checkout (`ComputeCustomer` has no identity).
20. Multi-beneficiary reward allocation (one revenue event → N users, split
    deterministically and audited).
21. Inter-user authorization: delegation, consent, revocation. A user must be
    able to authorize another user's agent to contribute to their work.

### I4. Honesty and surface correctness

22. Rewrite user-facing money copy to match the tier taxonomy (§E9). Delete
    "Auto earnings", "generate income for you", and the client-side `0.0035`
    computations, or clearly label them ACCOUNTING VALUE / ESTIMATE.
23. Remove hardcoded UI data: `AnalyticsChart.tsx:30` (a literal `400`/`100`
    pie), the flat `$3200/ETH`.
24. Delete or quarantine `approved_products.json`'s LLM-generated "60% close
    rate" claims.
25. Fix the broken `/factory/[slug]` link and repair the stale E2E specs.

### I5. Measurement

26. Write `TokenUsage`. Real cost attribution is a prerequisite for honest
    pricing and for any claim about margin.

---

## J. WHAT CAN BE IMPLEMENTED SAFELY NOW

These require **no external network, no credentials, and no money movement**.
They are pure correctness, honesty, and structure. All are additive or
behaviour-preserving.

### J1. Highest value, zero economic risk

| # | Action | Files | Why safe |
|---|---|---|---|
| J1.1 | Introduce a single `ValueTier` vocabulary and surface it in every money API response and every UI money component | new `services/moneySemantics.js`; `routes/{rewards,compute}.js`; frontend money components | Pure labelling. Changes no math. Immediately kills the "accounting = money" confusion. |
| J1.2 | Rename `MANUAL_CERT` → `OPERATOR_ASSERTED`, keep the HMAC gate, and surface it as "operator-attested", never "external revenue" | `customerPaymentMonetizer.js:27-30`, `revenueService.js:62`, `routes/compute.js:221-240`, admin UI | Honest reclassification. No behaviour change. |
| J1.3 | Deprecate `POST /api/admin/rewards/fund` for revenue-shaped source types; force `TREASURY_ALLOCATION`/`APPROVED_LOAD`/`OTHER` to a separate, non-entitlement pool or require SUPER_ADMIN + an explicit `notExternalRevenue` flag | `routes/rewards.js:122-146`, `rewardService.js:587-639` | Closes the "type a number → withdrawable" hole. Existing rows untouched. |
| J1.4 | Fix the settlement defects: settle on receipt, and make reversal actually work | `payoutService.js:591-601`, `:699-718`, `rewardService.js:479-499` | Fixes a real correctness bug. Requires migration only if a status value is added. |
| J1.5 | Make refund unwind revenue, allocations, and pool funding in one transaction | `jobService.js:222-236` | Removes permanent ratio inflation. Additive compensating entries; no row deletion. |
| J1.6 | Stop returning `approvalToken` in list endpoints | `payoutService.js:657-663`, `:737` | Removes a fake secret. Frontend admin page needs a token from somewhere legitimate — read it from the approve request path instead. |
| J1.7 | Call `verifyQuoteBindings` in the job-create path, or delete the dead functions | `pricingEngine.js:114-136` | Either restores a documented integrity guarantee or removes a misleading claim. |
| J1.8 | Correct front-of-house copy and delete invented numbers | `login/page.tsx:72,157`; `analytics/page.tsx:29-35`; `dashboard/page.tsx:246,294`; `profile/page.tsx:81`; `AnalyticsChart.tsx:30` | Removes misleading claims. Trivially reversible. **Highest reputational value per line changed.** |
| J1.9 | Write `TokenUsage` from `llmProvider.callProvider` | `llmProvider.js` call site, `agentRunner.js:361-367` | Additive insert into an existing orphaned model. Gives real cost attribution. |
| J1.10 | Add `real` vs `asserted` vs `simulated` separation to every overview surface, including the reward pool | `revenueService.js:195-229`, `rewardService.js:562-583` | The compute side already separates; the reward side does not. |

### J2. Structural preparation for the orchestrator (additive, no behaviour change)

| # | Action | Why safe |
|---|---|---|
| J2.1 | Add a `Job`/`Swarm` aggregate: participants, roles, contribution hashes, allocation policy, authorization record, completion state — **with no writer that grants money** | Pure schema. Nothing can book reward from it until a later phase wires it. |
| J2.2 | Add `AgentIdentity` (hashed API key, scopes, revocation) **without** enabling cross-user delegation | Schema + auth primitives only. No authorization semantics change yet. |
| J2.3 | Add a `payerUserId` distinct from `sellerUserId`, defaulted to the current owner | Fully backward compatible. Unblocks E1 in a later, deliberate step. |
| J2.4 | Add `RevenueEvent → Entitlement → Payout` reconciliation fields and a read-only reconciliation report | Read-only first. Makes the custody gap visible before it is closed. |
| J2.5 | Implement `marketplace.js`'s `MarketplaceListing`/`MarketplaceSale` as real models | The typedefs already exist; this makes them real without changing money math. |
| J2.6 | Bring `websocket/src/ws.js` to a booting state with real presence; mount `CollabProvider` | Infrastructure only. No economic effect. |
| J2.7 | Wire `CoordinatorTask`/`SubTask` execution **in read-only/plan mode first** (plan generation, no reward effect) | Recovers the abandoned orchestrator substrate safely — observe before it can move money. |
| J2.8 | Implement a real executor-selection layer (capability match + load) with the current single executor per agent as the only candidate | No behaviour change until >1 candidate exists. |

### J3. Explicitly safe sequencing rule

Build **J1 → J2 → J3**, where within J2 the sub-order is
`J2.3 (payer/seller split) → J2.1 (Job aggregate) → J2.2 (agent identity) → J2.4 (reconciliation)`.
Money-granting behaviour comes **last**, and only after §K.

---

## K. WHAT REQUIRES AN EXTERNAL PAYMENT/REWARD NETWORK

This section lists what **cannot** be built in this repository alone. Per the
economic rules, **no external revenue source will be invented here.** Each item
below is a genuine integration that must be chosen, credentialed, and legally
accounted for by the operator.

### K1. Verified inbound payments (the gate)

Required, non-negotiable, and currently absent. Options, **none selected**:

- A payment processor with server-side webhook signature verification
  (the market-standard approach; requires merchant onboarding, KYC, chargeback
  exposure, and a settlement account).
- Direct on-chain inbound with **receipt verification by an independent party or
  contract**, not by the platform's own attestation.
- A hosted checkout the platform does not custody.

**Requirements for any chosen channel:**
- The verifier must be outside the platform's control (the processor, the chain,
  or a contract) — a self-HMAC does not qualify.
- Idempotency keyed on the **processor's** event id, not on our own intent id.
- Webhook signature verification (asymmetric) before any state change.
- A real custody model: where the money actually sits between booking and
  withdrawal.
- Reconciliation: processor payouts vs `RevenueEvent` vs `Payout`, with a
  documented break policy.

### K2. A real external reward network (if pursuing protocol rewards)

Not applicable today — there is no integration, and **none should be
fabricated**. Explicitly out of scope and prohibited by this project's rules:
mining of any kind, hidden use of user CPU/GPU, faucet claims presented as
income, and self-paying loops. If a legitimate externally-verifiable reward
network is ever adopted, it must be a real protocol with a real verifier.

### K3. The digital-product channel (the most credible existing path)

Already partially built, needs credentialed completion, not invention:

- Complete **file delivery** in the Gumroad/Shopify/Etsy/WooCommerce connectors
  (`gumroad.js:41-42` is explicitly skipped).
- Fix `etsy.js:29` `taxonomy_id: 123` and remove the Payhip stub.
- Wire a **publish endpoint** into `routes/factory.js` and a
  `POST /api/factory/:slug/publish` that calls the connectors.
- Obtain and configure real merchant credentials.
- Handle the resulting sales as revenue with a real payer and a real receipt.
- This is the only route where the *product itself* (not a self-attestation)
  carries economic value.

### K4. Cross-user agent commerce (requires K1 + authorization semantics)

- Real payment rails (K1) **plus** a delegation/consent model a user can grant
  and revoke, before any cross-user attribution is meaningful.
- Until then, cross-user reward splitting would be an internal transfer
  presented as an economic outcome — which this project must not do.

### K5. Custody, FX, and multi-asset settlement

- Real custody accounts per asset.
- Real FX/reference rates at settlement time, from an external source (the
  existing `COMPUTE_ASSET_BNB_PRICE_*` are **operator-supplied constants**,
  which is honest but is not a market).
- A treasury key-management strategy (the current single hot
  `TREASURY_PRIVATE_KEY` is an operational risk, not an architecture).

---

## L. WHAT SHOULD REMAIN FUTURE WORK

Deferred deliberately, with the reason.

| # | Item | Why deferred |
|---|---|---|
| L1 | Competitive agent bidding / auction | Needs a real job market with real payers (K1) and >1 executor per capability. `agentQueue.chooseAgents` exists as a primitive but has no callers and a hardcoded agent list. |
| L2 | Reputation / trust scores | Needs a history of real outcomes. Any score built on today's accounting rewards would encode B1's length-of-response proxy. |
| L3 | Esrow with external arbitration | Needs a real counterparty and dispute process. Internal reservation is not escrow. |
| L4 | Governance / DAO / token issuance | Out of scope. Introducing a token before real revenue would be a self-referential value claim. |
| L5 | DeFi yield strategies | The original thesis (`toolDefinitions.js` `analyse_opportunity`: arbitrage / yield farming / staking) predates Phase 4. Phase 4 explicitly banned treasury-as-revenue. **Do not revive without a separate, explicit risk mandate.** |
| L6 | Bitcoin payouts | Hard-disabled honestly at `payoutService.js:539-549`. Needs signing infrastructure and a custody story. Keep disabled. |
| L7 | Full microservice decomposition (coordinator/worker/websocket as separate deploys) | `PUBLIC_READINESS_AUDIT.md:481` records broken start scripts and ESM/CJS mismatch. Consolidate first; split only when the single process is a proven bottleneck. |
| L8 | Self-serve compute checkout UI | Requires K1. A checkout that cannot take money is worse than no checkout. |
| L9 | Per-participant swarm reward splitting | Requires E1 fix + Job aggregate + a real revenue event. Sequence after J2. |
| L10 | Proven profitability | Requires real cost data (J1.9) plus real revenue (K1). **Do not model or imply this until both exist.** |

---

## M. Recommended Sequence (no code changed yet)

```
PHASE 0  Honesty + integrity fixes            (J1)   no credentials, no risk
   └─ J1.1 value tiers · J1.2 OPERATOR_ASSERTED · J1.3 close the funding hole
      J1.4 settlement on receipt · J1.5 refund unwinds · J1.8 copy · J1.9 TokenUsage

PHASE 1  Additive structure, still no money     (J2)
   └─ J2.3 payer ≠ seller · J2.1 Job/Swarm aggregate · J2.2 agent identity
      J2.4 reconciliation (read-only) · J2.5/J2.6/J2.7 marketplace, presence, coordinator

PHASE 2  Choose and integrate a REAL revenue channel   (K1 or K3)
   └─ operator decision + merchant credentials + webhook/receipt verification
      THIS IS WHERE REAL USER ASSETS BECOME POSSIBLE

PHASE 3  Multi-user attribution & settlement           (I3, K4)
   └─ only after PHASE 2 produces real revenue events

PHASE 4  Competitive / swarm / marketplace dynamics   (L1, L2, L9)
```

**Invariant for every phase above:** a completed task never creates money. Only
a `RevenueEvent` backed by externally verifiable evidence may do so, and only
that evidence may raise `RewardPool.fundedBnb`.

---

## Appendix: Verification Notes

- All monetary figures quoted are **ACCOUNTING VALUE** unless explicitly marked
  otherwise. The `0.004 BNB / 0.014 BNB` totals in
  `PHASE4_IMPLEMENTATION_REPORT.md:64-65` are **test-trace artifacts** from an
  in-memory store, not observed production economics.
- `broadcastEvmPayout` is real code that has not been verified as exercised in
  this investigation (no RPC/keys available, and no test covers it).
- `PUBLIC_READINESS_AUDIT.md` is dated 2026-09-15 and is **largely superseded**;
  it also audited the wrong schema file (`prisma/schema.prisma` at the repo
  root, 80 lines) rather than `backend/prisma/schema.prisma` (433 lines). Its
  findings were re-verified against current source before use here.
- Live deployment state (Render, production DB, whether the pool has ever been
  funded) could not be verified from the repository and is **not** asserted
  anywhere in this document.