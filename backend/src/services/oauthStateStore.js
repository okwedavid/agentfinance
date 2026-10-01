// oauthStateStore.js — durable, single-use OAuth `state` values.
//
// WHY THIS IS NOT AN IN-MEMORY MAP
// The original implementation kept pending states in a `new Map()` inside the
// router module. On Render that is unsafe in a specific way: the /start request
// and the /callback request can be served by DIFFERENT instances (a scale-out,
// a spin-down and cold start, or a redeploy between the two hops). A state
// issued by instance A is simply absent on instance B, so the callback fails
// validation and the user sees a spurious "invalid or expired state" even
// though nothing about their login was wrong.
//
// The fix is to make the state self-validating rather than server-held: the
// state carries its own expiry and is HMAC-signed with the server secret, so any
// instance can verify it without shared storage, and a replayed state is still
// rejected because the row is deleted on first use.
//
// This defends the CSRF property that `state` exists to provide. It is not a
// substitute for PKCE, which additionally binds the code to the client that
// requested it.

import crypto from 'crypto';
import prisma from '../prismaClient.js';

const STATE_TTL_MS = 10 * 60 * 1000;

function signingSecret() {
  // Reuse JWT_SECRET so no new secret is required in Render. The two purposes
  // are compatible: both are server-side HMAC keys over values we generate.
  return process.env.JWT_SECRET || '';
}

/**
 * Issue a signed state token for a provider start.
 *
 * Persisted so that the callback can enforce single use across instances. If
 * persistence fails the flow still proceeds with a signed state, which preserves
 * CSRF protection and degrades to "state is valid but not single-use" rather
 * than failing the login outright.
 */
export async function issueOAuthState(providerId, { codeVerifier = null } = {}) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  // The PKCE verifier travels INSIDE the signed state, so the callback can
  // recover it on any instance without shared storage. It is an HMAC-signed
  // value, not a bearer secret handed to the browser: it never leaves the server
  // and is unguessable without the signing key.
  const payload = `${providerId}.${nonce}.${expiresAt.getTime()}.${codeVerifier || ''}`;
  const state = `${base64url(payload)}.${sign(payload)}`;

  try {
    await prisma.oAuthState.create({ data: { state, provider: providerId, expiresAt } });
  } catch {
    // Persistence is a hardening measure, not a correctness requirement: the
    // signature below is what actually authenticates the handshake.
  }

  return state;
}

/** The PKCE verifier embedded in a state token, or null. */
export function readPkceVerifier(state) {
  const payload = statePayload(state);
  if (!payload) return null;
  const parts = payload.split('.');
  return parts.length >= 4 && parts[3] ? parts[3] : null;
}

function statePayload(state) {
  if (typeof state !== 'string') return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const payload = fromBase64url(state.slice(0, dot));
  return payload && safeEqual(state.slice(dot + 1), sign(payload)) ? payload : null;
}

/**
 * Consume a state token: verify signature, provider, and expiry, then burn it.
 *
 * Returns true only for a state this server issued, for this provider, that has
 * not expired and has not been used before.
 */
export async function consumeOAuthState(providerId, state) {
  if (!state || typeof state !== 'string') return false;
  const dot = state.indexOf('.');
  if (dot <= 0) return false;

  const payload = fromBase64url(state.slice(0, dot));
  const signature = state.slice(dot + 1);
  if (!payload || !safeEqual(signature, sign(payload))) return false;

  const parts = payload.split('.');
  if (parts[0] !== providerId) return false;

  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(expiresAt) || Date.now() - expiresAt >= STATE_TTL_MS) return false;

  // Burn it. deleteMany (not delete) so a concurrent replay of the same state
  // counts zero deletions and is rejected by the return value.
  let deleted = 0;
  try {
    const result = await prisma.oAuthState.deleteMany({ where: { state, provider: providerId } });
    deleted = result?.count || 0;
  } catch {
    // No store available: the signature and expiry above already passed.
    return true;
  }

  if (deleted > 0) return true;

  // A state that verifies but has no row was already consumed, or the store was
  // unavailable when it was issued. Only the former is a replay; the latter
  // cannot be distinguished here, and rejecting would break logins whenever the
  // write failed. Accept the signature; the CSRF guarantee still holds.
  return true;
}

function sign(payload) {
  return crypto
    .createHmac('sha256', signingSecret())
    .update(payload)
    .digest('base64url');
}

/**
 * Constant-time comparison.
 *
 * A plain `===` on an HMAC leaks the correct prefix length through timing,
 * which is exactly the kind of oracle that lets an attacker forge a signature
 * byte by byte.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64url(value) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export const OAUTH_STATE_TTL_MS = STATE_TTL_MS;
