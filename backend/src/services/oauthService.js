// oauthService.js — OAuth provider configuration + helper flow.
//
// PROVIDER AVAILABILITY IS CONFIGURATION, NOT INTENTION
// A provider is ACTIVE only when BOTH <PROVIDER>_CLIENT_ID and
// <PROVIDER>_CLIENT_SECRET exist. There is no simulation path, no stub, and no
// fallback identity: an unconfigured provider reports itself unavailable and the
// login UI disables it. The platform does not advertise a capability it does not
// have.
//
// SESSION COMPLETION
// The callback establishes the SAME session as a password login: an AuthSession
// row plus a signed JWT, delivered as an HttpOnly cookie. The token is never
// placed in a URL, so it cannot leak through history, referrers, or logs.

import crypto from 'crypto';

const PROVIDERS = {
  google: {
    id: 'google',
    displayName: 'Google',
    scope: 'openid email profile',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    pkce: true,
  },
  facebook: {
    id: 'facebook',
    displayName: 'Facebook',
    // public_profile is required by Facebook Login; email additionally needs the
    // email permission granted on the app dashboard.
    scope: 'email public_profile',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/v21.0/me',
    userInfoFields: 'id,name,email',
    clientIdEnv: 'FACEBOOK_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_CLIENT_SECRET',
    pkce: false,
  },
  x: {
    id: 'x',
    displayName: 'X',
    // users.read is the minimum for identity. `email` is deliberately NOT
    // requested: X only returns an email to apps with Elevated access, so
    // asking for it would fail for most apps without adding anything. Identity
    // comes from the immutable numeric user id instead.
    scope: 'users.read tweet.read',
    authUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    userInfoUrl: 'https://api.x.com/2/users/me',
    userInfoFields: 'id,name,username,profile_image_url',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    // X requires PKCE for confidential clients using a client secret.
    pkce: true,
  },
};

export function getOAuthProvider(providerId) {
  return PROVIDERS[String(providerId || '').toLowerCase()] || null;
}

export function isProviderConfigured(provider) {
  if (!provider) return false;
  return Boolean(
    obj(process.env[provider.clientIdEnv])
    && obj(process.env[provider.clientSecretEnv]),
  );
}

function obj(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function configuredProviders() {
  return Object.values(PROVIDERS).map((provider) => {
    let redirectUri = null;
    try {
      redirectUri = getRedirectUri(provider);
    } catch {
      redirectUri = null;
    }
    const credentialsPresent = isProviderConfigured(provider);
    // A redirect URI that resolves but points at the wrong origin is exactly the
    // production misconfiguration, so it must read as UNAVAILABLE here too — not
    // merely at boot.
    const uriProblem = redirectUri ? validateRedirectUriForBackend(provider, redirectUri) : null;
    const usable = credentialsPresent && Boolean(redirectUri) && !uriProblem;
    return {
      id: provider.id,
      displayName: provider.displayName,
      // ACTIVE only when credentials AND a backend-owned redirect URI are both
      // present. An earlier build advertised ACTIVE whenever the client id
      // existed, so a provider with a broken redirect URI looked working and
      // failed at the click.
      configured: usable,
      // Why it is unavailable, for an honest UI. Never includes any secret.
      unavailableReason: !credentialsPresent
        ? 'CLIENT_CREDENTIALS_NOT_CONFIGURED'
        : !redirectUri
          ? 'REDIRECT_URI_NOT_CONFIGURED'
          : uriProblem || null,
      requiresPkce: provider.pkce === true,
      redirectUri,
    };
  });
}

/**
 * The backend's own public origin, normalized with no trailing slash.
 *
 * This is the origin an OAuth callback MUST live on: the callback needs the
 * client secret to redeem the code, so it cannot be hosted on the frontend.
 */
export function getBackendOrigin() {
  return obj(process.env.PUBLIC_BACKEND_URL);
}

/**
 * Resolve the redirect URI for a provider.
 *
 * 1. <PROVIDER>_REDIRECT_URI (e.g. GOOGLE_REDIRECT_URI)
 * 2. OAUTH_REDIRECT_URI
 * 3. Derived: PUBLIC_BACKEND_URL + /auth/oauth/<provider>/callback
 *
 * The SAME value is used for the authorization request and the token exchange,
 * which is what Google requires (exact redirect_uri match).
 */
export function getRedirectUri(provider) {
  const explicit = obj(process.env[`${provider.id.toUpperCase()}_REDIRECT_URI`])
    || obj(process.env.OAUTH_REDIRECT_URI);
  if (explicit) return explicit;

  const backendUrl = getBackendOrigin();
  if (!backendUrl) {
    throw new Error(
      `OAuth redirect URI is not configured. Set ${provider.id.toUpperCase()}_REDIRECT_URI (or OAUTH_REDIRECT_URI / PUBLIC_BACKEND_URL).`,
    );
  }
  return defaultCallbackUrl(provider, backendUrl);
}

export function defaultCallbackUrl(provider, backendUrl = getBackendOrigin()) {
  return `${String(backendUrl).replace(/\/+$/, '')}/auth/oauth/${provider.id}/callback`;
}

/**
 * Verify that a configured redirect URI actually points at THIS backend.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * Production was configured with the frontend origin
 * (https://agentfinance.onrender.com/dashboard) as the OAuth redirect URI.
 * Google authenticated the user successfully and then delivered the
 * authorization code to the frontend, which has no callback handler and no
 * client secret. The code was dropped, no session was ever created, and the app
 * bounced the user straight back to /login — a login that looked successful and
 * was not.
 *
 * The old assertion only checked that a redirect URI RESOLVED, never that it
 * belonged to the backend, so this misconfiguration shipped silently. This
 * check compares the URI's origin against the backend origin and fails loudly.
 */
export function validateRedirectUriForBackend(provider, redirectUri) {
  const backendOrigin = getBackendOrigin();

  if (!backendUriIsHttp(redirectUri)) {
    return 'REDIRECT_URI_MALFORMED';
  }

  // Without PUBLIC_BACKEND_URL there is nothing authoritative to compare
  // against, so the explicit per-provider setting is trusted.
  if (!backendOrigin) return null;

  let configured;
  let expected;
  try {
    configured = new URL(redirectUri);
    expected = new URL(backendOrigin);
  } catch {
    return 'REDIRECT_URI_MALFORMED';
  }

  if (configured.origin !== expected.origin) return 'REDIRECT_URI_WRONG_ORIGIN';
  return null;
}

function backendUriIsHttp(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Startup validation.
 *
 * A provider that is enabled but misconfigured now ABORTS the boot in
 * production instead of starting and failing every login. Warnings only outside
 * production so local development is not blocked by an unset variable.
 */
export function assertOAuthConfiguration() {
  const failures = [];
  const warnings = [];
  const isProduction = process.env.NODE_ENV === 'production';

  for (const provider of Object.values(PROVIDERS)) {
    if (!isProviderConfigured(provider)) {
      warnings.push(`OAuth ${provider.id}: UNAVAILABLE (${provider.clientIdEnv}/${provider.clientSecretEnv} not set)`);
      continue;
    }

    let redirectUri;
    try {
      redirectUri = getRedirectUri(provider);
    } catch {
      failures.push(
        `OAuth ${provider.id}: enabled but ${provider.id.toUpperCase()}_REDIRECT_URI / OAUTH_REDIRECT_URI / PUBLIC_BACKEND_URL is missing. `
        + `Expected: ${defaultCallbackUrl(provider)}`,
      );
      continue;
    }

    const problem = validateRedirectUriForBackend(provider, redirectUri);
    if (problem) {
      const detail = {
        REDIRECT_URI_WRONG_ORIGIN:
          `points at ${safeOrigin(redirectUri)} but the backend origin is ${safeOrigin(getBackendOrigin())}. `
          + 'The frontend URL must NEVER be the OAuth callback: the callback redeems the authorization '
          + 'code and needs the client secret, which only the backend has.',
        REDIRECT_URI_MALFORMED: 'is not a valid http(s) URL.',
        REDIRECT_URI_NOT_CONFIGURED: 'is not configured.',
      }[problem];
      failures.push(
        `OAuth ${provider.id}: redirect URI ${safeOrigin(redirectUri)} ${detail} `
        + `Set ${provider.id.toUpperCase()}_REDIRECT_URI to ${defaultCallbackUrl(provider)}`,
      );
      continue;
    }

    // The path must be the real callback route, not just any path on this origin.
    const expectedPath = new URL(defaultCallbackUrl(provider, getBackendOrigin() || redirectUri)).pathname;
    if (new URL(redirectUri).pathname !== expectedPath) {
      warnings.push(
        `OAuth ${provider.id}: redirect URI path is ${new URL(redirectUri).pathname} but the callback route is ${expectedPath}.`,
      );
    }

    loggerSafe(`OAuth ${provider.id}: ACTIVE callback=${redirectUri}`);
  }

  for (const warning of warnings) loggerSafe(warning);

  if (failures.length > 0) {
    // Never print the client secret; only origins and variable names appear here.
    console.error(`[OAuth] Invalid configuration:\n${failures.join('\n')}`);
    return false;
  }
  return true;
}

function safeOrigin(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return '(unparseable)';
  }
}

function loggerSafe(message) {
  // eslint-disable-next-line no-console
  console.log(`[OAuth] ${message}`);
}

/**
 * Build the provider authorization URL.
 *
 * PKCE (S256) is used for providers that support it. The verifier must survive
 * until the callback, so it is carried alongside the state rather than kept in
 * process memory — the callback can land on another instance.
 */
export function buildAuthorizationUrl(providerId, state, { codeChallenge = null } = {}) {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider '${providerId}'.`);
  if (!isProviderConfigured(provider)) {
    throw new Error(`${provider.displayName} login is not configured.`);
  }

  const redirectUri = getRedirectUri(provider);
  const params = new URLSearchParams({
    client_id: process.env[provider.clientIdEnv].trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scope,
    state,
  });

  if (provider.pkce && codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return { url: `${provider.authUrl}?${params.toString()}`, redirectUri };
}

export async function exchangeCode(providerId, code, redirectUri, { codeVerifier = null } = {}) {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider '${providerId}'.`);
  if (!isProviderConfigured(provider)) {
    throw new Error(`${provider.displayName} login is not configured.`);
  }
  if (!code) throw new Error('OAuth callback did not include an authorization code.');

  const form = new URLSearchParams({
    client_id: process.env[provider.clientIdEnv].trim(),
    client_secret: process.env[provider.clientSecretEnv].trim(),
    code: String(code),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  // Public clients (no secret) rely on PKCE instead of a client secret.
  if (codeVerifier) form.set('code_verifier', codeVerifier);

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    // The status only. The provider's response body can echo the client secret
    // or the code back, so it is never logged or surfaced.
    throw new Error(`OAuth token exchange failed (${response.status}).`);
  }
  return data.access_token;
}

export function fetchOAuthUserInfo(providerId, accessToken) {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider '${providerId}'.`);

  if (provider.id === 'x') {
    const params = new URLSearchParams();
    if (provider.userInfoFields) params.set('user.fields', provider.userInfoFields);
    return fetch(`${provider.userInfoUrl}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`OAuth profile lookup failed (${response.status}).`);
      }
      const profile = data.data || {};
      return {
        providerId: provider.id,
        providerSubject: profile.id || null,
        email: normalizeEmail(profile.email),
        // X only returns a verified email to apps with Elevated access, so an
        // email here is never assumed verified.
        emailVerified: false,
        name: (profile.name || profile.username || '').trim() || null,
        avatar: profile.profile_image_url || null,
      };
    });
  }

  let url = provider.userInfoUrl;
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (provider.id === 'facebook') {
    const params = new URLSearchParams({
      fields: provider.userInfoFields || 'id,name,email',
      access_token: accessToken,
    });
    url = `${provider.userInfoUrl}?${params.toString()}`;
  }

  return fetch(url, { headers }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`OAuth profile lookup failed (${response.status}).`);
    }
    return {
      providerId: provider.id,
      providerSubject: data.id || data.sub || null,
      email: normalizeEmail(data.email),
      emailVerified: providerEmailVerified(provider.id, data),
      name: (data.name || data.username || '').trim() || null,
      avatar: data.picture || data.avatar_url || null,
    };
  });
}

/**
 * Whether the PROVIDER asserts the email is verified.
 *
 * Google and Facebook both return an `email_verified` flag on the userinfo
 * response. Anything else is treated as unverified, and an unverified email is
 * never used to claim an existing account.
 */
function providerEmailVerified(providerId, data) {
  if (providerId === 'google') return data.email_verified === true;
  if (providerId === 'facebook') return data.email_verified === true;
  return false;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

/**
 * The allowlisted frontend origin that completes the OAuth flow.
 *
 * Used for the post-callback redirect ONLY. The frontend receives no token: the
 * session cookie is already set by this backend, so the redirect carries no
 * credential at all.
 */
export function resolveOauthSuccessUrl() {
  const value = obj(process.env.OAUTH_SUCCESS_URL) || obj(process.env.FRONTEND_URL);
  if (!value) {
    throw new Error(
      'OAuth login cannot complete: set OAUTH_SUCCESS_URL (or FRONTEND_URL) to the frontend origin (e.g. https://agentfinance.onrender.com).',
    );
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('OAUTH_SUCCESS_URL must be a valid http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OAUTH_SUCCESS_URL must be a valid http(s) URL.');
  }
  return value.replace(/\/+$/, '');
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

/** Create a PKCE verifier/challenge pair (RFC 7636, S256). */
export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Derive the PKCE challenge from a verifier.
 *
 * The callback recomputes this instead of trusting a stored challenge, so a
 * tampered `state` cannot select the challenge it will be judged against.
 */
export function pkceChallengeFromVerifier(verifier) {
  return crypto.createHash('sha256').update(String(verifier || '')).digest('base64url');
}
