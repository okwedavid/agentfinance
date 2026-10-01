// harness.js — minimal express Router test harness.
//
// The OAuth routes are a plain `express.Router()`. Driving it through a real HTTP
// server for every test is slow and makes assertions about redirect targets and
// Set-Cookie headers awkward. Instead each route is mounted on a tiny throwaway
// express app once per file, so the middleware chain runs exactly as it does in
// production while the test keeps full control of the request.

import express from 'express';

// Captured before any test replaces `global.fetch`. Several auth tests stub
// `global.fetch` to synthesise provider (Google/Facebook/X) responses; if the
// harness used the mutable global, those stubs would swallow the harness's own
// loopback request and every assertion would silently inspect a provider stub.
const HARNESS_FETCH = globalThis.fetch.bind(globalThis);

export function mountRouter(router, mountPath = '/') {
  const app = express();
  app.use(mountPath, router);
  return app;
}

/**
 * Issue a request against a mounted app without listening on a port.
 *
 * Uses a real TCP server bound to an ephemeral port so cookies, redirects and
 * headers behave exactly as a browser would see them, then closes it.
 */
export function makeClient(app) {
  const server = app.listen(0);
  const { port } = server.address();

  return {
    async get(path, { headers = {} } = {}) {
      return request('GET', path, headers);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };

  async function request(method, path, headers) {
    // `global.fetch` is replaced by provider stubs in several tests, which would
    // also intercept the harness's own loopback request. Keep a private reference
    // captured at module load so the harness always reaches the test server.
    const res = await HARNESS_FETCH(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      redirect: 'manual',
    });

    // `getSetCookie()` is the only correct way to read repeated Set-Cookie
    // headers. Several tests stub `global.fetch` to synthesise provider
    // responses, and those stubs return plain objects, so `res.headers` may be
    // undefined even on a successful response.
    const rawHeaders = res.headers;
    let setCookie = [];
    if (rawHeaders && typeof rawHeaders.getSetCookie === 'function') {
      setCookie = rawHeaders.getSetCookie();
    } else if (rawHeaders && typeof rawHeaders.get === 'function') {
      setCookie = [rawHeaders.get('set-cookie')].filter(Boolean);
    }
    const location = rawHeaders && typeof rawHeaders.get === 'function'
      ? rawHeaders.get('location')
      : null;
    // Several tests replace `global.fetch` with a provider stub while the app
    // under test is also using it. Read the body defensively: a stubbed response
    // may not implement json()/text() at all.
    let body = null;
    if (res && typeof res.json === 'function') {
      body = await res.json().catch(() => null);
    } else if (res && typeof res.text === 'function') {
      body = await res.text().catch(() => null);
    }
    return { status: res?.status, headers: rawHeaders, setCookie, location, body };
  }
}

/** Parse query parameters out of a Location header. */
export function queryOf(location) {
  const url = new URL(location);
  return Object.fromEntries(url.searchParams.entries());
}

/** Pull a cookie value out of a Set-Cookie header list. */
export function cookieValue(setCookieList, name) {
  for (const raw of setCookieList) {
    for (const part of String(raw).split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return v.join('=');
    }
  }
  return null;
}

/** Find the full Set-Cookie header entry for a cookie name. */
export function cookieHeader(setCookieList, name) {
  return setCookieList.find((raw) => String(raw).trimStart().startsWith(`${name}=`)) || null;
}
