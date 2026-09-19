// OAuth provider configuration + helper flow.
//
// PHASE 0 NOTE:
// No provider credentials are hardcoded and no fake OAuth is performed here.
// A provider is only "configured" when BOTH <PROVIDER>_CLIENT_ID and
// <PROVIDER>_CLIENT_SECRET exist in the server environment. Unconfigured
// providers fail gracefully (the login UI hides them and the API returns a
// clear "not configured" error). The normal username+password login is never
// affected by these settings.

const PROVIDERS = {
  google: {
    id: 'google',
    displayName: 'Google',
    scope: 'openid email profile',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  facebook: {
    id: 'facebook',
    displayName: 'Facebook',
    scope: 'email',
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me',
    userInfoFields: 'id,name,email',
    clientIdEnv: 'FACEBOOK_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_CLIENT_SECRET',
  },
  x: {
    id: 'x',
    displayName: 'X',
    scope: 'users.read tweet.read',
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me',
    userInfoFields: 'id,name,username,email',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
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
    return {
      id: provider.id,
      displayName: provider.displayName,
      configured: isProviderConfigured(provider),
      redirectUri,
    };
  });
}

/**
 * Resolve the redirect URI for a provider. Single authoritative resolution:
 *  1. <PROVIDER>_REDIRECT_URI (e.g. GOOGLE_REDIRECT_URI)
 *  2. OAUTH_REDIRECT_URI
 *  3. Derived from PUBLIC_BACKEND_URL + the ACTUAL callback route
 *     (/auth/oauth/<provider>/callback)
 * The same value is used for the authorization request AND the token exchange,
 * which is what Google requires (exact redirect_uri match).
 */
export function getRedirectUri(provider) {
  const explicit = obj(process.env[`${provider.id.toUpperCase()}_REDIRECT_URI`])
    || obj(process.env.OAUTH_REDIRECT_URI);
  if (explicit) return explicit;

  const backendUrl = obj(process.env.PUBLIC_BACKEND_URL);
  if (!backendUrl) {
    throw new Error(
      `OAuth redirect URI is not configured. Set ${provider.id.toUpperCase()}_REDIRECT_URI (or OAUTH_REDIRECT_URI / PUBLIC_BACKEND_URL).`,
    );
  }
  return `${backendUrl.replace(/\/+$/, '')}/auth/oauth/${provider.id}/callback`;
}

/**
 * Startup validation. When a provider is ENABLED (client id + secret present)
 * but its redirect URI cannot be resolved, fail loudly so a broken OAuth flow
 * can never silently ship. Secrets are never logged.
 */
export function assertOAuthConfiguration() {
  const failures = [];
  for (const provider of Object.values(PROVIDERS)) {
    if (!isProviderConfigured(provider)) continue;
    try {
      const redirectUri = getRedirectUri(provider);
      loggerSafe(`OAuth ${provider.id}: enabled, callback=${redirectUri}`);
    } catch {
      failures.push(
        `${provider.id} is enabled but ${provider.id.toUpperCase()}_REDIRECT_URI / OAUTH_REDIRECT_URI / PUBLIC_BACKEND_URL is missing. ` +
        `Expected callback: https://<backend-origin>/auth/oauth/${provider.id}/callback`,
      );
    }
  }
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[OAuth] Invalid configuration:\n${failures.join('\n')}`);
    return false;
  }
  return true;
}

function loggerSafe(message) {
  // eslint-disable-next-line no-console
  console.log(`[OAuth] ${message}`);
}

export function buildAuthorizationUrl(providerId, state) {
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

  return { url: `${provider.authUrl}?${params.toString()}`, redirectUri };
}

export async function exchangeCode(providerId, code, redirectUri) {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider '${providerId}'.`);
  if (!isProviderConfigured(provider)) {
    throw new Error(`${provider.displayName} login is not configured.`);
  }

  const clientId = process.env[provider.clientIdEnv].trim();
  const clientSecret = process.env[provider.clientSecretEnv].trim();

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: String(code || ''),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed (${response.status}).`);
  }
  return data.access_token;
}

export async function fetchOAuthUserInfo(providerId, accessToken) {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider '${providerId}'.`);

  let url = provider.userInfoUrl;
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (provider.id === 'facebook') {
    const params = new URLSearchParams({
      fields: provider.userInfoFields || 'id,name,email',
      access_token: accessToken,
    });
    url = `${provider.userInfoUrl}?${params.toString()}`;
  } else if (provider.userInfoFields) {
    url = `${provider.userInfoUrl}?${provider.userInfoFields}`;
  }

  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OAuth profile lookup failed (${response.status}).`);
  }

  const email = (data.email || '').trim().toLowerCase() || null;
  const name = (data.name || data.username || '').trim() || null;

  return { providerId: provider.id, email, name, raw: data };
}