// OAuth provider configuration + helper flow.
//
// PHASE 0 NOTE:
// No provider credentials are hardcoded and no fake OAuth is performed here.
// A provider is only "configured" when BOTH <PROVIDER>_CLIENT_ID and
// <PROVIDER>_CLIENT_SECRET exist in the server environment. Unconfigured
// providers fail gracefully (the login UI disables them and the API returns a
// clear "not configured" error). The normal username+password login is never
// affected by these settings.
//
// PHASE 1:
// - The callback completes with a redirect back to the frontend with the signed
//   token in a URL *fragment* (#access_token=...), so the token is never sent
//   in another HTTP request or stored in server logs.
// - Users are linked by a stable per-provider subject id (oauthId). Email is
//   used as a secondary link for accounts created before per-provider ids, and
//   for providers that return one.

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
    scope: 'users.read tweet.read email',
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me',
    userInfoFields: 'id,name,username,email,profile_image_url',
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
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    configured: isProviderConfigured(provider),
  }));
}

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

export function fetchOAuthUserInfo(providerId, accessToken) {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider '${providerId}'.`);

  if (provider.id === 'x') {
    // Twitter/X API v2: /users/me returns id/name/username by default. Email and
    // avatar need to be requested explicitly with user.fields and are only
    // returned when the app has the required permission (some apps never receive
    // email). The id is always present, so it remains a stable identity key.
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
      const email = (profile.email || '').trim().toLowerCase() || null;
      const name = (profile.name || profile.username || '').trim() || null;
      return { providerId: provider.id, providerSubject: profile.id || null, email, name, avatar: profile.profile_image_url || null };
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
  } else if (provider.userInfoFields) {
    url = `${provider.userInfoUrl}?${provider.userInfoFields}`;
  }

  return fetch(url, { headers }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`OAuth profile lookup failed (${response.status}).`);
    }
    const email = (data.email || '').trim().toLowerCase() || null;
    const name = (data.name || data.username || '').trim() || null;
    return { providerId: provider.id, providerSubject: data.id || null, email, name, avatar: data.picture || null };
  });
}

/**
 * The frontend origin that completes the OAuth popup/direct flow. The callback
 * redirects the browser here with the session token in the URL fragment.
 */
export function resolveOauthSuccessUrl() {
  const value = obj(process.env.OAUTH_SUCCESS_URL) || obj(process.env.FRONTEND_URL);
  if (!value) {
    throw new Error(
      'OAuth login cannot complete: set OAUTH_SUCCESS_URL (or FRONTEND_URL) to the frontend origin (e.g. https://agentfinance.onrender.com).',
    );
  }
  // Only allow http(s) URLs — a malformed or javascript: value must never be
  // used as a redirect target.
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