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
  resolveOauthSuccessUrl,
} from '../services/oauthService.js';
import { createSessionForUser } from '../middleware/auth.js';
import { defaultRole } from '../utils/security.js';
import logger from '../utils/logger.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

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

function displayNameFor(name, username) {
  const cleaned = String(name || '').trim();
  if (cleaned.length > 1 && cleaned.length <= 80) return cleaned;
  if (cleaned.length > 80) return cleaned.slice(0, 80);
  return null;
}

async function findOrCreateUserFromOAuth({ providerId, providerSubject, email, name }) {
  if (!providerSubject && !email) {
    throw new Error('This provider did not return an identity to link an account.');
  }

  // 1) Stable per-provider identity.
  if (providerSubject) {
    const oauthId = `${providerId}:${providerSubject}`;
    const existing = await prisma.user.findUnique({ where: { oauthId } });
    if (existing) return existing;
  }

  // 2) Email link (providers that return email can connect to an account that
  //    already logged in with a different method).
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (providerSubject) {
        await prisma.user.update({ where: { id: existing.id }, data: { oauthId: `${providerId}:${providerSubject}` } }).catch(() => {});
      }
      return existing;
    }
    // Also adapt legacy accounts created with an email value in the email field.
  }

  // 3) Create a new account.
  const username = await deriveUniqueUsername(name || (email ? email.split('@')[0] : providerSubject || 'user'));
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const oauthId = providerSubject ? `${providerId}:${providerSubject}` : null;
  const displayName = displayNameFor(name, username);
  const user = await prisma.user.create({
    data: {
      username,
      email: email || null,
      oauthId,
      passwordHash,
      role: defaultRole(),
      ...(displayName ? { displayName } : {}),
    },
  });
  return user;
}

function handleProviderError(res, error) {
  const message = error.message || 'OAuth login failed.';
  const unavailable = /not configured|Unknown OAuth provider|OAUTH_SUCCESS_URL/i.test(message);
  const redirectTarget = resolveOauthSuccessUrlSafe();
  logger.warn(`oauth: ${message}`);

  // When a redirect target is configured, surface the error on the frontend via
  // a fragment (#error=...) instead of raw JSON, so the user can retry in place.
  if (redirectTarget && /Invalid or expired OAuth state/.test(message)) {
    return res.redirect(`${redirectTarget}/auth/callback#error=${encodeURIComponent(message)}`);
  }
  return res.status(unavailable ? 400 : 500).json({ error: message });
}

function resolveOauthSuccessUrlSafe() {
  try {
    return resolveOauthSuccessUrl();
  } catch {
    return null;
  }
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
      return handleProviderError(res, new Error('Invalid or expired OAuth state. Please try again.'));
    }

    const redirectUri = getRedirectUri(provider);
    const accessToken = await exchangeCode(providerId, req.query.code, redirectUri);
    const profile = await fetchOAuthUserInfo(providerId, accessToken);
    const user = await findOrCreateUserFromOAuth({
      providerId,
      providerSubject: profile.providerSubject,
      email: profile.email,
      name: profile.name,
    });

    const session = await createSessionForUser(user.id);
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role, sid: session.id },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    // Complete on the frontend: the token travels in the URL fragment, which is
    // never sent to any server and never written to server logs. The browser
    // //auth/callback page stores it and redirects to the dashboard.
    const base = resolveOauthSuccessUrl();
    return res.redirect(`${base}/auth/callback#access_token=${encodeURIComponent(token)}&provider=${encodeURIComponent(providerId)}`);
  } catch (error) {
    handleProviderError(res, error);
  }
});

export default router;