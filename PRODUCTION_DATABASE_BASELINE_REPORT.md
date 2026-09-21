# Production Database Baseline Report

**Project:** AgentFinance — production database baseline recovery (Prisma P3005)
**Date:** 2026-09-21
**Final gate:** **DATABASE BASELINE BLOCKED — pending live Render deploy confirmation**

The baseline procedure is complete, committed, pushed, and validated end-to-end
against a safe scratch PostgreSQL. The remaining (only) step is triggering the
Render deploy and watching it verify, which requires Render dashboard/API access
(no credentials are available in this environment).

---

## 1. Why P3005 occurred

The Render start command was `npx prisma migrate deploy ... && node src/index.js`
(and the same chain in `npm start` before the fix). `prisma migrate deploy` refuses
to touch a database that is **non-empty but has no `_prisma_migrations` table**:

> Error: P3005 — The database schema is not empty.

That is exactly the production database's state:

- It was created by `prisma db push` (never `migrate deploy`), so the Prisma
  migration history table `_prisma_migrations` was never created.
- Prisma therefore cannot tell which committed migrations have already been
  applied to the live schema, and refuses to guess.

Prisma's *supported* fix is baselining: tell Prisma "these existing tables
already represent this migration state" via `prisma migrate resolve --applied`,
which creates `_prisma_migrations` and records the matching migrations as applied
— **without running any DDL and without touching table data**.

Three additional defects on top of P3005 were found and fixed in this session:

1. **`schema.prisma` had the three email-verification fields
   (`emailVerified`, `emailVerificationToken`, `emailVerificationExpiresAt`)
   defined TWICE on `User`** (merge artifact of Phase 1.1). This made
   `prisma validate` **and** `prisma generate` fail with P1012, so the Render
   **build** would have failed *before* `migrate deploy` ever ran.
2. **`backend/nixpacks.toml [start]` did NOT call `prisma/baseline.js`** — only
   `npm start` did. NixPacks' explicit `[start]` overrides `npm start`, so the
   live deploy would have hit P3005 anyway.
3. **Two `phase1_1_email_verification` migrations existed** —
   `20260919000000_...` (added in `ff7fa8a`) and `20260920000000_...` (added in
   `b4b6164`). The earlier one was superseded, unknown to `prisma/baseline.js`,
   and produced a *partial* unique index for `User.emailVerificationToken`
   (drift from the `@unique` datamodel). It was never applied anywhere it
   matters and was removed.

## 2. Current migration inventory

As committed on `main` (`4c0066e`), the migration directory is now complete and
consistent — 3 migrations:

| Migration | Name | Content |
|---|---|---|
| `20260915000000_phase0_baseline` | Phase 0 baseline | Full db-push-shaped schema (idempotent: `CREATE ... IF NOT EXISTS` + `DO`-guarded FK adds) |
| `20260920000000_phase1_1_email_verification` | Phase 1.1 | `User.emailVerified` / `emailVerificationToken` / `emailVerificationExpiresAt` + full unique index (guarded, additive) |
| `20260925000000_phase2_security` | Phase 2 | `Task.retryCount` + `Task_userId_idx` (guarded, additive) |

Removed: `20260919000000_phase1_1_email_verification` (superseded by the
`20260920` migration; never applied; baseline.js only ever referenced the
`20260920` one).

## 3. Current database migration state (production)

Inferred, not directly introspected (no access to the production DB from this
environment):

- **A. Migrations in Git:** 3 (after fix; previously 4 with a duplicate name).
- **B. Migrations already applied to production:** none — production has no
  `_prisma_migrations` table (P3005 that is the basis for this, plus
  PHASE2_SECURITY_HARDENING_REPORT.md §7: "Prod database is on the baseline;
  Phase 1.1 + Phase 2 migrations both pending").
- **C. `_prisma_migrations` exists?** No (this is the exact cause of P3005).
- **D. Schema matches the baseline (phase0) migration?** Per the Phase 2 report,
  yes — production is on the phase0 shape. Reproduced faithfully in the sandbox
  (Test B) and the recovery flow resolved phase0 correctly.
- **E. Phase 1.1 changes already present?** Per report, no (pending). The
  baseline script probes the actual schema and handles either state.
- **F. Phase 2 changes already present?** Per report, no (pending). Same probe.
- **G. Migration directory incomplete?** It was *over*-complete (one redundant,
  duplicate-named migration now removed). A `prisma migrate diff --from-migrations
  --to-schema-datamodel` run reports **"No difference detected"** — the three
  committed migrations now reproduce `schema.prisma` exactly.

## 4. Baseline strategy used

`backend/prisma/baseline.js` (committed previously, kept) runs first in both the
`npm start` chain and (now) the NixPacks/Render start command. It is
**non-destructive**:

- Never runs DDL; never drops tables/data; never calls `db push` / `db reset`.
- If `_prisma_migrations` exists → skip (exit 0).
- If no application tables → fresh database → skip (exit 0).
- Otherwise (production shape) → probe schema signals and record **already
  applied** migrations with `prisma migrate resolve --applied`:
  - phase0 always (it reproduces the db-push schema),
  - phase1_1 only if `User.emailVerified`/`User.emailVerificationToken` exist,
  - phase2 only if `Task.retryCount` exists.
- After baselining, `prisma migrate deploy` applies **only** the migrations the
  schema still lacks. Any failure aborts boot loudly rather than serving
  against an unmanaged database.

**Changes made this session (commit `4c0066e`, pushed to `main`):**

1. `backend/prisma/schema.prisma` — removed the duplicated email-verification
   fields from `User` (merely the *metadata* needed for the schema to be valid).
2. `backend/nixpacks.toml [start]` — now runs
   `node prisma/baseline.js && npx prisma migrate deploy ... && node src/index.js`
   so the Render start path baselines before deploying.
3. Removed the superseded `20260919000000_phase1_1_email_verification` migration.

## 5. Migrations now recognized

After baseline + deploy, `_prisma_migrations` contains exactly:

1. `20260915000000_phase0_baseline`
2. `20260920000000_phase1_1_email_verification`
3. `20260925000000_phase2_security`

`prisma migrate status` → **"Database schema is up to date!"**

## 6. Validation against a SAFE database (proof)

A scratch PostgreSQL 16 was started on the local machine (isolated, never
production) and three scenarios were exercised:

**Local checks:** `prisma validate` ✅ · `prisma generate` ✅ ·
`prisma migrate diff --from-migrations --to-schema-datamodel` → **No difference
detected** ✅ (the committed migrations now reproduce the datamodel exactly).

**Test A — fresh database:** `baseline.js` skips (no tables); `migrate deploy`
applies all 3 migrations successfully. Result: all 14 app tables, `Task.retryCount`,
`Task_userId_idx`, and a *full* `User_emailVerificationToken_key` unique index.

**Test B — production-shape database (tables, NO `_prisma_migrations`, no
Phase-1.1/Phase-2 columns, seeded rows):**
- `baseline.js` → logged "application tables present without migration history",
  recorded `20260915000000_phase0_baseline` as applied. ✅
- `migrate deploy` → applied `20260920000000_phase1_1_email_verification` +
  `20260925000000_phase2_security`. ✅ No P3005. ✅
- **Data preserved: 2 users, 1 agent, 1 task, 1 payout — identical before and
  after.** ✅
- Resulting schema: `emailVerified/emailVerificationToken/
  emailVerificationExpiresAt` present on `User`; `retryCount` on `Task`;
  `Task_userId_idx` + `User_emailVerificationToken_key` present;
  `_prisma_migrations` = 3 rows; `migrate status` up to date; `migrate deploy`
  re-run → "No pending migrations to apply". ✅

**Test C — fully db-pushed production shape (all columns, no history):**
`baseline.js` resolved all 3 migrations; `migrate deploy` → no-op. ✅

## 7. Render deployment result

- Push `4c0066e` → `origin/main` is up to date with the fixes.
- A Render auto-deploy did **not** begin within ~12 minutes of the push, and no
  Render CLI/API credentials exist in this environment to trigger the deploy.
- **Action required (one of):**
  - Render dashboard → `agentfinance-backend-zgjj` → **Manual Deploy → Clear
    build cache & deploy**, or
  - provide a `RENDER_API_KEY` so the deploy can be triggered via the Render API.

## 8. Verification matrix (status)

| Check | Expected (after fixed deploy) | Observed now |
|---|---|---|
| Build (`npm ci`→`prisma generate`) | passes | ✅ verified locally (previously failed: duplicate fields) |
| `prisma/baseline.js` on prod DB | records phase0 (+phase1_1/phase2 if present) | ✅ verified on scratch prod-shape DB |
| `migrate deploy` | applies only pending migrations, no P3005 | ✅ verified on scratch prod-shape DB |
| Backend boots | `node src/index.js` | ⏳ pending Render deploy |
| `/health` | `{status:"ok", db:"ok"}` | ✅ **live old build returns 200 + db "ok"** (not yet the fixed build) |
| `/system/diagnostics` | 200/401 (route exists, auth-guarded) | ⏳ **live old build returns 404** (route absent → confirms old build still live) |
| `Task.retryCount`, `Task_userId_idx` | present | ✅ verified on scratch DB (pending live) |
| Data preserved in prod | intact | ✅ verified behaviorally via Test B (pending live DB check) |

Note: the app has **no `Wallet` table** — wallets are `User.walletAddress` /
`walletProfiles` columns, so "Wallet" does not appear in the table inventory.
All 13 application tables in `schema.prisma` (`User, AuthSession, Task, Message,
Agent, CoordinatorTask, SubTask, AuditLog, TokenUsage, Payout, DigitalProduct,
FactoryRun, TaskAnalytics`) were verified present after deployment in the sandbox.

## 9. Gate

**DATABASE BASELINE BLOCKED** — awaiting live Render deploy confirmation.

Code, migrations, and baseline procedure are complete, committed, pushed
(`4c0066e`), and validated against a safe scratch PostgreSQL using the exact
production-shape simulation. Do not begin Phase 1.1/Phase 2 E2E until the fixed
build boots on Render and `/system/diagnostics` stops returning 404 (confirms
the new build is live and the migration chain ran cleanly).

Once deployed, run:
1. `curl https://agentfinance-backend-zgjj.onrender.com/health` → `db:"ok"`
2. `curl -i https://agentfinance-backend-zgjj.onrender.com/system/diagnostics`
   → 401/200 (not 404)
3. Optionally `SELECT count(*) FROM "_prisma_migrations"` against the production
   DB → 3 rows (phase0, phase1_1, phase2).