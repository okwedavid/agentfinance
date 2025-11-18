export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5000';
export const REPLAY_ENABLED = process.env.NEXT_PUBLIC_REPLAY_ENABLED === 'true' || false;
export const AGENTS = (process.env.NEXT_PUBLIC_AGENTS || 'alpha,beta,gamma').split(',').map(s => s.trim());
