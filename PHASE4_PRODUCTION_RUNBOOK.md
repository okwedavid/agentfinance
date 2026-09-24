# PHASE 4 — PRODUCTION RUNBOOK · Compute-to-Revenue Engine

**Deterministic migration + seed smoke procedure.** Run this against the live
**production** deployment, in order. Every step is **non-mutating or additive-only**:
no `migrate reset`, no `db push`/`--accept-data-loss`, no table drops, no data
rewrites. This runbook never touches treasury private keys, never broadcasts a
real blockchain transaction, and never prints a secret.

The operator must record the outcome of every step into **§7 Observability**
and fill the **§8 Status record** at the end.

---

## Status model (exact)

```
PHASE 4 CODE COMPLETE
     ↓
LOCAL VERIFICATION COMPLETE
     ↓
MIGRATION VERIFIED
     ↓
PRODUCTION COMPUTE SMOKE COMPLETE
     ↓
REVENUE INTEGRITY VERIFIED
     ↓
SECURITY SMOKE COMPLETE
     ↓
PHASE 4 READY
```

- Any stage that fails ⇒ the model stops at the first failing stage and reads
  **PHASE 4 BLOCKED** (record *which* stage blocked and why).
- Do **not** label Phase 4 READY from local tests alone.

**Current position (already satisfied in this repository):**

| Stage | State |
|---|---|
| PHASE 4 CODE COMPLETE | ✅ already satisfied (code + migration merged) |
| LOCAL VERIFICATION COMPLETE | ✅ already satisfied (`# tests 125 · pass 124 · fail 0`, 1 pre-existing Groq-smoke skip; `prisma validate`/`generate` pass; `tsc --noEmit` clean; `next build` pass) |
| MIGRATION VERIFIED | ⬜ gates below in §2/§3 |
| PRODUCTION COMPUTE SMOKE COMPLETE | ⬜ gates below in §5 |
| REVENUE INTEGRITY VERIFIED | ⬜ gates below in §5/S §6 |
| SECURITY SMOKE COMPLETE | ⬜ gates below in §6 |

---

## Env / prerequisites

Placeholders (never commit values):

| Variable | Meaning |
|---|---|
| `$BASE` | production API origin, e.g. `https://app.example.com` |
| `$USER` / `$ADMIN` / `$SUPERADMIN` | opaque bearer tokens: customer, admin, super-admin |
| `$PSQL` | read-only psql invocation for smoke queries (never dumped to logs) |
| `SHADOW_URL` | *optional* throwaway scratch schema for `prisma migrate diff` (see §3) |

Phase 4 environment (presence checked, **values never echoed**):

| Env var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | must point at the intended production instance |
| `COMPUTE_PAYMENT_CERT_SECRET` | REAL verification | without it REAL verify returns 503 by design |
| `COMPUTE_ASSET_BNB_PRICE_USDT` / `..._USDC` | only if accepting those assets | production non-BNB quote 422s until set |
| `COMPUTE_ECONOMY_DEMO_MODE` | must be **off** in prod | if explicitly `true` in prod ⇒ BLOCKED |
| `COMPUTE_REWARD_FUNDING_SHARE` | optional | default 0.55 |

Presence check (prints only `set`/`unset`, never the value):

```bash
for V in DATABASE_URL COMPUTE_PAYMENT_CERT_SECRET COMPUTE_ASSET_BNB_PRICE_USDT \
         COMPUTE_ASSET_BNB_PRICE_USDC COMPUTE_ECONOMY_DEMO_MODE; do
  [ -n "${!V:-}" ] && echo "$V=set" || echo "$V=unset"
done
```

---

## 1. PRE-DEPLOY

1. **Git state.** `git rev-parse HEAD` → record SHA. `git status --porcelain`
   must be empty before deploy (record if not).
2. **Target DB.** Operator confirms `DATABASE_URL` resolves to the production
   instance. Never print the connection string.
3. **Required vars.** Run the presence check above. Missing
   `COMPUTE_PAYMENT_CERT_SECRET` while intending REAL verification ⇒ note in
   Observability (REAL will be 503 until set). `COMPUTE_ECONOMY_DEMO_MODE=set`
   and truthy in production ⇒ **BLOCKED**.
4. **Deploy** the backend (Render start chain runs baseline + migrate deploy,
   then boots). Record deployment start/end time.

---

## 2. MIGRATION

Run in the backend directory:

```bash
node prisma/baseline.js && npx prisma migrate deploy --schema=./prisma/schema.prisma
```

Deterministic pass/fail:

- ✅ `baseline … skip: migration history table already exists` **or**
  `baseline … recording …` entries, followed by `Prisma Migrate` **no pending
  migrations** / applied-only-pending, exit 0.
- ✅ Exactly one **new** applied migration: `20260930000000_phase4_compute_economy`.
- ✅ Any legacy migration already present is *not* re-run (`baseline` probes and
  `migrate resolve --applied` record it instead). If the migration also **writes
  no data rows** except `_prisma_migrations` bookkeeping.
- ❌ **BLOCKED** immediately on any: `P3005`, errors containing
  `migrate reset`/`--accept-data-loss`/`DROP`, a failed `resolve`, or a nonzero
  exit that stops the app start chain. Record full tail (strip any secrets).
- 🔁 **Idempotency:** re-run the same command → exit 0, `No pending migrations`,
  nothing re-applied. Record that.

Then confirm up-to-date:

```bash
npx prisma migrate status --schema=./prisma/schema.prisma
# expected: "Database schema is up to date!"
```

The expected applied migration list (from `_prisma_migrations`, read-only):

- `20260915000000_phase0_baseline`
- `20260920000000_phase1_1_email_verification`
- `20260925000000_phase2_security`
- `20260927000000_phase3_reward_economy`
- `20260930000000_phase4_compute_economy`

**Gate:** command exit 0, status up-to-date, phase-4 migration recorded ⇒
**MIGRATION VERIFIED**.

---

## 3. DATABASE SMOKE (read-only)

No DDL, no writes. Use `$PSQL` (read-only role) for queries; never print
secret-bearing columns.

### 3a. Phase 4 tables exist

```sql
SELECT name,
       to_regclass('public."'||name||'"') IS NOT NULL AS exists
FROM unnest(ARRAY[
  'ServiceCatalog','ComputeQuote','PaymentIntent','ComputeCustomer',
  'ComputeJob','ComputeOutput','ComputeCost','RevenueEvent','RevenueAllocation'
]) AS name
ORDER BY name;
```

All rows ⇒ `exists = t`.

### 3b. Uniqueness and query indexes exist (idempotency / integrity guards)

```sql
SELECT indexname
FROM pg_indexes
WHERE schemaname='public' AND indexname IN (
  'ServiceCatalog_slug_key',
  'ComputeQuote_nonce_key',
  'ComputeQuote_userId_idx','ComputeQuote_serviceId_idx',
  'PaymentIntent_quoteId_key',
  'ComputeJob_sellerUserId_idx','ComputeJob_serviceId_idx','ComputeJob_status_idx',
  'ComputeOutput_jobId_key',
  'ComputeCost_jobId_idx',
  'RevenueEvent_paymentIntentId_key',   -- anti-double-credit guard
  'RevenueEvent_jobId_idx',
  'RevenueAllocation_revenueEventId_idx','RevenueAllocation_allocationType_idx',
  'RewardEvent_computeJobId_key',        -- phase-4 reward idempotency
  'RewardEvent_taskId_key'               -- phase-3 reward idempotency
)
ORDER BY indexname;
```

Every listed index must be present. **`RevenueEvent_paymentIntentId_key` absent
⇒ BLOCKED**: concurrent duplicate verification could double-fund the reward
pool.

### 3c. Key columns present

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema='public' AND (
  (table_name='RewardEvent'    AND column_name IN ('taskId','computeJobId')) OR
  (table_name='RevenueEvent'   AND column_name IN ('paymentIntentId','bnbEquivalentWei')) OR
  (table_name='ComputeJob'     AND column_name IN ('revenueEventId','expectedPriceBnbWei'))
)
ORDER BY table_name, column_name;
```

### 3d. Schema/Prisma parity

`prisma migrate status` in §2 already proves migration history is complete and
consistent. As a stronger drift check (optional, requires a **throwaway**,
non-production shadow schema, never the production DB directly):

```bash
npx prisma migrate diff \
  --from-migrations --shadow-database-url "$SHADOW_URL" \
  --to-schema-datamodel --schema=./prisma/schema.prisma
# expected: "No difference detected"
```

### 3e. Idempotency

Re-run the §2 command → must stay `No pending migrations` and write nothing.

**Gate:** 3a–3c all present, 3d clean (or skipped with a recorded note), 3e
no-op ⇒ **MIGRATION VERIFIED** (confirmed together with §2).

---

## 4. SEED / SMOKE

> Production seed is intentionally not run; use non-mutating smoke verification instead.

Phase 4 has **no standalone CLI seed command** — there is nothing to invent or
run. The compute service catalog is populated at backend boot by
`ensureComputeServiceCatalog()` (additive, deterministic, skips when any
service already exists), so a manual production seed is unnecessary. The
catalog is instead verified **non-mutatingly** through the API smoke read in
§5 step 2 (`GET /api/compute/services`).

---

## 5. PRODUCTION API SMOKE

Run against `$BASE` with bearer auth. Never echo tokens or the attestation
(token values are command-local only). `curl -sS`; capture bodies to temp files
and record the fields listed in §7. `jq` is assumed.

Secrets hygiene: keep `COMPUTE_PAYMENT_CERT_SECRET` only inside the operator
shell / deploy environment. The one attestation command below reads it from the
environment and prints **only the hex digest**.

```bash
# quote a service (customer) — server-priced, client cannot set an amount
curl -sS -H "Authorization: Bearer $USER" \
  -H 'Content-Type: application/json' \
  -d '{"serviceSlug":"research","asset":"BNB","requestText":"{replace: deterministic smoke payload}"}' \
  "$BASE/api/compute/quote" \
  -o /tmp/cq.json -w 'quote_http=%{http_code}\n'
# record: quote.id, paymentIntent.id, amountWei, priceBnbWei, platformFeeBnbWei,
#         serviceCostBnbWei, status (must be PENDING), demonMode (must be false)
```

| Step | Call | Must assert / record |
|---|---|---|
| 1 unauthenticated | `GET $BASE/api/compute/services` (no token) | 401/403 |
| 2 catalog | `GET $BASE/api/compute/services` (`$USER`) | 200; `services` non-empty; `research` present+enabled; `demoMode=false`; record count |
| 3 quote | `POST $BASE/api/compute/quote` (above) | 201; `paymentIntent.status=PENDING`; amount/price are server-derived; record fields above |
| 4 create job | `POST $BASE/api/compute/jobs` `{"quoteId":<qid>}` (`$USER`) | 201; `job.status=DRAFT`; record `job.id` |
| 5 submit (operator) | `POST $BASE/api/admin/compute/payments/<pid>/submit` (`$ADMIN`) | 200; record intent status after submit |
| 6 REAL verify | compute attestation, then `POST .../payments/<pid>/verify` `{"attestation":<hex>}` (`$SUPERADMIN`) | 200; `simulated=false`; `settled.status=VERIFIED`; record `revenueEvent.id`, `rewardFundingBnb`, `platformBnb`; job `status` → `PENDING` |
| 7 idempotent re-verify | repeat step 6 (sequential, then **concurrent**) | each 200; `idempotent=true` returns give **the same `revenueEvent.id`**; post-query: exactly **1** row for that `paymentIntentId` in `RevenueEvent` (guaranteed by `RevenueEvent_paymentIntentId_key`) |
| 8 run monetized job | `POST $BASE/api/compute/jobs/<jid>/run` (`$USER`) | job → `COMPLETED`; output has `resultHash` (sha256) + `sizeBytes`; `ComputeCost.amountWei` present; a `COMPUTE_JOB_REVENUE` rewardEvent keyed by `computeJobId` with `rewardAmountBnb` == that job's funding allocation; record hashes/cost/rewardId |
| 9 unmonetized guard | new quote+job, **no** verify, then run | `run` → 409; no output/cost/reward created |
| 10 refunded guard | new quote+job, admin refund, then verify | verify rejected before any money moves (4xx); **0** new RevenueEvent; run → 410/409 |
| 11 admin overview | `GET $BASE/api/admin/compute/overview` (`$ADMIN`) | record `summary` blocks; assert `simulatedRevenueBnb=0`, `realRevenueBnb>0`, `revenueNeverEqualToComputeCost=true`; RevenueEvent count == payments verified (no duplicates) |
| 12 reward balance | `GET $BASE/api/rewards/balance` (`$USER`) | record `totalEarnedBnb` (>0 for the runner) and `availableToWithdrawBnb`; assert settleable is bounded by confirmed funding (`settleable ≤ floor(total×funded/generated)`) |

**Gates:**
- Steps 1–12 pass with recorded values ⇒ **PRODUCTION COMPUTE SMOKE COMPLETE**.
- Step 7 (exactly one RevenueEvent per paymentIntentId under concurrency) and
  step 12 (bounded balance) ⇒ **REVENUE INTEGRITY VERIFIED**.

---

## 6. SECURITY SMOKE

| # | Check | Expected |
|---|---|---|
| 1 | unauthenticated calls to `services`, `quote`, `jobs`, `admin/compute/*` | all 401/403 |
| 2 | customer token on admin verify/overview | 403 |
| 3 | ADMIN (non-super) token on REAL verify | 403 (policy verdict) with **no** RevenueEvent/funding written |
| 4 | wrong / absent attestation on REAL verify | 403, intent still PENDING, DB unchanged (0 RevenueEvent, 0 funding) |
| 5 | replay: re-submitted valid attestation | idempotent (step 7 §5) — never double-credit |
| 6 | client amount manipulation: `POST /api/compute/quote` body containing `amountWei` | ignored; server price stands (assert response amount == server catalog price) |
| 7 | leak check on every captured response | responses contain **no** `COMPUTE_PAYMENT_CERT_SECRET`, no private keys, no attestation values; `grep` captured bodies for the attestation hex / secret → 0 hits |
| 8 | log leak check | recent logs contain **no** `COMPUTE_PAYMENT_CERT_SECRET=` and no attestation values |
| 9 | rate limits | `computeQuoteLimiter` 10/min, `computeJobLimiter` 6/min, `computePaymentLimiter` 10/min return 429 beyond window (sampled once) |

**Gate:** all pass ⇒ **SECURITY SMOKE COMPLETE**.

---

## 7. OBSERVABILITY

Record every row (no secrets — by design these fields are never secret-bearing;
attestation values and keys must **not** be recorded):

| Field | Value |
|---|---|
| commit SHA / deploy time | |
| baseline + migrate deploy exit + tail summary | |
| `prisma migrate status` result | |
| tables / indexes / columns present (3a–3c) | |
| catalog service count (smoke step 2) | |
| quote: id, priceBnbWei, amountWei, fee, cost | |
| payment intent: id, asset, amountWei, status flow | |
| revenue event id | |
| reward funding (BNB) / platform (BNB) / simulated flag | |
| job id, outputHash, sizeBytes, costWei | |
| compute rewardEvent id, rewardAmount | |
| idempotency: same revenueEvent.id on re-verify; count==1 per intent | |
| user balance: totalEarned, availableToWithdraw | |
| overview summary (real/simulated/cost/rewards, revenue≠cost) | |

End with a live health check:

```bash
curl -sS -o /dev/null -w 'api_health=%{http_code}\n' $BASE/
```

**Never** record: `DATABASE_URL`, `JWT_*`, treasury/manage keys,
`COMPUTE_PAYMENT_CERT_SECRET`, attestation digests, or raw chain data beyond
hashes.

---

## 8. Status record

Paste into `PHASE4_IMPLEMENTATION_REPORT.md` when the run is complete:

```markdown
## Verification status

PHASE 4 CODE COMPLETE → LOCAL VERIFICATION COMPLETE → MIGRATION VERIFIED →
PRODUCTION COMPUTE SMOKE COMPLETE → REVENUE INTEGRITY VERIFIED →
SECURITY SMOKE COMPLETE → **PHASE 4 READY**   (or → **PHASE 4 BLOCKED** at <stage>)

Runbook: last stage passed <stage> on <date> by <operator>; artifacts in
deploy §7 Observability table.
```