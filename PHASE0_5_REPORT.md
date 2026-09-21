# PHASE 0.5 — Production Hardening Report

Scope: issues surfaced during deployed testing after Phase 0 (session auth). No agent architecture changes, no dependency upgrades, no unrelated refactoring. House rules kept: never broadcast a real transaction during this work, no treasury key changes (`TREASURY_PRIVATE_KEY` / `PAYOUT_ENABLED` untouched), no destructive DB commands in this report's verification.

Branch: `main` · Base commit: `2fbc0c5` · Report file: `PHASE0_5_REPORT.md`

---

## 1. Payout approval failure (CALL_EXCEPTION, version=6.16.0)

### 1.1 Root cause analysis

`broadcastEvmPayout()` in `backend/src/services/payoutService.js` sends a **native asset transfer**:

```js
await signer.sendTransaction({ to: payout.recipientAddress, value: parseEther(String(payout.amount)) });
```

Ethers v6 serializes this request with `data: "0x"` — **empty calldata is correct for a native ETH/BNB/MATIC transfer**. The `data: "0x"` in the error is not a bug in itself.

The `CALL_EXCEPTION` (ethers v6.16.0, `version=6.16.0`) is thrown by `eth_estimateGas` when the RPC node rejects the call during `sendTransaction`. For a native transfer the realistic causes are **environmental**, not code:

1. **RPC / chain mismatch** — the configured RPC responds for a different chain than the `chainId` the provider pins to, so estimation fails.
2. **Insufficient treasury native balance** — value (+ gas) exceeds the treasury wallet balance on that network.
3. **Recipient rejects native value** — destination is a contract that cannot receive the native asset.

### 1.2 Changes made

- Extracted a **pure, testable transaction builder** `buildEvmPayoutTransaction({ network, recipientAddress, amount })` returning an explicit `{ to, value, data: "0x", chainId }`. It validates the address and amount and **rejects non-EVM networks**, so a future token path can never silently emit empty calldata for a contract call.
- `broadcastEvmPayout()` now builds the tx through that helper and wraps provider/broadcast errors:
  - **Server side**: full raw error, `payoutId`, network, and recipient logged via `logger.error`.
  - **Client side**: sanitized message only (see §5) with HTTP 502 for blockchain execution failures.
- `POST /payouts/:id/approve` maps sanitized errors to `"The transaction could not be broadcast: <safe message>"`; the raw ethers stack is never sent to the browser.

### 1.3 Configuration required for approval to succeed

- Each EVM network needs a **reachable RPC** (`ETH_RPC_URL` / `POLYGON_RPC_URL` / `ARBITRUM_RPC_URL` / `BASE_RPC_URL` / `BSC_RPC_URL`, or `ALCHEMY_API_KEY`/`ANKR_RPC_URL`).
- A **valid EVM treasury private key** (`TREASURY_PRIVATE_KEY` or `EVM_TREASURY_PRIVATE_KEY`) matching `TREASURY_WALLET_ADDRESS`.
- **Treasury balance** ≥ amount + gas on the destination chain.
- The **recipient must accept the native asset** (not be a value-rejecting contract).
- Verify the RPC actually serves the pinned `chainId` (`1/137/42161/8453/56`).

Before Phase 0.5 the exact raw ethers message (`missing revert data (action="estimateGas" … code=CALL_EXCEPTION)`) was passed straight to the user UI. The documentation crypto is now: logged raw → sanitized client message (§5).

---

## 2. Wallet never auto-connects

- On load, login, register, and opening the wallet page the app **never calls `eth_requestAccounts`**. The wallet page only renders the previously saved account address from the server.
- New pure module `frontend/src/lib/walletProviders.ts`:
  - `detectInjectedProviders()` reads **all** providers from `window.ethereum.providers` (e.g. MetaMask + Brave both installed) and labels them (MetaMask, Brave Wallet, Coinbase Wallet, OKX Wallet, Trust, Rabby, …), deduping aliases (Brave is checked before MetaMask because Brave exposes `isMetaMask` in some versions).
  - `requestWalletAccounts()` / `switchWalletNetwork()` perform the actual wallet request and chain switch.
- Wallet page flow is now **explicit and staged**:
  1. User clicks “Connect wallet” → picker opens showing every detected wallet.
  2. User chooses a wallet → only then is `eth_requestAccounts` called.
  3. Zero detected wallets → clear install guidance, no error spam.
- A regression test asserts the list of providers is always returned for the caller to choose from (never auto-selected).

---

## 3. Admin pending-approval queue + approval/reject workflow

### 3.1 Backend (`backend/src/index.js` + `services/payoutService.js`)

- `GET /payouts/admin/queue` — `requireAdmin` (ADMIN or SUPER_ADMIN). Returns the last 100 payouts joined with the requesting user (`username`, `email`, `displayName`) plus `statusMeta` (public status model). Server-scoped; a user can never see other users’ payouts by guessing IDs (`listPayouts`/`refreshPayoutStatus` remain per-user).
- `POST /payouts/:id/reject` — `requireAdmin`. Marks a payout `rejected`, stores `rejectedAt` + reason. Schema gained `rejectedAt`.
- **Self-service blocked server-side**: `approvePayout` and `rejectPayout` return 403 if `payout.userId === actorId` (an actor may never approve/reject their own withdrawal — enforced at the service layer, not just the route).
- Approval still requires the per-request `approvalToken` (403 on missing/mismatched token) — this gate is unchanged and never weakened.
- Already-processed payouts are protected: re-approving a `rejected` payout → 409; rejecting a `broadcasted`/`confirmed` payout → 409.

### 3.2 Frontend

- New **`/admin`** page (`frontend/src/app/admin/page.tsx`): stat cards (awaiting approval / broadcast+confirmed / rejected / total), pending queue cards with requester, amount, destination, network, status pill, explorer link, **Approve & send** (confirm dialog) and **Reject** (reason dialog) actions, plus a recent-activity table.
- Nav (`TopNav`) shows an **Admin** link only for `isAdmin`/`isSuperAdmin` users, in both desktop and mobile menus.

---

## 4. Withdrawal status UX + pending amount styling

- Status badges now use a **public status model** (`mapPayoutStatus`): `pending_approval` → “Pending approval” (amber), `approved`, `rejected` (rose), `processing` (cyan), `completed` (emerald), `failed` (rose), `blocked`. Pending/processing pills show a pulsing live dot. Stored statuses are untouched for backward compatibility.
- Pending amounts are emphasized: larger bold amber figures with a pulsing “Awaiting approval” indicator on the wallet page (Pending routing stat + Latest payout amount card) and in the admin queue.
- Rejected payouts surface the stored rejection reason to the requester on the wallet page.
- The navbar was already sticky (`sticky top-0 z-50` with backdrop blur) — verified, no change required.

---

## 5. Error-handling hygiene (no raw RPC internals in the UI)

- New `sanitizeBlockchainError()` maps known ethers/NPM failure shapes to safe, human messages (missing revert data / CALL_EXCEPTION / insufficient funds / nonce / network timeout), with a generic fallback. It never echoes RPC URLs, private data, or stack traces.
- Raw details stay in server logs; `POST /payouts/:id/approve` returns `{ error: "The transaction could not be broadcast: …" }` for blockchain failures and keeps 403/409 for authorization/state errors.
- `errorHandler` (production) still returns only `err.message`, so no stack leakage from any other route.

---

## 6. Social login UI

- Login page now calls the backend `/auth/oauth/providers` (returns all providers with a `configured` flag) and renders **Google, Facebook, and X**:
  - Configured → real “Continue with …” link to `/auth/oauth/<id>/start`.
  - Unconfigured → shown but visibly disabled with an “unavailable” note (requires `GOOGLE_CLIENT_ID`, `FACEBOOK_CLIENT_ID`, `X_CLIENT_ID` + secrets on the server).
- Added `getOAuthProviders()` to `frontend/src/lib/api.ts`.

---

## 7. Tests

### 7.1 Backend — `backend/test/phase0_5.test.mjs` (15 new; total 27 pass via `npm test`)

| Behavior | Assertion |
| --- | --- |
| Native tx builder | `data === "0x"`, correct `to`/`value`, `chainId` per network (ethereum=1, base=8453) |
| Non-EVM guard | Bitcoin request throws instead of emitting empty calldata |
| Input validation | bad address / zero / negative amount rejected (400) |
| Status mapping | `approval_required`→pending, `broadcasted`→processing, `confirmed`→completed, `rejected`, `failed`, `blocked` |
| Error sanitization | CALL_EXCEPTION / missing-revert-data / insufficient-funds → safe text; unknown → generic, never echoes raw detail |
| Role gates | USER → 403 on `requireAdmin`; ADMIN + SUPER_ADMIN pass; role read fresh from DB so a **demoted admin loses access immediately** |
| User cannot approve | normal user 403 on admin route and can’t approve another’s payout |
| Self-approval | 403 for own withdrawal even with valid token & admin role |
| Token gate | mismatched `approvalToken` → 403 |
| State guards | approve on rejected → 409; reject on broadcasted → 409 |
| Reject workflow | other-user request → `rejected` + reason + `rejectedAt` |
| Admin queue | joins requester (username/email) + `statusMeta` mapped |

### 7.2 Frontend — `frontend/scripts/test-wallet.mjs` (8 tests via `npm test`)

Provider detection (none / single / multi-provider with dedupe), scenario labels (Brave vs MetaMask), explicit-only `requestAccounts`, chain-switch error mapping (4902 readable, 4001 ignored), no-auto-connect guarantee, install message.

### 7.3 Build & static verification

- `node --check` on all touched backend files — OK
- `DATABASE_URL=… npx prisma validate` — schema valid
- `npx tsc --noEmit` (frontend) — clean
- `npm run build` (Next production build, `NEXT_PUBLIC_API_URL` set) — OK, includes the new `/admin` route
- `npm test` backend 27/27, frontend 8/8 — green

UI behaviors that require a real browser and wallet extension (multi-provider picker clicking, OAuth redirect round-trip) are covered by unit tests on the driving logic and by the successful production build; full manual QA on a wallet-equipped browser remains a deployment step (REQUIRES MANUAL).

---

## 8. Files changed

**Backend**
- `src/index.js` — admin queue + reject endpoints, sanitized approve errors
- `src/services/payoutService.js` — `buildEvmPayoutTransaction`, `sanitizeBlockchainError`, `mapPayoutStatus` + `PAYOUT_STATUS`, `rejectPayout`, `listPayoutsForAdmin`, self-service guard, rejected summary
- `prisma/schema.prisma` — `Payout.rejectedAt`
- `package.json` — `test` script; `test/phase0_5.test.mjs` added

**Frontend**
- `src/app/admin/page.tsx` — new admin approval queue
- `src/app/wallet/page.tsx` — provider picker (no auto-connect), status badges, pending styling, rejected reason
- `src/components/layout/Nav.tsx` — Admin link for admins
- `src/lib/api.ts` — admin queue/reject/OAuth provider helpers
- `src/app/login/page.tsx` — all three provider buttons with disabled state
- `src/lib/walletProviders.ts` — pure provider detection/connect helpers
- `package.json` — `test` script; `scripts/test-wallet.mjs` added

## 9. Deploy notes

1. Backend: `prisma db push` applies the new `rejectedAt` column (already part of the start script) — additive only.
2. Ensure per-network RPC + treasury key/balance to make the approve→broadcast path succeed (§1.3).
3. Frontend build requires `NEXT_PUBLIC_API_URL` pointing at the backend origin.
4. OAuth buttons remain disabled until provider credentials are set on the server.
5. No treasury keys were touched; payout authorization gating is unchanged or stricter (self-approval now blocked).

## 10. Phase status

Phase 0.5 scope is complete and verified locally (see §7). Next phase is gated only on deploying and confirming testimonials in a wallet-equipped browser.