// Backward-compatible re-exports so existing consumers get the single source.
export { API_URL, WS_URL, requireApiUrl } from './config';

export const REPLAY_ENABLED = process.env.NEXT_PUBLIC_REPLAY_ENABLED === 'true' || false;
export const AGENTS = (process.env.NEXT_PUBLIC_AGENTS || 'alpha,beta,gamma').split(',').map(s => s.trim());