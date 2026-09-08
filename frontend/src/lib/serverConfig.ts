// Server-only resolver for the backend origin.
//
// Server route handlers ('use server' / route.ts) run on the Node server where
// regular (non NEXT_PUBLIC_) env vars are read from the runtime environment.
// We prefer a runtime var (API_URL) so operators can change the backend without
// rebuilding, then fall back to the build-time NEXT_PUBLIC value, then a local
// dev default. No hardcoded/obsolete production fallback is used.

function isLocalCandidate(value: string): boolean {
  return /localhost|127\.0\.0\.1/.test(value);
}

export async function resolveBackendUrl(): Promise<string> {
  const raw = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (raw && !isLocalCandidate(raw)) return raw;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:4000';
  return '';
}