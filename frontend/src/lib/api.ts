// Centralized API utility
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';

export async function fetchMe() {
  const res = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}

export async function fetchMetrics() {
  const res = await fetch(`${API_URL}/metrics`);
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}
// Centralized API utility for consistent backend calls
export const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';

export async function apiFetch(path: string, options?: RequestInit) {
  const url = `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// --- Analytics API ---
export async function fetchAnalyticsHistory(limit = 100, skip = 0) {
  return apiFetch(`/analytics/history?limit=${limit}&skip=${skip}`);
}

export async function fetchAnalyticsSummary() {
  return apiFetch('/analytics/summary');
}

export async function clearAnalytics() {
  return apiFetch('/analytics/clear', { method: 'DELETE' });
}