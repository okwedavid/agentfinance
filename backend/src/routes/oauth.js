import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../prismaClient.js';
import {
  buildAuthorizationUrl,
  configuredProviders,
  exchangeCode,
  fetchOAuthUserInfo,
  getOAuthProvider,
  getRedirectUri,
} from '../services/oauthService.js';
import { defaultRole, serializeUser, validateEmail, validateUsername } from '../utils/security.js';
import logger from '../utils/logger.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

// Short-lived in-memory state store for the OAuth start -> callback handshake.
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function issueState(providerId) {
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(`${providerId}:${state}`, Date.now());
  return state;
}

function consumeState(providerId, state) {
  if (!state) return false;
  const key = `${providerId}:${state}`;
  const issuedAt = pendingStates.get(key);
  if (!issuedAt) return false;
  pendingStates.delete(key);
  return Date.now() - issuedAt < STATE_TTL_MS;
}

async function deriveUniqueUsername(base) {
  const cleaned = String(base || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20) || 'user';

  let candidate = cleaned;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await prisma.user.findUnique({ where: { username: candidate } });
    if (!existing) return candidate;
    candidate = `${cleaned.slice(0, 18)}_${crypto.randomBytes(2).toString('hex')}`;
  }
  throw new Error('Could not allocate a unique username.');
}

async function findOrCreateUserFromOAuth({ email, name }) {
  if (!email) throw new Error('This provider did not return an email address to link an account.');

  let user = await prisma.user.findUnique({ where: { email } });
  if (user) return user;

  const username = await deriveUniqueUsername(name || email.split('@')[0]);
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      role: defaultRole(),
      displayName: name || username,
    },
  });
  return user;
}

function handleProviderError(res, error) {
  const message = error.message || 'OAuth login failed.';
  const unavailable = /not configured|Unknown OAuth provider/i.test(message);
  logger.warn(`oauth: ${message}`);
  return res.status(unavailable ? 400 : 500).json({ error: message });
}

// Public metadata used by the login UI. Returns only configured flags - never
// secrets.
router.get('/providers', (_req, res) => {
  res.json({ providers: configuredProviders() });
});

// GET /auth/oauth/:provider/start -> redirect to the provider login, or a
// clear error when the provider is not configured.
router.get('/:provider/start', (req, res) => {
  try {
    const provider = getOAuthProvider(req.params.provider);
    const state = issueState(provider?.id || req.params.provider);
    const { url } = buildAuthorizationUrl(provider.id, state);
    res.redirect(url);
  } catch (error) {
    handleProviderError(res, error);
  }
});

// GET /auth/oauth/:provider/callback?code=...&state=...
router.get('/:provider/callback', async (req, res) => {
  try {
    const providerId = String(req.params.provider || '').toLowerCase();
    const provider = getOAuthProvider(providerId);
    if (!provider) return handleProviderError(res, new Error(`Unknown OAuth provider '${providerId}'.`));

    if (!consumeState(providerId, req.query.state)) {
      return res.status(400).json({ error: 'Invalid or expired OAuth state.' });
    }

    const redirectUri = getRedirectUri(provider);
    const accessToken = await exchangeCode(providerId, req.query.code, redirectUri);
    const profile = await fetchOAuthUserInfo(providerId, accessToken);
    const user = await findOrCreateUserFromOAuth({ email: profile.email, name: profile.name });

    const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, cookieOptions());

    res.json({
      ...serializeUser(user, { isNewUser: false }),
      token,
    });
  } catch (error) {
    handleProviderError(res, error);
  }
});

export default router;