# Phase 2 — Security Hardening Report

**Project:** AgentFinance — controlled public release readiness
**Date:** 2026-09-20
**Result gate:** **BLOCKED** — code hardening complete and verified locally; final
READY gate requires deploying to Render and passing the production E2E (production
is still running the Phase 1.1-predecessor build, see Blockers).

---

## 1. Summary

Phase 2 hardened AgentFinance for controlled public release. The work removes
every unauthenticated/authorization-gapped endpoint, locks the WebSocket layer to
authenticated owners, stops credential and API-key leakage, adds rate limiting,
plus per-user task flood caps, real fleet status, graceful shutdown, security
headers/CSP, dependency remediation and dead-code removal.

**Local verification (all on `main` work-in-progress):**
- Backend tests: **66/66 pass**
  (`node --test "test/*.test.mjs"` — previously `node --test test/` failed on
  Windows/Node 22; the npm script was fixed)
- `node --check` on every `src/**/*.js`: **pass**
- `npx prisma validate`: **pass**
- Frontend: `tsc --noEmit` **clean**, `next build` **exit 0**
- `npm audit`: 31 → **20** remaining vulnerabilities (all 20 require breaking
  `--force` upgrades to `alchemy-sdk@2` / `uuid@14`, tracked in §8)

**Not possible locally:** full server boot + HTTP/WS E2E requires PostgreSQL
(no local Postgres/Docker; the backend runs `prisma migrate deploy` at boot).
DB-gated E2E runs on the Render deploy gate.

---

## 2. What was fixed (confirmed against live code)

### 2.1 Authentication & authorization
| Endpoint | Before | After |
|---|---|---|
| `POST /api/dispatch` | **no auth, no ownership** — anyone could push work into agent queues | `authMiddleware` + ownership check (`task.userId === req.user.sub`); non-owner → 404; unauthenticated → 401 |
| `POST /api/coord/dispatch`, `POST /api/coord/agents/register`, `GET /api/coord/summary` | **no auth**; summary leaked **all users'** tasks | `authMiddleware` + `requireRole`; writes require admin; summary scoped to caller (admins may see all) |
| coordinator router | created its own `PrismaClient`/`IORedis` per request | uses shared `prismaClient.js`/`redisClient.js` |
| `GET /api/coord/agents`, `GET /api/coord/summary` | open | authenticated |
| `routes/factory.js` (`/api/factory`, `/factory`) | `router.use(requireRole(...))` **without `authMiddleware`** → every request 401'd (broken factory) | `authMiddleware, requireRole([...])` in order; admin view-scoping kept |
| `POST /api/sessions/join` | accepted client-supplied `user` | identity derived **only** from session JWT |
| `POST /api/tasks/:id/retry` | no guard on retry volume | concurrent-cap check + `retryCount` cap (`MAX_TASK_RETRIES`, default 3), same-row re-queue |
| `POST /auth/verify`, logout, me, wallet, payouts | existing auth preserved | unchanged + rate limited where needed |
| **Roles** | — | always re-read from DB per request (`requireRole`), never trusted from JWT/body |

### 2.2 WebSocket security
- **Before:** fully unauthenticated; every Redis event broadcast to every client;
  token passed in the URL query string.
- **After:**
  - Token is delivered in the **first frame** (`{type:'auth', token:...}`), never
    in the query string → cannot leak via access logs/proxies/history.
  - Auth via the same `resolveUserFromToken()` used by HTTP (JWT + **live
    session check**).
  - `agentfi:tasks` events are delivered **only to the owning user**
    (`data.userId` — `agentService.js` now publishes `userId` on
    running/completed/failed).
  - Fleet/factory events (`agentfi:agents`) broadcast to authenticated sockets only.
  - Per-user cap: `MAX_WS_PER_USER = 3` (close `4002`).
  - 10s auth timeout (close `4001`); heartbeats ping every 30s, dead sockets
    terminated; `maxPayload: 8*1024`.
  - Frontend `useWebSocket.ts` sends auth frame, stops hot-looping on `4001/4002`,
    keeps reconnect elsewhere.

### 2.3 HTTP transport & error hygiene
- **CORS:** production restrict to `https://agentfinance.onrender.com` +
  configured `ALLOWED_ORIGINS`/`FRONTEND_URLS`; `localhost:3000/4000` only outside
  production (stale local/Railway origins never trusted against the live API).
- **Error handler** (`errorHandler.js`): production 5xx are always generic;
  4xx/5xx expose a message **only when the throwing code sets `err.expose`**
  (status code alone never grants it). No stack/driver/provider strings leak.
  Full detail stays in server logs.
- **Per-route sanitization:** factory `500`s no longer return `e.message`;
  coordinator/dispatch use `safeFail`; `wallet.js` no longer leaks
  provider/RPC error text (`_safe` flag only); `/system/diagnostics` no longer
  returns raw DB driver errors (now `'error'`).
- **Security headers** (`securityHeaders.js`): `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`,
  HSTS in production.
- **Frontend CSP** (`next.config.mjs headers()`): `default-src 'self'`
  with `connect-src` limited to the baked-in API/WS origins, `object-src 'none'`,
  `base-uri/form-action/frame-ancestors 'self'`, plus the header set above.
  (`script-src 'unsafe-inline'` retained; Next.js bootstrapping + third-party
  widgets require it — documented trade-off.)
- `trust proxy = 1` (Render TLS terminates in front) so IP-keyed limiters are
  correct; `x-powered-by` disabled; `express.json({ limit: '256kb' })`.

### 2.4 Abuse & cost controls
- Rate limits (in-memory, per instance): global 600/min (skips `/health`);
  **login** 20/15 min keyed username+IP (message identical to a normal failure —
  cannot be used for account enumeration); **register** 8/hr/IP; **verify**
  30/15 min; **tasks** (create+retry) 12/min/user; **payouts prepare**
  6/min/user; **factory+coordinator** 20/min/user; **dispatch** 10/min/user.
- Task flood caps: `MAX_ACTIVE_TASKS=25`, `MAX_CONCURRENT_TASKS=3`,
  `MAX_TASK_ACTION_LENGTH=2000`, `MAX_TASK_RETRIES=3`.
  Agent targets are **allowlisted** (`AGENTS` env); arbitrary agentId is dropped.
  No fake/completed results are ever synthesized (`Math.random` remaining uses
  are niche pick + a market-sim tool, not task completion).
- Earnings remain server-authoritative (ledger `earningsService.js`; failed→0;
  retry re-uses the same row — no double counting). Task `userId` now indexed
  (`Task_userId_idx`) for per-user queries.

### 2.5 Secrets & data exposure
- `wallet.js`/`middleware/auth.js`: removed `JWT_SECRET || 'please_change_me'`
  fallbacks (missing secret now rejects auth outright in prod) and the cookie
  path. Sessions are the single auth mechanism.
- `payoutService.js`: `rpcUrlHint` (a 64-char slice of the RPC URL, could embed
  an Alchemy key) replaced with `rpcConfigured` + `rpcHost` only.
- `oauthService.js`: `resolveOauthSuccessUrl` now rejects any non-http(s) URL.
- Repo scan: no high-entropy secrets / private keys / `sk-` / `AIza` literals in
  source (isolated test fixture `RAW_SECRET` is intentional). Secrets are
  `.gitignore`d (`backend/.env`, `frontend/.env.local`, `digital-factory/.env`);
  separate commit-check was NOT yet run — **verify no secret was ever committed
  to git history during E2E gate.**

### 2.6 Truthfulness of operations UI
- `/system/runtime` fleet: status now comes from **real agent heartbeats** in
  `agentfi:agents` (registered via `/api/coord/agents/register`, admin-only);
  unregistered-but-configured agents show `configured`, never fake
  `online/standby` by array index.

### 2.7 Operational hardening
- **Graceful shutdown**: `SIGTERM`/`SIGINT` → stop accepting connections, close
  WS clients, close subscriber → Redis → BullMQ → Prisma, 15s force-exit guard.
- Removed the unauthenticated **`/api/tasks/replay`** route (re-published to
  Redis, had a "demo events" fallback) and deleted `routes/replay.js`.

### 2.8 Cleanup (dead / insecure artifacts removed)
Deleted: `routes/agentTasks.{js,ts}`, `routes/analytics.ts`, `routes/auth.ts`,
`middleware/auth.ts`, `utils/jwt.ts` (all dead prototypes; `utils/jwt.ts` had a
`'please_change_me_locally'` fallback), `routes/replay.js`, `prisma/seed.{js,ts}`,
`tmp-run-seed.js`, root `cookies.txt`, `frontend/tmp_tasks.json`. Dropped the
`seed` npm script and pruned unused deps (`body-parser`, `cookie-parser`,
`express-validator`). Fixed the `npm test` script for Windows/Node 22.

---

## 3. Database migration (new, additive)

`backend/prisma/migrations/20260925000000_phase2_security/migration.sql`:

```sql
ALTER TABLE "Task" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Task_userId_idx" ON "Task"("userId");
```

Additive only — safe on existing rows. `npm start` runs `prisma migrate deploy`
on Render during the deploy. Schema updated in `schema.prisma` to match.

---

## 4. Deployment sequence (Render)

1. Backend: **Manual Deploy → Clear build cache & deploy** on
   `agentfinance-backend-zgjj`. This applies Phase 1.1 (email verification,
   `b4b6164`) **and** Phase 2 together — all migrations run in order
   (`phase0 → phase1_1 → phase2_security`).
2. Frontend: rebuild `agentfinance` with `NEXT_PUBLIC_API_URL` pointing at the
   backend (already required by `next.config.mjs`).
3. Verify: backend `/health` ok + `/system/diagnostics` returns 200 (the Phase
   1.1 diagnostic that is 404 today), then run the E2E checks below.

**Env to set on backend (optional; sane defaults exist):**
`MAX_TASK_ACTION_LENGTH`, `MAX_ACTIVE_TASKS`, `MAX_CONCURRENT_TASKS`,
`MAX_TASK_RETRIES`, `AGENTS`. Documented in `backend/.env.example`.

---

## 5. Production E2E checklist (BLOCKED)

Run after deploy; scripted where possible (see also `/health`, `/system/diagnostics`):

- [ ] `/health` → `db: "ok"`; `/system/diagnostics` no longer 404.
- [ ] Register with email → verify token flow still works; login round-trip.
- [ ] Unauthenticated → `POST /api/dispatch`, `/api/coord/*`, `/factory/*`,
      `/api/tasks/replay`, `/payouts/prepare` all return 401/403/404 (no data).
- [ ] User A cannot read/touch User B's tasks (`GET/PATCH/DELETE /tasks/:id`,
      `/tasks/:id/retry`, `/api/dispatch` on B's task → 404).
- [ ] Non-admin cannot `POST /api/coord/*` (403); admin can.
- [ ] WS: connect → must receive `auth:ok`; without auth frame → close `4001`;
      User A session receives only A's task events; `?token=` is rejected.
- [ ] Task flood: 26th concurrent active task → 429; >3 running → 429.
- [ ] `/system/runtime` fleet shows `configured` (or real heartbeats), not
      fabricated `online`.
- [ ] Payout prepare plan shows `rpcHost` only (no URL/key material).
- [ ] `Security-Headers`/CSP present on frontend; no `X-Powered-By` from backend.
- [ ] Render restart (Deploy → Restart) → graceful shutdown log lines, clean boot.
- [ ] Re-run `git log` / `git grep` for any committed secret (defense-in-depth).

---

## 6. Dependency security

`npm audit fix` applied non-breaking updates: **express 4.18.2 → 4.22.3**,
**ws 8.18.3 → 8.21.0**, plus transitive fixes (axios, path-to-regexp, qs,
body-parser, jws, lodash, minimatch, brace-expansion, form-data).

**Remaining 20 (all require breaking `--force` upgrades) — tracked, not applied:**

| Package (chain) | Advisory | Exposure | Fix (breaking) |
|---|---|---|---|
| `elliptic` via `alchemy-sdk@3` (ethers v5 internals) | GHSA-848j-… | crypto primitive risk; not exercised by our read paths | `alchemy-sdk@2` (API rewrite — verify our `alchemy-sdk` usage first) |
| `stream-json`/`jayson`/`@solana/web3.js` via `alchemy-sdk` | GHSA-528h-… (DoS depth) | only reachable via Solana/Alchemy paths we don't call | with above |
| `uuid@9` (top-level) | GHSA-w5hq-… (v3/v5/v6 buffer bounds) | we use `uuidv4()` with no buffer → not affected | `uuid@14` (verify `v4` import surface) |
| `ws 8.18` nested in `@ethersproject/providers` | GHSA-58qx/GHSA-96hv | our top-level ws is patched; nested one unused in our code | with alchemy-sdk |

**Verification:** `npm ls` confirms top-level `express@4.22.3`, `ws@8.21.0`,
`uuid@9.0.1`, bullmq/ethers deduped onto fixed versions. Full suite still green
after the upgrade.

---

## 7. Risks & residual items

- **In-memory rate limiting** is per-instance (single Render web service → OK for
  the current topology; revisit if scaled horizontally).
- **CSP `script-src 'unsafe-inline'`** retained for Next.js widget compatibility —
  review tightening to `nonce-` based CSP later.
- **`AGENTS` allowlist empty fallback:** if `AGENTS` is unset, the allowlist check
  is bypassed (existing env). Set `AGENTS` in Render.
- Breaking dependency upgrades (`alchemy-sdk@2`, `uuid@14`) deferred — tracked
  above with validation steps.
- Prod database is on the baseline; Phase 1.1 + Phase 2 migrations both pending.
  The `Task` table gets a new column + index on first Phase 2 deploy.
- No committed-secret audit of git **history** was run locally — includes as an
  E2E gate item.

---

## 8. Gate

**STATUS: 🟠 BLOCKED — CODE READY, NOT DEPLOYED.**

All hardening is implemented and locally verified. The final READY verdict
requires: (1) Render deploy of the backend (which also lands Phase 1.1) and the
frontend, (2) successful production E2E (§5). Until the deploy is triggered,
no production verification can run.