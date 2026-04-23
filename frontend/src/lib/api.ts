/**
 * api.ts — Central API client for AgentFinance
 *
 * ROOT CAUSE FIX: NEXT_PUBLIC_API_URL is set to "http://localhost:4000" in Railway.
 * Fix: go to Railway → Frontend service → Variables → change to:
 *   NEXT_PUBLIC_API_URL=https://serene-magic-production-6d0c.up.railway.app
 *   NEXT_PUBLIC_WS_URL=wss://serene-magic-production-6d0c.up.railway.app
 *
 * Until you do that, we hardcode the fallback here.
 */

// Always prefer the env var but fallback to the real backend URL
const RAW = process.env.NEXT_PUBLIC_API_URL || '';
// If it's localhost (Railway env bug) → use real backend
export const API_BASE =
  RAW && !RAW.includes('localhost')
    ? RAW.replace(/\/$/, '')
    : 'https://serene-magic-production-6d0c.up.railway.app';

export const WS_BASE = (() => {
  const raw = process.env.NEXT_PUBLIC_WS_URL || '';
  if (raw && !raw.includes('localhost')) return raw;
  return 'wss://serene-magic-production-6d0c.up.railway.app';
})();

// ---------- token helpers ----------
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}
export function setToken(t: string) {
  if (typeof window !== 'undefined') localStorage.setItem('token', t);
}
export function removeToken() {
  if (typeof window !== 'undefined') localStorage.removeItem('token');
}
export function isLoggedIn(): boolean {
  return !!getToken();
}
export function logout() {
  removeToken();
  if (typeof window !== 'undefined') {
    localStorage.removeItem('agentfi_wallet');
    localStorage.removeItem('af_displayName');
    localStorage.removeItem('af_bio');
  }
}

// ---------- base fetch ----------
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const token = getToken();
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });

  // Try parse JSON even on error so we can read error messages
  let data: any;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ---------- auth ----------
export async function login(username: string, password: string) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) setToken(data.token);
  return data;
}

export async function register(username: string, password: string, email?: string) {
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
  if (data.token) setToken(data.token);
  return data;
}

export async function getMe(): Promise<any> {
  const data = await apiFetch('/auth/me');
  // Also load local overrides
  if (typeof window !== 'undefined') {
    const dn = localStorage.getItem('af_displayName');
    const b = localStorage.getItem('af_bio');
    if (dn) data.displayName = dn;
    if (b) data.bio = b;
    const w = localStorage.getItem('agentfi_wallet');
    if (w) data.walletAddress = w;
  }
  return data;
}

// ---------- tasks ----------
export async function getTasks(): Promise<any[]> {
  const data = await apiFetch('/tasks');
  return Array.isArray(data) ? data : (data?.tasks || []);
}

export async function createTask(action: string, agentType?: string): Promise<any> {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({ action, agentType }),
  });
}

export async function deleteTask(id: string): Promise<any> {
  return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
}

export async function deleteAllTasks(): Promise<any> {
  // Try bulk delete endpoint, fallback to individual
  try {
    return await apiFetch('/tasks/all', { method: 'DELETE' });
  } catch {
    const tasks = await getTasks();
    await Promise.all(tasks.map(t => deleteTask(t.id).catch(() => {})));
    return { deleted: tasks.length };
  }
}

// ---------- wallet ----------
export async function getWalletBalance(address: string): Promise<any> {
  return apiFetch(`/wallet/balance?address=${address}`);
}

export async function saveWalletAddress(address: string): Promise<any> {
  // Try the backend endpoint, fallback to localStorage only
  try {
    return await apiFetch('/auth/wallet', {
      method: 'POST',
      body: JSON.stringify({ walletAddress: address }),
    });
  } catch {
    if (typeof window !== 'undefined') localStorage.setItem('agentfi_wallet', address);
    return { success: true, local: true };
  }
}
// ---------- analytics ----------
// Added limit and offset parameters to match your dashboard call
export async function getAnalyticsHistory(limit = 10, offset = 0): Promise<any[]> {
  try {
    const data = await apiFetch(`/analytics/history?limit=${limit}&offset=${offset}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return []; 
  }
}

export async function getAnalyticsSummary(): Promise<any> {
  try {
    return await apiFetch('/analytics/summary');
  } catch {
    return { totalTasks: 0, activeAgents: 0 }; 
  }
}
