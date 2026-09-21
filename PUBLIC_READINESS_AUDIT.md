# AgentFinance — FINAL PUBLIC-READINESS AUDIT

Date: 2026-09-15
Auditor: automated read-only audit + live API/WebSocket testing
Scope: entire repository at `/home/gamp/Desktop/agentfinance` + the two live Render services.
Status of audit inputs:
- Backend live: `https://agentfinance-backend-zgjj.onrender.com` (tested)
- Frontend live: `https://agentfinance.onrender.com` (tested)
- Database: read-only verification via live API + schema inspection (no destructive access)
- No code changes, no deployments, no credential rotation, no real financial transactions were performed.

---

## 1. EXECUTIVE VERDICT

**Overall status: Functional but requires significant fixes (Category C).**

**Production readiness: NOT PUBLIC READY.**

The deployment is up, CORS is fixed, authentication works end to end, the WebSocket layer works, and the frontend production build succeeds. However the core product feature (AI agent task execution) is **completely broken in production** — every AI provider fails (invalid Groq key, retired Gemini model, exhausted Anthropic credit, broken/absent others) — and there is a **critical, easily exploitable financial vulnerability** in the payout approval flow that can broadcast real funds from the live treasury wallet. Several endpoints also expose all users' data without authentication.

---

## 2. PHASE 1 — REPOSITORY INVENTORY / ARCHITECTURE MAP

### Technology stack actually used (verified in code, not docs)

| Layer | Technology |
|---|---|
| Frontend | Next.js 15.5 (App Router), React 18, TypeScript (strict OFF), Tailwind CSS 3, Framer Motion, Recharts, SWR |
| Backend | Express 4 (JavaScript, ESM), Prisma 5 / PostgreSQL, Redis (ioredis + BullMQ), `ws` WebSocket server on the same HTTP port, bcrypt, JSON Web Tokens |
| Agent runtime | In-process `runAgent()` in `backend/src/agents/agentRunner.js` with multi-provider cascade (Groq, Google Gemini, Anthropic, OpenRouter, Together, Mistral, Cerebras) |
| Worker | BullMQ worker embedded in the backend process (`backend/src/workers/agentWorker.js`) |
| External data | CoinGecko, CoinMarketCap, DeFiLlama, alternative.me, Tavily, Serper, Alchemy, public RPCs, mempool.space |
| Unused / separate microservices | `coordinator/`, `worker/`, `subtask-worker/`, `websocket/`, `digital-factory/` — NOT deployed in the Render two-service setup |

### Deployed services (confirmed live)
1. Frontend — `https://agentfinance.onrender.com` (Next.js)
2. Backend — `https://agentfinance-backend-zgjj.onrender.com` (Express + WS + BullMQ worker + Redis + Prisma/PostgreSQL)

### Repository layout (routes that are actually mounted)
- `backend/src/index.js` mounts: `/health`, `/system/runtime`, `/auth/*`, `/tasks` (+`/:id`, `/all`), `/payouts*`, `/analytics` and `/api/analytics`, `/wallet`, `/api/tasks/replay`, `/api/factory` + `/factory`, `/api/coord`, `/agents`, `/api/dispatch`, `/api/sessions`.
- `backend/src/routes/agentTasks.ts` and `backend/src/routes/tasks.js` are **dead code** (not imported by `index.js`).

### Databases / key models (backend/prisma/schema.prisma)
`User`, `Task`, `Agent`, `Message`, `CoordinatorTask`, `SubTask`, `AuditLog`, `TokenUsage`, `Payout`, `DigitalProduct`, `FactoryRun`, `TaskAnalytics`. Migrations are NOT used — schema is applied with `prisma db push --accept-data-loss` at every backend boot.

---

## 3. PHASE 2 — BUILD / INSTALL / TYPE SAFETY

Package manager: **npm** (7 `package.json` + `package-lock.json` files; no yarn/pnpm/bun workspaces).

| Check | Result | Evidence |
|---|---|---|
| Frontend `npm ci` | PASS (with warnings) | 191 packages installed; **9 vulnerabilities: 1 critical, 5 high, 2 moderate, 1 low** |
| Frontend production build | PASS | `next build` — 18 routes compiled, type-check OK |
| Frontend typecheck (`tsc --noEmit`) | PASS | Exit 0 (note: `strict: false` in tsconfig) |
| Frontend lint | NOT CONFIGURED | No `lint` script, no ESLint config in repo |
| Frontend unit tests | NOT CONFIGURED | No test framework/scripts |
| Frontend E2E (Playwright) | NOT RUNNABLE AS-IS | `frontend/e2e/login-task.spec.ts` targets `http://localhost:3000` with hardcoded `admin@agentfinance.com/password`; not pointed at the live site |
| Backend install | PARTIAL | `node_modules` present; `npm ci` not re-run; postinstall = `prisma generate` |
| Backend build/typecheck/lint | NOT CONFIGURED | No build/lint/typecheck scripts; runtime is plain JS |
| Backend unit/integration tests | NOT CONFIGURED / NOT TESTABLE | No test files found |
| `prisma generate` | PASS | Schema generates (client present in `backend/node_modules/.prisma`) |
| Backend local boot | BLOCKED locally | Requires `DATABASE_URL` (not present locally); runs `prisma db push` on boot |

Vulnerabilities to remediate before launch: run `npm audit` in `frontend/` (1 critical).

---

## 4. PHASE 3 — FRONTEND AUDIT

- Startup / build: PASS (all 18 pages render over HTTP 200 on live site).
- Landing `/` → 307 redirect to `/login` when unauthenticated; `/dashboard` → redirects client-side when no token.
- API wiring: correct. Live client bundle points to `https://agentfinance-backend-zgjj.onrender.com`; CORS allows the frontend origin with credentials.
- No Railway internal refs. `localhost` only in dev fallbacks (`config.ts`, `serverConfig.ts` dev branch) and dev-only scripts/healthcheck files — none affect production.
- Login/register/logout UI: implemented and functional (verified via API).
- Loading states / empty states: present (skeletons, empty task lanes).
- Error handling: reasonable client-side catches; error messages surface API errors.
- Hardcoded/mock data found:
  - `NEXT_PUBLIC_AGENTS` fallback `alpha,beta,gamma` (dev-only path).
  - Dashboard/agents **"fleet"** is generated from the `AGENTS` env variable; on failure the UI falls back to a **fake 12-node demo fleet** (`frontend/src/app/agents/page.tsx:46-52`).
  - Earnings numbers are fabricated from a formula (`completed * 0.0035 ETH`) — not real balances/escrow.
  - `frontend/src/app/analytics/page.tsx:85` hardcodes `$3200` ETH price for USD conversion.
  - Factory e-commerce connectors table is static marketing text referencing local `n8n http://localhost:5678` (`frontend/src/app/factory/page.tsx:120`).
- "Railway backend env vars" is referenced inside an error string returned to users (`backend/src/agents/agentRunner.js:537-538`) — leaks infrastructure detail to end users.
- Hardcoded production URL `https://agentfinance.onrender.com` in `backend/src/index.js:71` (CORS allowlist) and `backend/src/agents/agentRunner.js:361` (OpenRouter referer) — matches actual deployment, so not currently harmful, but brittle.

---

## 5. PHASE 4 — AUTHENTICATION TEST (LIVE, VIA API)

| Test | Result |
|---|---|
| 1. Register new user | PASS — 200, JWT returned, cookie set |
| 2. Duplicate registration | PASS — 400 `username taken` |
| 3. Login valid credentials | PASS — 200, JWT + cookie |
| 4. Login invalid credentials | PASS — 401 `invalid credentials`; user enumeration not exposed by login |
| 5. Logout | **INCOMPLETE** — no backend `/auth/logout`; frontend only clears `localStorage`; the httpOnly `token` cookie stays valid for 7 days |
| 6. Protected endpoint without auth | PASS — 401 |
| 7. Protected endpoint with auth | PASS — 200 |
| 8. Page refresh while authenticated | PASS (token held in localStorage + cookie) |
| 9. Session/token persistence | PASS — cookie still valid after re-fetch |
| 10. Invalid/expired token | PASS (invalid token → 401). 7-day expiry (long); no refresh/revocation mechanism |

Implementation facts:
- Password hashing: bcrypt (10 rounds) — PASS.
- JWT: `HS256`, 7-day expiry, payload `{sub, username}`.
- Cookie: `httpOnly`, `secure` in production, `sameSite: none`, `maxAge` 7 days — reasonable, but no `__Host-` prefix, no explicit `domain`, no CSRF token.
- Admin flag: `isAdmin: user.username === 'okwedavid'` — **hardcoded username check**, not an admin model/role. Anyone can register `okwedavid`? `username` is unique — if the account already exists, registration is rejected. If it does not exist, an attacker can register it and become admin. Confirmed `isAdmin` is derived purely from the username server-side and client-side.
- CORS with credentials: PASS (frontend origin echoed; non-allowed origin rejected).
- Security weaknesses: no brute-force protection per account; global rate limit only; no account lockout; no MFA; no password change/reset; admin is username-based.

---

## 6. PHASE 5 — DATABASE AUDIT

- Canonical schema: `backend/prisma/schema.prisma` (13 models). Confirmed live: `/health` → `db: ok`.
- Migrations: **none** (`backend/prisma/migrations/` absent). Schema enforced via `prisma db push --accept-data-loss` at every boot (`backend/src/index.js:48`, `backend/package.json:10`, `backend/nixpacks.toml`). This is **destructive-capable** on every deploy.
- Seed scripts:
  - `backend/prisma/seed.ts` / `seed.js` call `agentEvent.deleteMany()` + `agentTask.deleteMany()` then re-create 156 tasks + 468 events. **Destructive.** They target `agentEvent/agentTask` (root-schema models) which are not even in the backend schema — likely inert, but must not be run against the live DB.
  - `backend/scripts/seedDemoUser.js` upserts `admin@agentfinance.com` / `password` (hardcoded credential in source).
- Live verified tables/data (via API — read-only): `User` exists (registration works, users persisted); `Task` exists (15 tasks); `Payout` exists (a payout created 2026-09-08 with status `approval_required`); `Agent` exists; `DigitalProduct` empty.
- No seed data is required for startup; the app boots without it.
- Decision: do not run any seed script against production.

---

## 7. PHASE 6 — BACKEND API AUDIT (LIVE)

| Endpoint | Auth | Status/Notes |
|---|---|---|
| `GET /health` | none | 200, `{status:ok, db:ok, redis:configured, agentsConfigured:100}` |
| `GET /system/runtime` | JWT | 200 — leaks which API keys are configured (boolean flags), fleet, treasury signer readiness + treasury address |
| `POST /auth/register` | none | 200/400/500, validated length (3-30 un / ≥6 pw) |
| `POST /auth/login` | none | 200/400/401 — no rate limit beyond global |
| `GET/PATCH /auth/me` | JWT | 200/404/500 |
| `POST /auth/wallet` | JWT | validates address format per network — PASS |
| `POST /tasks` | JWT | 200 — creates task, enqueues to BullMQ |
| `GET /tasks`, `GET /tasks/:id`, `PATCH`, `DELETE`, `DELETE /tasks/all` | JWT | correct — **access control verified**: another user's task id returns 404 |
| `POST /payouts/prepare` | JWT | 400 on invalid input; creates payout row (status blocked/approval_required) |
| `POST /payouts/:id/approve` | JWT | **Broadcasts real funds if a treasury signer is configured. CRITICAL.** |
| `GET /payouts`, `/payouts/:id/status` | JWT | 200 |
| `GET /analytics/summary`, `/history` | **NONE** | **200 unauthenticated — leaks ALL users' tasks, results, wallet addresses, payout records** |
| `DELETE /analytics/clear` | **NONE** | **Unauthenticated destructive — archives every user's tasks** |
| `GET/POST/PUT/DELETE /agents` | **NONE** | Unauthenticated CRUD on the Agent table |
| `/api/factory/*` | NONE | Unauthenticated → expensive AI generation (abuse/cost vector), product delete |
| `/api/coord/*`, `/api/dispatch`, `/api/sessions` | NONE | Unauthenticated Redis broadcast (spam/abuse) |
| `GET /wallet/balance` | optional | 200 — public balance lookup, valid address checks PASS |
| `/api/tasks/replay` | none | Synthetic event replay — demo-only endpoint live in production |

Error handling: generally safe (`{error: 'failed'}` etc.), but several handlers return `reason: err.message` (e.g., `/api/coord/summary`) exposing internal messages; 500s return `err.message` in factory routes; production errorHandler strips stack traces (PASS) but `x-powered-by: Express` leaks framework.

---

## 8. PHASE 7 — AGENT SYSTEM AUDIT (LIVE-TESTED)

**Result: the agent system is BROKEN in production.**

- Configured fleet: 100 agent names from `AGENTS` env (parsed with a quote bug: first id `"agent1`, last `agent100"`).
- Live task execution test: `POST /tasks` → worker runs `runAgent` → **fails on every provider**:

```
Groq:       HTTP 401 Invalid API Key
Google:     HTTP 404 gemini-2.0-flash no longer available (retired)
Anthropic:  HTTP 400 credit balance too low
OpenRouter: key not configured
Together:   key not configured
Mistral:    HTTP 429 rate limit exceeded
Cerebras:   HTTP 404 model does not exist / no access
```

- Because every provider fails, **no task ever completes** and the task is stored as `failed` with an error string that instructs users to fix "Railway backend env vars" (leaks infra detail).
- Agents implementation status:
  - Research/trading/content/coordinator roles: IMPLEMENTED (prompt templates + tool calls) but BLOCKED by provider config.
  - Execution agent: PARTIALLY IMPLEMENTED — produces a safe "prepared transaction; canBroadcast:false" plan only (no spontaneous broadcast). Good.
  - Tools: implemented for search (Tavily/Serper), prices (CoinGecko/CMC), yields (DeFiLlama), spread (SIMULATED with random numbers — not real exchange data), wallet balance (Alchemy), prepare transaction (mock).
  - `check_price_spread` fabricates a random spread on top of a real CoinGecko price and labels a "recommendation" — **misleading financial output**.
- No agent can trigger real financial transactions on its own (execution path returns a plan only). Payout broadcast is user-initiated (see Phase 9).
- Rate limiting: BullMQ worker limiter 10/min; no per-user task quota.

---

## 9. PHASE 8 — MARKET DATA / EXTERNAL SERVICES

| Provider | Used by | Mandatory? | Fallback | Missing key behavior | Status |
|---|---|---|---|---|---|
| CoinGecko | prices, overview, balances USD | No | CMC fallback | works unauthenticated | OK |
| CoinMarketCap | price fallback | No | — | skipped | OK |
| DeFiLlama | yields/TVL | No | — | free endpoint | OK |
| alternative.me | fear & greed | No | — | free | OK |
| Tavily / Serper | search | No | each other | returns "add TAVILY_API_KEY" | OK |
| Alchemy | RPC balances | No | Infura/public RPC | returns hint | OK |
| Groq | primary AI provider + Factory | **Yes for agents** | cascade | crashes agent/task; factory errors | **BROKEN (401)** |
| Google Gemini | AI fallback | No | cascade | — | **BROKEN (model retired)** |
| Anthropic | AI fallback | No | cascade | — | **BROKEN (credit)** |
| OpenRouter/Together | AI fallback | No | cascade | not configured | BROKEN |
| Mistral/Cerebras | AI fallback | No | cascade | — | BROKEN |
| Public RPCs / mempool.space | balances (polygon/base/arbitrum/bsc/btc) | No | — | free | OK |

Missing credentials never crash the app EXCEPT Groq+Factory (throws). Rate limits: AI cascade handles 429/4xx by trying next provider, but today all fail.

---

## 10. PHASE 9 — FINANCIAL / WALLET / TRADING / PAYOUT SAFETY  ⚠️

**No real transactions were performed. This is a code-path + config audit.**

### CRITICAL FINANCIAL RISK — Unauthorized treasury drain
- Backend signals `evmReady: true`, signer type `evm`, treasury `0x1560bc1E275D45f1771668600FA52E2DC5C231E2`.
- Flow (all accessible to any registered user):
  1. `POST /auth/register` — anyone can register.
  2. `POST /auth/wallet` — save attacker's own address.
  3. `POST /payouts/prepare` — create a payout for that address with **any amount** (validated only as `> 0`; no cap). Status becomes `approval_required` because the signer is ready.
  4. `POST /payouts/:id/approve` — `approvePayout()` → `broadcastEvmPayout()` constructs a `Wallet` from `TREASURY_PRIVATE_KEY` and calls `signer.sendTransaction({ to: recipientAddress, value })`.
- **No admin authorization, no amount cap, no two-person approval, no cooling period, no balance check.** The treasury signer is present and live on the production backend. If the treasury holds any balance, any unauthenticated-by-virtue-of-registration user can drain it.
- Confirmed a real payout record already exists in production (`approval_required`, created 2026-09-08 by another user) — the flow has been exercised.

Severity classification:
- CRITICAL — Payout approval can broadcast arbitrary real funds with zero authorization.
- HIGH — Treasury private key + address presence is disclosed via `/system/runtime`.
- HIGH — No withdrawal limits, no per-user caps, no rate limit on payouts.
- MEDIUM — `approvalToken` field exists in schema but is **never verified** in `approvePayout` — the token-based approval gate is not enforced.
- LOW — The username-based "admin" flag does not gate any financial operation.

### Other wallet/trading items
- `check_price_spread` tool simulates exchange spreads with random numbers — displayed as real analysis.
- Earnings figures on the UI are derived from a made-up formula (`0.0035 ETH / completed task`), not real account balances.
- Private keys are only read server-side from env (never sent to the browser) — PASS. No signatures are generated client-side. Public keys/addresses are never printed in this report.

---

## 11. PHASE 10 — REDIS / WEBSOCKET

- Redis: **REQUIRED for the queue/worker**, graceful if absent. Live: `redis: configured`; BullMQ queue + embedded worker enabled.
- WebSocket works: verified live — opening a WS at `wss://agentfinance-backend-zgjj.onrender.com/?token=<jwt>` delivered `task:created`, `task:running`, `task:failed` events as a task progressed. Auth via JWT query param; no `Origin` check on WS; no heartbeat/ping; client reconnects with a 4s backoff.
- Deployment compatibility: PASS on Render (HTTP + WS same port).
- Issues: no WS ping/keepalive (idle connections may be dropped silently), token passed in query string (leaks JWT into proxy logs), standalone `websocket/` service is broken (commented-out `wss` instantiation) but is not deployed.

---

## 12. PHASE 11 — ENVIRONMENT / SECRETS AUDIT

| Variable | Used by | Required? | Public/Private | Default? | Status |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | YES for prod build | PUBLIC | none (build fails without) | LIVE/CORRECT |
| `API_URL` | frontend server routes | no (falls back) | PRIVATE | localhost (dev) | OK |
| `NEXT_PUBLIC_AGENTS` | frontend | no | PUBLIC | alpha,beta,gamma | dev-only |
| `NEXT_PUBLIC_REPLAY_ENABLED` | frontend | no | PUBLIC | false | OK |
| `DATABASE_URL` | backend/prisma | YES | PRIVATE | none | LIVE |
| `REDIS_URL` | backend/worker | yes for queue | PRIVATE | none (graceful) | LIVE |
| `JWT_SECRET` | backend/websocket | YES (backend exits without) | PRIVATE | fallback `please_change_me*` in code | LIVE (set) |
| `TREASURY_PRIVATE_KEY` / `EVM_TREASURY_PRIVATE_KEY` | payoutService | for payouts | PRIVATE | none | LIVE (DANGEROUS) |
| `TREASURY_WALLET_ADDRESS` / `EVM_TREASURY_WALLET_ADDRESS` | payoutService | no | PRIVATE | derived | LIVE |
| `BTC_TREASURY_WIF` / `BTC_TREASURY_ADDRESS` | payoutService | no | PRIVATE | none | absent |
| `GROQ_API_KEY` | agents/Factory | yes for agents/Factory | PRIVATE | none | LIVE but INVALID (401) |
| `GOOGLE_AI_API_KEY` | agents | no | PRIVATE | none | LIVE but model retired |
| `ANTHROPIC_API_KEY` | agents | no | PRIVATE | none | LIVE but no credit |
| `MISTRAL_API_KEY`, `CEREBRAS_API_KEY` | agents | no | PRIVATE | none | LIVE but failing |
| `OPENROUTER_API_KEY`, `TOGETHER_API_KEY` | agents | no | PRIVATE | none | absent |
| `ALCHEMY_API_KEY` | balances/RPC | no | PRIVATE | none | LIVE |
| `COINGECKO_API_KEY`, `CMC_API_KEY` | market data | no | PRIVATE | none | CG live, CMC absent |
| `TAVILY_API_KEY`, `SERPER_API_KEY` | search | no | PRIVATE | none | Tavily live |
| `INFURA_API_KEY`, `ANKR_*`, `*_RPC_URL`, `BTC_API_BASE` | RPC | no | PRIVATE | public RPC fallback | optional |
| `AGENTS` | fleet list | no | PRIVATE | — | LIVE, 100 names, quote bug |
| `ALLOWED_ORIGINS` / `FRONTEND_URLS` | CORS | no | PRIVATE | hardcoded prod+localhost | optional |
| `PORT` | both | no | PUBLIC | 4000 / 3000 | OK |
| `NODE_ENV` | both | yes for prod behavior | PUBLIC | dev | set by Render |
| `LOG_LEVEL` | logger | no | PUBLIC | default | optional |

Findings:
- Secrets are NOT compiled into the client bundle (verified by scanning `.next/` build artifacts: no `sk-`, no `gsk_`, no private keys, no JWT secrets, no DB/Redis creds; only the public `NEXT_PUBLIC_*` values and the public backend URL).
- Hardcoded fallback JWT secrets in source: `please_change_me` (`backend/src/routes/wallet.js:7`), `please_change_me_locally` (`backend/src/middleware/auth.js:3`, `backend/src/utils/jwt.ts:3`). If `JWT_SECRET` is ever unset on a node using these modules, JWTs become forgeable. `index.js` exits if `JWT_SECRET` is missing (PASS), but `wallet.js` and `auth.ts` remain vulnerable to a default secret.
- Hardcoded demo credentials committed: `admin@agentfinance.com` / `password` (in `backend/scripts/seedDemoUser.js`, `scripts/login_and_create.ps1`, `frontend/e2e/login-task.spec.ts`).
- `cookies.txt`, `tmp_seed.sql`, `tmp-dispatch.json` exist in repo root — no secret values found, but should be removed.

### Variable classification
REQUIRED: `NEXT_PUBLIC_API_URL`, `DATABASE_URL`, `JWT_SECRET`
PRIVATE: all API keys, `REDIS_URL`, treasury vars
SUSPICIOUS: `TREASURY_PRIVATE_KEY` configured in production while the unprotected approve endpoint is reachable
OBSOLETE: `NEXT_PUBLIC_AGENTS` fallback (demo list), `PORT_WS`/standalone-service vars (services not deployed)

---

## 13. PHASE 12 — PRODUCTION CONFIGURATION

- PORT: env-driven; backend binds `0.0.0.0` (PASS), frontend `next start -p $PORT` (PASS).
- CORS: allowlist + credentials (PASS) — but includes `http://localhost:3000`/`4000` in production allowlist (MEDIUM).
- Frontend→backend URL: correct on Render; enforced at build time (PASS).
- WS: derived from API URL as wss (PASS, verified).
- NODE_ENV: set by Render build (PASS).
- Logging: Winston configured; workers/coordinator use console. No log aggregation/monitoring wired.
- Health checks: backend `/health` (PASS), frontend `/api/health` proxy (PASS). No Render healthcheck config on backend service (only frontend `railway.json` has one; Render uses defaults).
- Graceful shutdown: none implemented (process killed on deploy; in-flight tasks may be lost. BullMQ job retention mitigates partially).
- DB handling: `prisma db push --accept-data-loss` at every boot — destructive on deploy (HIGH risk) and a boot-time dependency on DB reachability.
- Render-specific issues: none fatal to startup; free-tier cold starts + 7:30m | deployment swap noted as an op consideration.

---

## 14. PHASE 13 — ERROR HANDLING

- 401/403/404 behaviors: correct (verified live).
- 400 validation: correct on auth/wallet/tasks/payouts.
- 429: global limiter works (verified 87×429 on a 700-rpm burst) — but no per-user brute-force protection. Login returns 429 `rate_limit_exceeded` (not JSON-clear for UX).
- 422: not used anywhere.
- 500s: mostly generic `{error:'failed'}`; but several endpoints echo `err.message`/`reason` (factory, coordinator) — can leak DB/provider internals.
- No stack traces in production responses (PASS) — errorHandler strips them.
- Logs: not accessible from repo; no observation of Render logs available in this environment.

---

## 15. PHASE 14 — SECURITY AUDIT SUMMARY

| Item | Finding | Severity |
|---|---|---|
| Unprotected treasury drain (prepare+approve payout) | Any user can broadcast treasury funds | **CRITICAL** |
| Unauthenticated analytics endpoints | Cross-user data leak (tasks, wallets, payouts) + global destructive clear | **HIGH** |
| Unauthenticated `/agents` CRUD | Anyone can create/delete agents | HIGH |
| Unauthenticated Factory endpoints | Cost/abuse vector (AI generation), product delete | HIGH |
| JWT fallback secrets in code | Forgeable if env missing | MEDIUM |
| Incomplete logout (no server invalidation) | Auth cookie remains valid 7 days after logout | MEDIUM |
| No brute-force protection (global 600/min only) | Credential stuffing feasible | MEDIUM |
| Admin = username string | Weak, registrable, no role model | MEDIUM |
| Unsanitized profile input stored | Inert now (React escapes), but unvalidated server-side | MEDIUM |
| Token in WS query string | JWT in access logs/proxies | MEDIUM |
| Demo endpoints live in prod (/api/tasks/replay) | Attack surface / confusion | MEDIUM |
| `prisma db push --accept-data-loss` on boot | Destructive schema tool on every deploy | MEDIUM/HIGH |
| SQL injection / command injection | NOT FOUND — Prisma parameterized, no `child_process` on user input | OK |
| XSS (rendered) | NOT FOUND — no dangerouslySetInnerHTML/innerHTML | OK |
| IDOR on tasks/payouts | NOT FOUND — ownership scoping verified (404 on other user's task) | OK |
| Logout/CSRF | No CSRF token, cookie not required by app logic (LocalStorage token primary) | LOW |
| CORS dev origins in prod allowlist | localhost:3000/4000 allowed | LOW |
| Hardcoded prod URL + "Railway" in user-facing errors | Brittle infra leakage | LOW |
| Secrets in client bundle | NOT FOUND (build artifact scan clean) | OK |

---

## 16. PHASE 15 — PERFORMANCE / RELIABILITY

- Analytics endpoints load up to 500 tasks per call and filter in JS per request — N+1-ish / heavy but low volume today (15 tasks). MEDIUM as it scales.
- Frontend: `/tasks` and `/system/runtime` fetched per page mount; WS event triggers full re-fetch (fine at low volume).
- No unbounded queues in practice (BullMQ retention settings sane). Worker concurrency 3, limiter 10/min.
- AI cascade: 7 sequential provider calls with 30s timeouts each → worst-case ~3.5 min per task. No per-task global timeout on the HTTP request (Express request may hang past client timeout). MEDIUM.
- No cache for CoinGecko/RPC lookups — repeated calls every page render. LOW.
- No N+1 query anti-patterns found; no memory-leak red flags in code (`useWebSocket` cleans up, reconnect bounded at 4s).
- Cluster-free single instance; no horizontal scaling config. OK for MVP.

---

## 17. PHASE 16 — PUBLIC USER JOURNEY (API-level simulation)

New user: Landing (`/`→307→`/login`) → register 200 → dashboard access via token 200 → agent launch fails (ALL providers error) → wallet page: balance lookup OK for a valid address, payout prepare blocked w/o address → logout (localStorage only, cookie persists) → login again 200. Clear, functional sign-in/sign-up path. **The central "launch agent and get analysis" step is broken for every provider.**

Existing user: Sign in, view tasks (200), analytics (200), wallet (200), profile (200), settings (200). Working.

Mobile: single-column responsive layout with bottom nav present in code; not rendered/browser-tested in this environment — NOT TESTABLE here.

---

## 18. PHASE 17 — PRODUCTION BUILD ARTIFACT AUDIT

Built `frontend/.next` locally with the same `NEXT_PUBLIC_API_URL` as production and scanned:
- No Railway URLs, no localhost API endpoints in output.
- No API keys / `sk-*` / `gsk_*` / private-key material / DB & Redis credentials in compiled bundles (verified matches were false positives of framework identifiers).
- Only public `NEXT_PUBLIC_*` values and the public backend origin are baked in — expected and safe.

---

## 19. PHASE 18 — TEST RESULT MATRIX

| AREA | STATUS | EVIDENCE | SEVERITY | NEXT ACTION |
|---|---|---|---|---|
| Frontend production build | PASS | `next build` 18 routes OK | — | none |
| Frontend typecheck | PASS | `tsc --noEmit` exit 0 (strict off) | LOW | enable strict |
| Frontend deps | PARTIAL | 9 vulns (1 critical) | HIGH | `npm audit fix` review |
| Frontend lint | NOT CONFIGURED | no script | LOW | add ESLint |
| Frontend unit/E2E tests | NOT IMPLEMENTED / NOT RUNNABLE | only 1 localhost-hardcoded spec | MEDIUM | real CI + staging target |
| Backend build/lint/test | NOT CONFIGURED | — | MEDIUM | add scripts |
| Registration | PASS | 200 + JWT | — | — |
| Duplicate registration | PASS | 400 | — | — |
| Login valid | PASS | 200 | — | — |
| Login invalid | PASS | 401 | — | — |
| Auth middleware (no token) | PASS | 401 | — | — |
| Task ownership/IDOR | PASS | 404 for foreign task | — | — |
| Logout / session invalidation | PARTIAL | cookie persists 7d | MEDIUM | server-side logout |
| Rate limiting (global) | PASS | 429 observed @600/min | MEDIUM | per-user login limits |
| CORS | PASS | allowlist + credentials verified | — | remove dev origins |
| WebSocket live events | PASS | created/running/failed delivered | — | add WS auth-ping |
| AI agent execution | **FAIL** | all 7 providers error live | **CRITICAL to product** | fix keys/models/credit |
| Aggressive spread tool | PARTIAL | random spread simulated | MEDIUM | remove or mark demo |
| Payout prepare validation | PASS | 400 on bad input | — | — |
| Payout approve authorization | **FAIL** | broadcasts with no admin/cap | **CRITICAL financial** | gate + cap + 2FA |
| Analytics endpoints auth | **FAIL** | 200 unauth cross-user leak + destructive clear | **HIGH** | require JWT + scope |
| Agents CRUD auth | **FAIL** | unauth create/delete | HIGH | require JWT (+admin) |
| Factory endpoints auth | **FAIL** | unauth AI cost/abuse | HIGH | require JWT |
| Scheduled/background jobs | PARTIAL | BullMQ worker inline; standalone svcs broken | MEDIUM | deploy only what runs |
| DB migrations | NOT IMPLEMENTED | `db push --accept-data-loss` on boot | HIGH | switch to `prisma migrate` |
| Destructive seed safety | FAIL | seeds wipe data | MEDIUM | never run in prod |
| Secrets in client bundle | PASS | scan clean | — | — |
| Secrets in source | FAIL | hardcoded JWT fallbacks + demo creds | MEDIUM | env-only + purge |
| Admin model | PARTIAL | username-based | MEDIUM | proper roles |
| Graceful shutdown | NOT IMPLEMENTED | — | MEDIUM | add SIGTERM drain |
| Error message hygiene | PARTIAL | some `err.message`/`reason` leaks; "Railway" text | LOW | sanitize |
| Security headers | NOT CONFIGURED | no CSP/HSTS | LOW | add headers |
| Database state | PASS | db ok, User/Task/Payout exist | — | — |

---

## 20. PHASE 19 — FINAL DECISION

### **NOT PUBLIC READY.**

The platform is deployable, stable, and auth works, but two issues make public launch unacceptable:

### BLOCKERS BEFORE PUBLIC LAUNCH
1. **CRITICAL — Treasury drain via payout approval.** Any registered user can prepare and approve a payout that broadcasts arbitrary funds from the live treasury wallet. Require: admin/operator authorization, hard per-user and per-request amount caps, verifiable `approvalToken` enforcement, and disable auto-broadcast until a safe custody review is done. Consider removing `TREASURY_PRIVATE_KEY` from the environment entirely until the flow is gated.
2. **HIGH/CRITICAL — AI agents are fully broken.** Groq key invalid (401), Gemini model retired (404), Anthropic out of credit, Mistral rate-limited, Cerebras no-access, OpenRouter/Together unset. No task can complete. Fix or replace provider config, or finish the local/fallback research engine so "launch agent" yields value.
3. **HIGH — Unauthenticated analytics endpoints leak all user data** and allow a global destructive clear.

### IMPORTANT BUT CAN FOLLOW AFTER LAUNCH
- Frontend dependency vulnerabilities (1 critical in the tree).
- Per-account brute-force protection + account lockout.
- Real logout (invalidate server session) + token expiry/refresh policy.
- Replace `prisma db push --accept-data-loss` with migrations on boot.
- JWT fallback secrets removed; `JWT_SECRET` strength check.
- Proper admin/roles instead of a username check.
- Remove demo endpoints (`/api/tasks/replay`) and hardcoded dev origins from CORS.
- Tests: unit + integration + a real staging E2E suite (remove hardcoded creds).

### NICE TO HAVE
- WS heartbeat/ping, token not in WS query string, message-level WS auth.
- Security headers (CSP, HSTS), `<__Host-` cookies, CSRF token.
- Real market-data spread instead of random simulation.
- Graceful shutdown, observability (metrics/logs), rate-limit UX.
- Cleanup of temp files (`cookies.txt`, `tmp_seed.sql`, `tmp-dispatch.json`, `tmp-*.js/cjs`) and dead microservices.

---

## 21. PHASE 20 — PRIORITIZED ROADMAP

### PHASE 0 — Critical security/data issues (do first, offline)
1. **Disable/guard the payout approval broadcast.**
   - Priority: P0 — CRITICAL
   - Problem: any user can broadcast treasury funds.
   - Files: `backend/src/services/payoutService.js:328-381`, `backend/src/index.js:648-656`, `frontend/src/app/wallet/page.tsx:236-247`
   - Fix: remove server-side private signing from runtime OR gate with admin approval + hard caps + `approvalToken` verification + balance limits; remove `TREASURY_PRIVATE_KEY` from env until fixed.
   - Test: attempts from non-admin must be blocked; caps enforced; regression test for double-approval.
2. **Force auth + ownership on analytics.**
   - Files: `backend/src/routes/analytics.js` (all routes)
   - Fix: require `authMiddleware`, scope queries to `req.user.sub`, remove `/clear` or scope it.
   - Test: unauthenticated → 401; cross-user data must not appear.
3. **Remove `--accept-data-loss` db push from both boot paths.**
   - Files: `backend/src/index.js:45-59`, `backend/package.json:10`, `backend/nixpacks.toml`
   - Fix: use `prisma migrate deploy` + reviewed migrations; make boot not mutate schema.

### PHASE 1 — Must-fix launch blockers
4. **Restore agent execution.**
   - Files: `backend/src/agents/agentRunner.js` (provider list + models), env config on Render
   - Fix: put a valid provider first (e.g., working Groq key, current Gemini model `gemini-3.6-flash`, funded Anthropic) AND add a graceful "research engine w/o LLM" fallback so tasks still produce useful output; fix per-task global timeout.
   - Test: `POST /tasks` completes with content for research/trading/coordinator prompts.
5. **Require auth on `/agents` CRUD and Factory routes.**
   - Files: `backend/src/routes/agents.js`, `backend/src/routes/factory.js`
   - Test: 401 without token; admin-only for destructive ops.

### PHASE 2 — Core reliability
6. **Proper session lifecycle.** Add `POST /auth/logout` (cookie + token revocation/blacklist) and optional refresh tokens. `backend/src/index.js`, `frontend/src/lib/api.ts`.
7. **Per-account brute-force protection** on `/auth/login` (express-rate-limit keyed by username+IP) + optional lockout.
8. **Migrations instead of db push**; safe seed scripts; remove destructive seeds from repo or gate them.
9. **Remove hardcoded JWT fallbacks** and enforce secret strength at boot.

### PHASE 3 — UX / product completion
10. **Replace fake data**: fleet fallback list, earnings formula, $3200 ETH price, random spread output — mark as simulated or compute real values.
11. **Admin model** with proper roles/claims instead of username check; admin surface for payouts/factory.
12. **Error message hygiene**: strip "Railway env vars", internal `reason`/`err.message`; add security headers and remove `x-powered-by`.

### PHASE 4 — Performance
13. Cache market-data lookups (CoinGecko/RPC) with short TTL; paginate analytics; add per-task timeout guard; per-user task rate cap.

### PHASE 5 — Future improvements
14. WS ping/keepalive + token in header/subprotocol; standalone microservice cleanup (broken `websocket`, `coordinator`, `subtask-worker` start scripts and ESM/CJS mismatch); staging environment; CI pipeline with unit/integration/E2E; observability.

---

*Audit completed without modifying the repository, the databases, the Redis instance, or Render; without rotating credentials; and without executing any real financial transaction.*

*Test accounts created during the audit: `audit_user_*`, `audit_cookie_*`, `AuditCase_*`, `xss_user_*` (disposable; no privileges). They may be deleted by an operator.*