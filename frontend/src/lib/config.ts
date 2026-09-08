// Single authoritative source for the backend API endpoint used by the browser.
//
// NEXT_PUBLIC_* variables are inlined into the client bundle at BUILD TIME by
// Next.js. There is deliberately NO hardcoded/obsolete fallback here: if the
// build does not provide NEXT_PUBLIC_API_URL, the client fails loudly instead of
// silently routing traffic to a dead/obsolete backend.
//
// - development (next dev): defaults to http://localhost:4000 for convenience.
// - production (next build/start): MUST be configured or the build fails in
//   next.config.mjs and the client throws a clear error.

function isLocalCandidate(value: string): boolean {
  return /localhost|127\.0\.0\.1/.test(value);
}

function resolveApiUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (raw && !isLocalCandidate(raw)) return raw;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:4000';
  return '';
}

export const API_URL = resolveApiUrl();

// WebSocket endpoint is derived from the API endpoint so there is a single
// source of truth. The backend serves HTTP and WebSocket on the same process
// (Express + ws on one port), so https://host -> wss://host is correct.
export const WS_URL = API_URL ? API_URL.replace(/^http/, 'ws') : '';

export function requireApiUrl(context: string): string {
  if (!API_URL) {
    throw new Error(
      `[config] NEXT_PUBLIC_API_URL is not configured and is required to ${context}. ` +
        'Set NEXT_PUBLIC_API_URL to the production backend origin (e.g. https://<backend>.onrender.com) in Render and rebuild.'
    );
  }
  return API_URL;
}