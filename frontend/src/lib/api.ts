import { API_URL, WS_URL } from './config';

export const API_BASE = API_URL;
export const WS_BASE = WS_URL;

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem('token');
}

export function setToken(token: string) {
  if (typeof window !== 'undefined') window.sessionStorage.setItem('token', token);
}

export function removeToken() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem('token');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout() {
  removeToken();
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('agentfi_wallet');
    window.sessionStorage.removeItem('af_settings');
    localStorage.removeItem('agentfi_wallet');
    localStorage.removeItem('af_settings');
  }
}

// Server-side logout: revokes the current session so the token cannot be reused
// even if it is ever exposed.
export async function logoutSession() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore network errors; local token removal still signs the user out of
    // this tab.
  } finally {
    logout();
  }
}

export async function deleteAccount() {
  return apiFetch('/auth/me', { method: 'DELETE' });
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

export async function apiFetch(path: string, options: RequestInit = {}) {
  if (!API_BASE) {
    throw new Error(
      'Backend endpoint is not configured. Set NEXT_PUBLIC_API_URL to the backend origin in Render and rebuild.',
    );
  }
  const token = getToken();
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: options.credentials || 'include',
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
    throw new Error(message);
  }

  return data;
}

export async function login(username: string, password: string) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data?.token) setToken(data.token);
  return data;
}

export async function register(username: string, password: string, email?: string) {
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
  if (data?.token) setToken(data.token);
  return data;
}

export async function getMe() {
  return apiFetch('/auth/me');
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

export async function getOAuthProviders() {
  try {
    const data = await apiFetch('/auth/oauth/providers');
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.providers)) return data.providers;
    return [];
  } catch {
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
