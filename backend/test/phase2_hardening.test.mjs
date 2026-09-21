import { test } from 'node:test';
import assert from 'node:assert/strict';

import errorHandler from '../src/middleware/errorHandler.js';
import securityHeaders from '../src/middleware/securityHeaders.js';
import { normalizeNetwork, isValidAddressForNetwork } from '../src/services/payoutService.js';

function mockResponse() {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

function withEnv(next, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return next();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('errorHandler never leaks 5xx internals in production', () => {
  withEnv(() => {
    const err = new Error('DATABASE_CONNECTION_STRING=http://secret internal stack');
    const res = mockResponse();
    errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'internal_error' });
  }, { NODE_ENV: 'production' });
});

test('errorHandler exposes only curated 4xx messages in production', () => {
  withEnv(() => {
    const exposed = Object.assign(new Error('too many active tasks'), { status: 429, expose: true });
    const res1 = mockResponse();
    errorHandler(exposed, { method: 'POST', originalUrl: '/tasks' }, res1, () => {});
    assert.equal(res1.statusCode, 429);
    assert.equal(res1.body.error, 'too many active tasks');

    const generic = Object.assign(new Error('raw internal detail'), { status: 400 });
    const res2 = mockResponse();
    errorHandler(generic, { method: 'POST', originalUrl: '/x' }, res2, () => {});
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.body.error, 'request_failed');
    assert.equal('stack' in res2.body, false);
  }, { NODE_ENV: 'production' });
});

test('errorHandler keeps stack traces for local debugging', () => {
  withEnv(() => {
    const err = new Error('boom');
    const res = mockResponse();
    errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal('stack' in (res.body || {}), true);
  }, { NODE_ENV: 'test' });
});

test('securityHeaders sets the full security header set and forwards', () => {
  const headers = {};
  const req = {};
  const res = {
    setHeader(key, value) { headers[key] = value; },
  };
  let nextCalled = false;
  securityHeaders(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(headers['Strict-Transport-Security'], undefined); // dev only
});

test('securityHeaders emits HSTS in production', () => {
  withEnv(() => {
    const headers = {};
    securityHeaders({}, { setHeader(k, v) { headers[k] = v; } }, () => {});
    assert.equal(headers['Strict-Transport-Security'], 'max-age=15552000; includeSubDomains');
  }, { NODE_ENV: 'production' });
});

test('normalizeNetwork accepts known networks and rejects unknown ones', () => {
  const eth = normalizeNetwork('ethereum');
  assert.equal(eth.id, 'ethereum');
  assert.equal(eth.kind, 'evm');
  assert.equal(normalizeNetwork('bitcoin').kind, 'btc');

  const unknown = normalizeNetwork('not-a-network');
  assert.equal(unknown.id, 'ethereum'); // safe default, never fabrication
});

test('isValidAddressForNetwork validates EVM and BTC shapes', () => {
  assert.equal(isValidAddressForNetwork('0x' + '0'.repeat(40), normalizeNetwork('ethereum')), true);
  assert.equal(isValidAddressForNetwork('0x123', normalizeNetwork('ethereum')), false);
  assert.equal(isValidAddressForNetwork('not-an-address', normalizeNetwork('bitcoin')), false);
  assert.equal(isValidAddressForNetwork('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', normalizeNetwork('bitcoin')), true);
});