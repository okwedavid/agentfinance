import { API_URL, WS_URL } from './config';

export const API_BASE = API_URL;
export const WS_BASE = WS_URL;

// ── Session credentials ───────────────────────────────────────────────────────
//
// The session lives in an HttpOnly cookie set by the backend. It is deliberately
// NOT kept in sessionStorage or localStorage:
//
//   - The old build stored the JWT in sessionStorage and replayed it as an
//     Authorization header. That made the token readable by any script on the
//     page (one XSS = full account takeover) and per-tab, so a refresh, a new tab
//     or ordinary navigation silently dropped the login.
//   - An HttpOnly cookie is invisible to JavaScript and is sent automatically by
//     the browser on every request, which is what makes the session survive.
//
// `webSocketToken` is the single exception, in memory only. A WebSocket handshake
// cannot read cookies, so the backend exposes a short-lived ticket for that one
// purpose. It is never written to storage.

/**
 * In-memory WebSocket ticket. Deliberately not persisted: it is a single-use,
 * short-lived credential and must not outlive the page.
 *
 * A WebSocket handshake cannot send cookies, so the backend issues this ticket
 * from the authenticated session. It is the ONLY credential the browser holds in
 * script-readable form, it is never written to storage, and it is scoped to the
 * WebSocket handshake.
 */
/**
 * Marker cookie name. Must match SESSION_MARKER_COOKIE in sessionCookie.js.
 * Carries no authority — it only tells the page a session might exist so a guard
 * does not redirect before /auth/me has answered.
 */
const SESSION_MARKER_COOKIE = 'af_session_present';

let wsTicket: { token: string; expiresAt: number } | null = null;

export function getWebSocketTicket(): string | null {
  if (!wsTicket) return null;
  if (Date.now() >= wsTicket.expiresAt) {
    wsTicket = null;
    return null;
  }
  return wsTicket.token;
}

export function setWebSocketTicket(token: string, ttlSeconds = 60) {
  wsTicket = { token, expiresAt: Date.now() + ttlSeconds * 1000 };
}

export function clearWebSocketTicket() {
  wsTicket = null;
}

/**
 * Whether a session may exist.
 *
 * Intentionally NOT a proof of authentication. The cookie is HttpOnly, so the
 * page cannot inspect it; the only authority on whether the user is logged in is
 * `GET /auth/me`. This helper exists solely so a guard can skip a pointless
 * redirect on a page the user cannot possibly be authenticated on, and callers
 * must still resolve the real state before rendering protected UI.
 */
export function isLoggedIn(): boolean {
  if (typeof document === 'undefined') return false;
  // A visible marker cookie set alongside the HttpOnly session cookie. Carries
  // no authority: the server still validates the HttpOnly cookie on every call.
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${SESSION_MARKER_COOKIE}=`));
}

export function logout() {
  clearWebSocketTicket();
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('agentfi_wallet');
    window.sessionStorage.removeItem('af_settings');
    localStorage.removeItem('agentfi_wallet');
    localStorage.removeItem('af_settings');
  }
}

/**
 * Server-side logout: revokes the session AND clears the cookie.
 *
 * The server-side revoke is what makes the credential worthless. Clearing the
 * browser copy alone would leave a still-valid token usable by anyone who had
 * captured it, so logout must always do both.
 */
export async function logoutSession() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // A network failure must not trap the user in a signed-in UI.
  } finally {
    logout();
  }
}

export async function promoteUser(username: string) {
  return apiFetch('/auth/promote', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function demoteUser(username: string) {
  return apiFetch('/auth/demote', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

/**
 * The single authenticated-request path for the whole app.
 *
 * Every call uses `credentials: 'include'` so the HttpOnly session cookie is
 * sent. This is centralised deliberately: the previous build mixed
 * include/omit across call sites, which is exactly the class of bug where an
 * endpoint "randomly" 401s depending on how it was called.
 */
export async function apiFetch(path: string, options: RequestInit = {}) {
  if (!API_BASE) {
    throw new Error(
      'Backend endpoint is not configured. Set NEXT_PUBLIC_API_URL to the backend origin in Render and rebuild.',
    );
  }
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    // Never overridable: the cookie is the session, so omitting credentials here
    // would silently produce an unauthenticated request.
    credentials: 'include',
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function login(username: string, password: string) {
  // The session arrives as a Set-Cookie; the body `token` is ignored on purpose.
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function register(username: string, password: string, email?: string) {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
}

/** Linked provider identities for the signed-in user. */
export async function getAuthIdentities() {
  const data = await apiFetch('/auth/identities');
  return Array.isArray(data?.identities) ? data.identities : [];
}

export async function unlinkAuthIdentity(provider: string) {
  return apiFetch('/auth/identities/unlink', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export async function getMe() {
  return apiFetch('/auth/me');
}

/**
 * Exchange the HttpOnly session for a short-lived WebSocket ticket.
 *
 * A browser cannot attach cookies to a WebSocket handshake, so realtime auth
 * needs an explicit credential. The ticket is returned in the response body,
 * held in memory only, and never persisted — the previous build kept the full
 * session JWT in sessionStorage purely to satisfy this one handshake.
 */
export async function issueWebSocketTicket() {
  const data = await apiFetch('/auth/ws-ticket', { method: 'POST' });
  if (data?.ticket) setWebSocketTicket(data.ticket, Number(data.expiresIn) || 60);
  return data?.ticket as string | undefined;
}

export async function getRuntimeStatus() {
  return apiFetch('/system/runtime');
}

export async function getTasks() {
  const data = await apiFetch('/tasks');
  return Array.isArray(data) ? data : (data?.tasks || []);
}

export async function createTask(action: string, agentType?: string, agentId?: string) {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({ action, agentType, agentId }),
  });
}

export async function patchTask(id: string, patch: Record<string, unknown>) {
  return apiFetch(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function retryTask(id: string) {
  return apiFetch(`/tasks/${id}/retry`, { method: 'POST' });
}

export async function deleteTask(id: string) {
  return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
}

export async function deleteAllTasks() {
  return apiFetch('/tasks/all', { method: 'DELETE' });
}

export async function getWalletBalance(address: string) {
  return getWalletBalanceForNetwork(address, 'ethereum');
}

export async function getWalletBalanceForNetwork(address: string, network: string) {
  return apiFetch(`/wallet/balance?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network)}`);
}

export async function saveWalletAddress(address: string | null, network = 'ethereum') {
  return apiFetch('/auth/wallet', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: address, network }),
  });
}

export async function updateProfile(profile: {
  displayName?: string;
  bio?: string;
  preferredNetwork?: string;
}) {
  return apiFetch('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(profile),
  });
}

/**
 * Permanently deletes the signed-in account (tasks, payouts and profile).
 * Returns { redirect } pointing at `/login`.
 */
export async function deleteAccount() {
  return apiFetch('/auth/me', { method: 'DELETE' });
}

export async function preparePayout(input: {
  action: string;
  amount: number | string;
  network: string;
  recipientAddress?: string | null;
}) {
  return apiFetch('/payouts/prepare', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getPayouts() {
  const data = await apiFetch('/payouts');
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch the approval token for exactly one payout.
 *
 * The admin queue and the user's payout list no longer return approval tokens:
 * the token is a bearer credential for treasury broadcast, so spreading it
 * across list responses meant any client that could read a payout row could
 * also move real funds. The approval screen now requests it on demand.
 */
export async function getPayoutApproval(payoutId: string) {
  return apiFetch(`/payouts/${payoutId}/approval`);
}

export async function approvePayout(payoutId: string, approvalToken?: string) {
  return apiFetch(`/payouts/${payoutId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ approvalToken }),
  });
}

export async function refreshPayoutStatus(payoutId: string) {
  return apiFetch(`/payouts/${payoutId}/status`);
}

export async function getAdminPayoutQueue() {
  const data = await apiFetch('/payouts/admin/queue');
  return Array.isArray(data) ? data : [];
}

export async function rejectPayout(payoutId: string, reason?: string) {
  return apiFetch(`/payouts/${payoutId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export interface OAuthProviderInfo {
  id: string;
  displayName: string;
  /** True only when the backend can actually complete this provider's flow. */
  available: boolean;
  unavailableReason: string | null;
  requiresPkce: boolean;
}

/**
 * Provider availability, straight from the backend.
 *
 * A provider is shown as usable only when the backend reports it available. The
 * login UI must never present a provider as working on the strength of a hardcoded
 * list: Facebook and X have no credentials configured in this deployment, and
 * offering them anyway would be advertising a capability that does not exist.
 */
export async function getOAuthProviders(): Promise<OAuthProviderInfo[]> {
  try {
    const data = await apiFetch('/auth/oauth/providers');
    const list = Array.isArray(data) ? data : (Array.isArray(data?.providers) ? data.providers : []);
    return list
      .filter((p: any) => p && typeof p.id === 'string')
      .map((p: any) => ({
        id: p.id,
        displayName: p.displayName || p.id,
        available: p.available === true || p.configured === true,
        unavailableReason: p.unavailableReason ?? (p.configured === true ? null : 'CLIENT_CREDENTIALS_NOT_CONFIGURED'),
        requiresPkce: p.requiresPkce === true,
      }));
  } catch {
    // Unreachable backend: report every provider unavailable rather than
    // guessing, so the UI never implies a working sign-in.
    return [];
  }
}

export async function getAnalyticsHistory(limit = 20, offset = 0) {
  try {
    const data = await apiFetch(`/analytics/history?limit=${limit}&offset=${offset}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getAnalyticsSummary() {
  try {
    return await apiFetch('/analytics/summary');
  } catch {
    return {
      summary: { totalTasks: 0, completed: 0, failed: 0, running: 0, successRate: 0, agents: 0 },
      agents: [],
      trends: [],
    };
  }
}

// ── Reward economy ───────────────────────────────────────────────────────────

export interface RewardBalance {
  simulated: boolean;
  currency: string;
  totalEarnedBnb: string;
  pendingRewardBnb: string;
  availableToWithdrawBnb: string;
  reservedBnb: string;
  settledBnb: string;
  fundingRatio: number;
  pool: { generatedBnb: string; fundedBnb: string };
  semanticsNote?: string;
}

export async function getRewardBalance(): Promise<RewardBalance> {
  return apiFetch('/api/rewards/balance');
}

export async function getRewardEvents() {
  const data = await apiFetch('/api/rewards/events');
  return data?.events || [];
}

export async function getRewardLedger() {
  const data = await apiFetch('/api/rewards/ledger');
  return data?.entries || [];
}

export async function getRewardPool() {
  try {
    return await apiFetch('/api/rewards/pool');
  } catch {
    return null;
  }
}

export interface AdminRewardOverview {
  pool: RewardBalance['pool'] & {
    settledBnb: string;
    reservedBnb: string;
    settleableCapacityBnb: string;
    unfundedBnb: string;
    fundingRatio: number;
    onChainTreasuryBalanceBnb: string | null;
    semanticsNote?: string;
  };
  invariant: {
    invariantHolds: boolean;
    mismatchUserIds: string[];
    pool: unknown;
    userRows: Array<{ userId: string; ledgerInvariantHolds: boolean }>;
  };
  fundingEvents: Array<{
    id: string;
    sourceType: string;
    amountBnb: string;
    status: string;
    simulated: boolean;
    reference: string | null;
    confirmedAt: string | null;
    createdAt: string;
  }>;
  settlements: Array<{
    id: string;
    payoutId: string;
    userId: string;
    amountBnb: string;
    status: string;
    reservedAt: string;
  }>;
  allowedSourceTypes: string[];
  demoMode: boolean;
}

export async function getAdminRewardOverview(): Promise<AdminRewardOverview> {
  return apiFetch('/api/admin/rewards/overview');
}

export async function fundRewardPool(input: {
  sourceType: string;
  amountBnb: string;
  reference?: string | null;
  note?: string | null;
  /**
   * Declares where the money comes from. EXTERNAL_REVENUE is rejected by the
   * backend for operator requests: only a verified external payment can create
   * that class.
   */
  fundingClass?: "OPERATOR_FUNDING" | "TEST_FUNDING";
}) {
  return apiFetch('/api/admin/rewards/fund', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function confirmRewardFunding(eventId: string) {
  return apiFetch(`/api/admin/rewards/fund/${eventId}/confirm`, { method: 'POST' });
}

// ── Compute-to-revenue (Phase 4) ─────────────────────────────────────────────

export interface ComputeService {
  id: string;
  slug: string;
  name: string;
  description: string;
  agent: string;
  category: string;
  unitPriceBnb: string;
  enabled: boolean;
}

export interface ComputeQuote {
  id: string;
  serviceId: string;
  slug: string;
  asset: string;
  amountWei: string;
  priceBnbWei: string;
  priceBnbPerUnit: string | null;
  platformFeeBnbWei: string;
  serviceCostBnbWei: string;
  nonce: string;
  payloadHash: string;
  expiresAt: string;
  status: string;
}

export interface PaymentIntent {
  id: string;
  quoteId: string;
  asset: string;
  amountWei: string;
  priceBnbPerUnit: string | null;
  status: string;
  verificationType: string;
  external: boolean;
  createdAt: string;
}

export interface ComputeJob {
  id: string;
  quoteId: string;
  serviceId: string;
  sellerUserId: string;
  inputText: string;
  agent: string;
  status: string;
  expectedPriceBnbWei: string;
  revenueEventId: string | null;
  economicValueBnb: string | null;
  failureReason: string | null;
  failureType: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  output?: { resultHash: string; sizeBytes: number; engine: string } | null;
}

export async function getComputeServices() {
  const data = await apiFetch('/api/compute/services');
  return { services: data?.services || [], demoMode: Boolean(data?.demoMode) };
}

export async function createComputeQuote(input: { serviceSlug: string; asset: string; requestText: string }) {
  return apiFetch('/api/compute/quote', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createComputeJob(quoteId: string) {
  return apiFetch('/api/compute/jobs', {
    method: 'POST',
    body: JSON.stringify({ quoteId }),
  });
}

export async function runComputeJob(jobId: string) {
  return apiFetch(`/api/compute/jobs/${jobId}/run`, { method: 'POST' });
}

export async function getComputeJobs() {
  const data = await apiFetch('/api/compute/jobs');
  return data?.jobs || [];
}

export async function getComputeJobOutput(jobId: string) {
  return apiFetch(`/api/compute/jobs/${jobId}/output`);
}

export async function getComputeJobDetail(jobId: string) {
  return apiFetch(`/api/compute/jobs/${jobId}`);
}

export async function getAdminComputeOverview() {
  return apiFetch('/api/admin/compute/overview');
}

export async function submitComputePayment(paymentId: string, input: { payerLabel?: string; txHash?: string }) {
  return apiFetch(`/api/admin/compute/payments/${paymentId}/submit`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyComputePayment(paymentId: string, attestation?: string) {
  return apiFetch(`/api/admin/compute/payments/${paymentId}/verify`, {
    method: 'POST',
    body: JSON.stringify({ attestation }),
  });
}

export async function refundComputePayment(paymentId: string, note?: string) {
  return apiFetch(`/api/admin/compute/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}
