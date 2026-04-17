const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

export const API_BASE = API_URL;

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchMe() {
  const res = await fetch(`${API_URL}/auth/me`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Not authenticated');
  return res.json();
}

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${API_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      ...getAuthHeaders(),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

export async function fetchAnalyticsHistory(limit = 100, skip = 0) {
  return apiFetch(`/analytics/history?limit=${limit}&skip=${skip}`);
}
export async function fetchAnalyticsSummary() {
  return apiFetch('/analytics/summary');
}
export async function clearAnalytics() {
  return apiFetch('/analytics/clear', { method: 'DELETE' });
}