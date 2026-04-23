const normalizeUrl = (value: string | undefined, fallback: string) => {
  const raw = (value || '').trim();
  if (!raw || raw.includes('localhost')) return fallback;
  return raw.replace(/\/$/, '');
};

export const API_BASE = normalizeUrl(
  process.env.NEXT_PUBLIC_API_URL,
  'https://serene-magic-production-6d0c.up.railway.app',
);

export const WS_BASE = normalizeUrl(
  process.env.NEXT_PUBLIC_WS_URL,
  'wss://serene-magic-production-6d0c.up.railway.app',
);

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem('token', token);
}

export function removeToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
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
    localStorage.removeItem('af_settings');
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
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
  const data = await apiFetch('/auth/me');
  if (typeof window !== 'undefined') {
    const displayName = localStorage.getItem('af_displayName');
    const bio = localStorage.getItem('af_bio');
    if (displayName) data.displayName = displayName;
    if (bio) data.bio = bio;
  }
  return data;
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

export async function deleteTask(id: string) {
  return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
}

export async function deleteAllTasks() {
  return apiFetch('/tasks/all', { method: 'DELETE' });
}

export async function getWalletBalance(address: string) {
  return apiFetch(`/wallet/balance?address=${encodeURIComponent(address)}`);
}

export async function saveWalletAddress(address: string | null) {
  return apiFetch('/auth/wallet', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: address }),
  });
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
