/**
 * api.ts — single source of truth for all backend communication
 *
 * The frontend (agentfinance-production.up.railway.app) and backend
 * (serene-magic-production-6d0c.up.railway.app) are on different domains.
 * Every fetch must:
 *   1. Go to the correct backend URL
 *   2. Include the JWT token from localStorage
 *   3. Handle errors consistently
 */

const BACKEND = (
  process.env.NEXT_PUBLIC_API_URL ||
  'https://serene-magic-production-6d0c.up.railway.app'
).replace(/\/$/, '');

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `${BACKEND}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> || {}),
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username }));
  }
  return data;
}

export async function register(username: string, password: string) {
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username }));
  }
  return data;
}

export async function getMe() {
  return apiFetch('/auth/me');
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('agentfi_wallet');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function createTask(action: string, agentId?: string) {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({ action, agentId }),
  });
}

export async function getTasks() {
  return apiFetch('/tasks');
}

export async function getTask(id: string) {
  return apiFetch(`/tasks/${id}`);
}

export async function patchTask(id: string, patch: Record<string, any>) {
  return apiFetch(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary() {
  return apiFetch('/analytics/summary');
}

export async function getAnalyticsHistory(limit = 100, skip = 0) {
  return apiFetch(`/analytics/history?limit=${limit}&skip=${skip}`);
}

// ── Wallet ────────────────────────────────────────────────────────────────────

export async function saveWallet(walletAddress: string) {
  return apiFetch('/auth/wallet', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
}

export const API_BASE = BACKEND;