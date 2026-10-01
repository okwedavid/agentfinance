// oauth.js — OAuth start/callback for Google, Facebook and X.
//
// THE BUG THIS ROUTER HAD
// The callback route lives on the BACKEND, because redeeming an authorization
// code requires the client secret. Production was configured with the FRONTEND
// origin as the OAuth redirect URI, so:
//
//   /auth/oauth/google/start -> Google -> https://agentfinance.onrender.com/dashboard?code=...
//
// Google authenticated the user perfectly. The code then arrived at a frontend
// route with no callback handler and no secret, was discarded, no session was
// ever created, and the dashboard redirected straight back to /login. To the
// user that looked like "Google login worked, then logged me out".
//
// The router now:
//   - serves the callback itself, on the backend,
//   - establishes the SAME session as a password login (HttpOnly cookie),
//   - never places a token in a URL,
//   - redirects only to an allowlisted frontend origin,
//   - validates state and PKCE before touching any user data.

// No authorization code, access token, or client secret is ever logged. Only
// error messages and provider names are recorded.

import express from 'express';
import crypto from 'crypto';
import prisma from '../prismaClient.js';
import {
  buildAuthorizationUrl,
  configuredProviders,
  createPkcePair,
  exchangeCode,
  fetchOAuthUserInfo,
  getOAuthProvider,
  getRedirectUri,
  isProviderConfigured,
  pkceChallengeFromVerifier,
  resolveOauthSuccessUrl,
  validateRedirectUriForBackend,
} from '../services/oauthService.js';
import { issueOAuthState, consumeOAuthState, readPkceVerifier } from '../services/oauthStateStore.js';
import { resolveUserForProviderProfile, AccountLinkError } from '../services/accountLinking.js';
import { createSessionForUser, signSessionToken } from '../middleware/auth.js';
import { setSessionCookie, clearSessionCookieHeader } from '../services/sessionCookie.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * An allowlisted set of frontend destinations the callback may redirect to.
 *
 * The browser never chooses this: a `?redirect=` parameter from the client is
 * ignored entirely, so an attacker cannot use the OAuth callback as an open
 * redirect to bounce a freshly-authenticated user (and their referrer) to a site
 * they control.
 */
function frontendOrigins() {
  const values = [process.env.OAUTH_SUCCESS_URL, process.env.FRONTEND_URL, process.env.FRONTEND_URLS]
    .filter((v) => typeof v === 'string' && v.trim())
    .flatMap((v) => v.split(','))
    .map((v) => {
      try {
        return new URL(v.trim()).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return [...new Set(values)];
}

/**
 * Resolve the post-login destination, restricted to the allowlist.
 *
 * Falls back to the configured OAUTH_SUCCESS_URL. Returns null only when no
 * frontend origin is configured at all, in which case the callback renders a
 * "signed in, close this window" page instead of guessing a destination.
 */
export function resolvePostLoginRedirect() {
  const origins = frontendOrigins();
  const configured = resolveOauthSuccessUrlSafe();
  if (configured) return configured;
  return origins[0] || null;
}

function resolveOauthSuccessUrlSafe() {
  try {
    return resolveOauthSuccessUrl();
  } catch {
    return null;
  }
}

function handleProviderError(res, error) {
  const message = error?.message || 'OAuth login failed.';
  const status = Number(error?.status) || 500;
  const unavailable = /not configured|Unknown OAuth provider|REDIRECT_URI|OAUTH_SUCCESS_URL/i.test(message);

  // Log the message only. Never the code, token, or secret.
  if (status >= 500) logger.error('[oauth] provider error', message);
  else logger.warn(`oauth: ${message}`);

  const redirectTarget = resolvePostLoginRedirect();

  // Surface the failure on the frontend as a fragment so the user can retry in
  // place. Only a curated message travels; provider response bodies (which can
  // echo the code or secret) are never forwarded.
  if (redirectTarget) {
    const safe = unavailable
      ? `${error?.code || 'PROVIDER_UNAVAILABLE'}: ${publicMessage(error)}`
      : publicMessage(error);
    return res.redirect(`${redirectTarget}/login#oauth_error=${encodeURIComponent(safe)}`);
  }
  return res.status(unavailable ? 400 : 500).json({ error: publicMessage(error), code: error?.code || 'oauth_failed' });
}

function publicMessage(error) {
  const message = String(error?.message || 'OAuth login failed.');
  if (/not configured|Unknown OAuth provider|REDIRECT_URI|OAUTH_SUCCESS_URL/i.test(message)) return message;
  if (error?.code === 'provider_identity_already_linked') return message;
  if (error?.code === 'linked_user_missing') return message;
  if (error?.code === 'provider_identity_missing') return message;
  if (/Invalid or expired OAuth state/.test(message)) return message;
  // Anything unexpected is reported generically so an internal detail cannot
  // leak through the redirect.
  return 'Sign-in could not be completed. Please try again.';
}

// ── Provider availability ─────────────────────────────────────────────────────

/**
 * GET /auth/oauth/providers — public metadata for the login UI.
 *
 * Returns only whether each provider is genuinely usable. A provider missing
 * credentials, or carrying a redirect URI that does not point at this backend,
// is reported UNAVAILABLE with a reason. The UI must not present a provider as
 * working when it would fail at the click.
 */
router.get('/providers', (_req, res) => {
  const providers = configuredProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    available: provider.configured === true,
    unavailableReason: provider.unavailableReason,
    requiresPkce: provider.requiresPkce === true,
  }));
  res.json({ providers });
});

// ── Start ─────────────────────────────────────────────────────────────────────

/**
 * GET /auth/oauth/:provider/start
 *
 * Issues a signed, single-use, expiring `state` and redirects to the provider.
 * A `returnTo` from the client is never accepted: the only valid destination
 * after the callback is the allowlisted dashboard.
 */
router.get('/:provider/start', async (req, res) => {
  const provider = getOAuthProvider(req.params.provider);
  if (!provider) return handleProviderError(res, new Error(`Unknown OAuth provider '${req.params.provider}'.`));

  try {
    if (!isProviderConfigured(provider)) {
      return handleProviderError(res, new Error(`${provider.displayName} login is not configured.`));
    }

    // Refuse to start a handshake that cannot complete. Without this the user
    // would authenticate with Google only to be dumped on a page that ignores
    // the code.
    const redirectUri = getRedirectUri(provider);
    const problem = validateRedirectUriForBackend(provider, redirectUri);
    if (problem) {
      logger.error(`[oauth] ${provider.id} cannot start: ${problem}`);
      return handleProviderError(res, Object.assign(
        new Error(`${provider.displayName} sign-in is misconfigured on the server and cannot be started.`),
        { code: problem },
      ));
    }

    const { challenge, verifier } = createPkcePair();
    const state = await issueOAuthState(provider.id, { codeVerifier: provider.pkce ? verifier : null });
    const { url } = buildAuthorizationUrl(provider.id, state, { codeChallenge: challenge });
    return res.redirect(url);
  } catch (error) {
    return handleProviderError(res, error);
  }
});

// ── Callback ──────────────────────────────────────────────────────────────────

/**
 * GET /auth/oauth/:provider/callback?code=...&state=...
 *
 * Runs on the BACKEND. Establishes a normal AgentFinance session and redirects
 * to the frontend with no credential in the URL.
 */
router.get('/:provider/callback', async (req, res) => {
  try {
    const providerId = String(req.params.provider || '').toLowerCase();
    const provider = getOAuthProvider(providerId);
    if (!provider) return handleProviderError(res, new Error(`Unknown OAuth provider '${providerId}'.`));

    // The provider may report a user-declined consent screen via query params.
    if (req.query.error) {
      return handleProviderError(res, Object.assign(
        new Error('Sign-in was cancelled or denied by the provider.'),
        { code: 'provider_denied' },
      ));
    }

    // 1) State: signed, single-use, expiring, and bound to this provider.
    if (!await consumeOAuthState(providerId, req.query.state)) {
      return handleProviderError(res, new Error('Invalid or expired OAuth state. Please try again.'));
    }

    // 2) PKCE: recover the verifier from the signed state and re-derive the
    //    challenge. The server never trusts a stored/claimed challenge.
    let codeVerifier = null;
    if (provider.pkce) {
      codeVerifier = readPkceVerifier(req.query.state);
      if (!codeVerifier) {
        return handleProviderError(res, new Error('Invalid or expired OAuth state. Please try again.'));
      }
      // A verifier that cannot produce a valid challenge is a tampered state.
      if (!/^[A-Za-z0-9\-_]{43,128}$/.test(codeVerifier)) {
        return handleProviderError(res, new Error('Invalid or expired OAuth state. Please try again.'));
      }
      pkceChallengeFromVerifier(codeVerifier);
    }

    // 3) Redeem the code with the SAME redirect URI sent on the start hop.
    const redirectUri = getRedirectUri(provider);
    const accessToken = await exchangeCode(providerId, req.query.code, redirectUri, { codeVerifier });

    // 4) Identify. The access token is used here and never persisted.
    const profile = await fetchOAuthUserInfo(providerId, accessToken);

    // 5) Resolve to exactly one AgentFinance user, refusing unsafe links.
    const { user, created, linked } = await resolveUserForProviderProfile(profile);

    // 6) Establish the same session a password login would.
    const session = await createSessionForUser(user.id);
    const token = signSessionToken(user, session);
    setSessionCookie(res, token);

    // 7) Redirect to the allowlisted frontend with NO credential in the URL.
    const target = resolvePostLoginRedirect();
    if (!target) {
      // No frontend origin configured. The session is valid; tell the user
      // rather than redirecting somewhere unverified.
      return res.status(200).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Signed in</title>'
        + '<p>You are signed in. You can close this window and return to the app.</p>',
      );
    }

    const params = new URLSearchParams({ provider: providerId });
    if (created) params.set('account', 'created');
    else if (linked) params.set('account', 'linked');
    return res.redirect(`${target}/dashboard?${params.toString()}`);
  } catch (error) {
    if (error instanceof AccountLinkError) {
      return handleProviderError(res, Object.assign(new Error(error.message), {
        code: error.code,
        status: error.status,
      }));
    }
    return handleProviderError(res, error);
  }
});

export default router;
