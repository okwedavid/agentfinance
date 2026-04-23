export const API_URL = (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes('localhost'))
  ? process.env.NEXT_PUBLIC_API_URL
  : 'https://serene-magic-production-6d0c.up.railway.app';
export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL && !process.env.NEXT_PUBLIC_WS_URL.includes('localhost'))
  ? process.env.NEXT_PUBLIC_WS_URL
  : 'wss://serene-magic-production-6d0c.up.railway.app';
export const REPLAY_ENABLED = process.env.NEXT_PUBLIC_REPLAY_ENABLED === 'true' || false;
export const AGENTS = (process.env.NEXT_PUBLIC_AGENTS || 'alpha,beta,gamma').split(',').map(s => s.trim());
