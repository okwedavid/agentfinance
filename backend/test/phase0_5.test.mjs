import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/prismaClient.js';
import {
  approvePayout,
  buildEvmPayoutTransaction,
  listPayoutsForAdmin,
  mapPayoutStatus,
  normalizeNetwork,
  rejectPayout,
  sanitizeBlockchainError,
} from '../src/services/payoutService.js';
import { requireAdmin, requireRole, ROLE_ADMIN, ROLE_SUPER_ADMIN } from '../src/middleware/auth.js';

const ETH_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function callMiddleware(fn, req = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve(this);
      },
    };
    fn(req, res, () => resolve({ next: true, req }));
  });
}

function stashPrisma() {
  const clone = {
    user: prisma.user,
    authSession: prisma.authSession,
    payout: prisma.payout,
  };
  return clone;
}

function restorePrisma(clone) {
  prisma.user = clone.user;
  prisma.authSession = clone.authSession;
  prisma.payout = clone.payout;
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.TREASURY_PRIVATE_KEY;
});

test('buildEvmPayoutTransaction builds a native transfer with empty calldata', () => {
  const network = normalizeNetwork('ethereum');
  const tx = buildEvmPayoutTransaction({
    network,
    recipientAddress: ETH_ADDRESS,
    amount: '0.001',
  });

  assert.equal(tx.to, ETH_ADDRESS);
  assert.equal(tx.data, '0x');
  assert.equal(tx.chainId, 1);
  assert.equal(tx.value.toString(), '1000000000000000');
});

test('buildEvmPayoutTransaction uses the correct chainId per network', () => {
  const base = normalizeNetwork('base');
  const tx = buildEvmPayoutTransaction({
    network: base,
    recipientAddress: ETH_ADDRESS,
    amount: '1.5',
  });
  assert.equal(tx.chainId, 8453);
});

test('buildEvmPayoutTransaction rejects non-EVM networks instead of emitting empty calldata', () => {
  const btc = normalizeNetwork('bitcoin');
  assert.throws(
    () => buildEvmPayoutTransaction({ network: btc, recipientAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', amount: '0.1' }),
    /does not support EVM/,
  );
});

test('buildEvmPayoutTransaction rejects malformed input', () => {
  const network = normalizeNetwork('ethereum');
  assert.throws(() => buildEvmPayoutTransaction({ network, recipientAddress: 'not-an-address', amount: '0.1' }), /Invalid recipient/);
  assert.throws(() => buildEvmPayoutTransaction({ network, recipientAddress: ETH_ADDRESS, amount: '0' }), /Invalid payout amount/);
  assert.throws(() => buildEvmPayoutTransaction({ network, recipientAddress: ETH_ADDRESS, amount: '-5' }), /Invalid payout amount/);
});

test('mapPayoutStatus maps stored statuses to the public status model', () => {
  assert.deepEqual(mapPayoutStatus('approval_required').key, 'pending_approval');
  assert.deepEqual(mapPayoutStatus('approval_required').label, 'Pending approval');
  assert.deepEqual(mapPayoutStatus('broadcasted').key, 'processing');
  assert.deepEqual(mapPayoutStatus('broadcasted').label, 'Processing');
  assert.deepEqual(mapPayoutStatus('confirmed').key, 'completed');
  assert.deepEqual(mapPayoutStatus('confirmed').label, 'Completed');
  assert.deepEqual(mapPayoutStatus('rejected').key, 'rejected');
  assert.deepEqual(mapPayoutStatus('rejected').label, 'Rejected');
  assert.deepEqual(mapPayoutStatus('failed').key, 'failed');
  assert.deepEqual(mapPayoutStatus('failed').label, 'Failed');
  assert.deepEqual(mapPayoutStatus('blocked').key, 'blocked');
  assert.deepEqual(mapPayoutStatus('draft').label, 'draft');
});

test('sanitizeBlockchainError never leaks raw RPC details to end users', () => {
  assert.equal(
    sanitizeBlockchainError(new Error('missing revert data (action="estimateGas", data=null, reason=null, transaction={ data: "0x" }, code=CALL_EXCEPTION)')),
    'The on-chain call returned no data. The destination may not accept native transfers.',
  );
  assert.equal(
    sanitizeBlockchainError(new Error('VM Exception while processing transaction: revert (code=CALL_EXCEPTION, version=6.16.0)')),
    'The transaction could not be executed on-chain. Verify the network configuration and try again.',
  );
  assert.equal(
    sanitizeBlockchainError(new Error('insufficient funds for gas * price + value')),
    'Insufficient funds in the treasury wallet.',
  );
  const generic = sanitizeBlockchainError(new Error('something completely unexpected happened'));
  assert.match(generic, /could not be completed/);
  assert.ok(!generic.includes('unexpected'));
});

test('requireRole returns 403 for a normal user on admin-gated routes', async () => {
  const stash = stashPrisma();
  try {
    prisma.user = { findUnique: async () => ({ id: 'u1', role: 'USER' }) };

    const result = await callMiddleware(requireAdmin, { user: { sub: 'u1' } });
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error, 'forbidden');
  } finally {
    restorePrisma(stash);
  }
});

test('requireAdmin admits ADMIN and SUPER_ADMIN and exposes server role', async () => {
  const stash = stashPrisma();
  try {
    const calls = [];
    for (const role of [ROLE_ADMIN, ROLE_SUPER_ADMIN]) {
      prisma.user = { findUnique: async () => ({ id: 'u1', role }) };
      calls.push(await callMiddleware(requireAdmin, { user: { sub: 'u1' } }));
    }
    assert.equal(calls[0].next, true);
    assert.equal(calls[0].req.userRole, ROLE_ADMIN);
    assert.equal(calls[1].next, true);
    assert.equal(calls[1].req.userRole, ROLE_SUPER_ADMIN);
  } finally {
    restorePrisma(stash);
  }
});

test('a demoted admin loses access immediately because the role is read from the database', async () => {
  const stash = stashPrisma();
  try {
    prisma.user = { findUnique: async () => ({ id: 'u1', role: ROLE_ADMIN }) };
    const before = await callMiddleware(requireRole([ROLE_ADMIN, ROLE_SUPER_ADMIN]), { user: { sub: 'u1' } });
    assert.equal(before.next, true);

    // Demotion: same user, new role in the database. The middleware must not
    // trust the JWT payload or any cached role.
    prisma.user = { findUnique: async () => ({ id: 'u1', role: 'USER' }) };
    const after = await callMiddleware(requireRole([ROLE_ADMIN, ROLE_SUPER_ADMIN]), { user: { sub: 'u1' } });
    assert.equal(after.statusCode, 403);
  } finally {
    restorePrisma(stash);
  }
});

test('a normal user cannot approve another user withdrawal', async () => {
  const stash = stashPrisma();
  try {
    prisma.user = { findUnique: async () => ({ id: 'u1', role: 'USER' }) };
    const result = await callMiddleware(requireAdmin, { user: { sub: 'u1' } });
    assert.equal(result.statusCode, 403);
  } finally {
    restorePrisma(stash);
  }
});

test('approvePayout refuses to approve your own withdrawal request', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({
        id: 'p1',
        userId: 'u1',
        network: 'ethereum',
        assetSymbol: 'ETH',
        amount: '0.01',
        recipientAddress: ETH_ADDRESS,
        status: 'approval_required',
        approvalToken: 'tok',
      }),
    };

    await assert.rejects(
      approvePayout({ payoutId: 'p1', userId: 'u1', approvalToken: 'tok', actorRole: ROLE_SUPER_ADMIN }),
      (err) => err.status === 403 && /own withdrawal/.test(err.message),
    );
  } finally {
    restorePrisma(stash);
  }
});

test('approvePayout rejects a mismatched approval token', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({
        id: 'p1',
        userId: 'u2',
        network: 'ethereum',
        assetSymbol: 'ETH',
        amount: '0.01',
        recipientAddress: ETH_ADDRESS,
        status: 'approval_required',
        approvalToken: 'real-token',
      }),
    };

    await assert.rejects(
      approvePayout({ payoutId: 'p1', userId: 'u1', approvalToken: 'wrong-token', actorRole: ROLE_ADMIN }),
      /Invalid approval token/,
    );
  } finally {
    restorePrisma(stash);
  }
});

test('approvePayout on another user payout proceeds to the signer check (no broadcast without treasury key)', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({
        id: 'p1',
        userId: 'u2',
        network: 'ethereum',
        assetSymbol: 'ETH',
        amount: '0.01',
        recipientAddress: ETH_ADDRESS,
        status: 'approval_required',
        approvalToken: 'tok',
      }),
      update: async () => ({
        id: 'p1',
        status: 'blocked',
        approvedAt: new Date(),
        error: 'No EVM treasury private key is configured.',
      }),
    };

    const result = await approvePayout({ payoutId: 'p1', userId: 'u1', approvalToken: 'tok', actorRole: ROLE_ADMIN });
    assert.equal(result.status, 'blocked');
    assert.match(result.error, /No EVM treasury private key/);
  } finally {
    restorePrisma(stash);
  }
});

test('approvePayout refuses to approve an already rejected payout', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({
        id: 'p1',
        userId: 'u2',
        network: 'ethereum',
        assetSymbol: 'ETH',
        amount: '0.01',
        recipientAddress: ETH_ADDRESS,
        status: 'rejected',
        approvalToken: 'tok',
      }),
    };

    await assert.rejects(
      approvePayout({ payoutId: 'p1', userId: 'u1', approvalToken: 'tok', actorRole: ROLE_ADMIN }),
      (err) => err.status === 409 && /already rejected/.test(err.message),
    );
  } finally {
    restorePrisma(stash);
  }
});

test('rejectPayout refuses to reject your own request', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({ id: 'p1', userId: 'u1', status: 'approval_required' }),
    };
    await assert.rejects(
      rejectPayout({ payoutId: 'p1', userId: 'u1', reason: 'nope' }),
      (err) => err.status === 403 && /own withdrawal/.test(err.message),
    );
  } finally {
    restorePrisma(stash);
  }
});

test('rejectPayout marks another user request as rejected with a reason', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({ id: 'p1', userId: 'u2', status: 'approval_required' }),
      update: async ({ data }) => data,
    };
    const result = await rejectPayout({ payoutId: 'p1', userId: 'u1', reason: 'Suspicious destination' });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error, 'Suspicious destination');
    assert.ok(result.rejectedAt instanceof Date);
  } finally {
    restorePrisma(stash);
  }
});

test('rejectPayout blocks rejection of an already broadcast payout', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findUnique: async () => ({ id: 'p1', userId: 'u2', status: 'broadcasted' }),
    };
    await assert.rejects(
      rejectPayout({ payoutId: 'p1', userId: 'u1', reason: 'too late' }),
      (err) => err.status === 409 && /cannot be rejected/.test(err.message),
    );
  } finally {
    restorePrisma(stash);
  }
});

test('listPayoutsForAdmin joins the requesting user and maps status for display', async () => {
  const stash = stashPrisma();
  try {
    prisma.payout = {
      findMany: async () => [
        {
          id: 'p1',
          userId: 'u2',
          network: 'ethereum',
          assetSymbol: 'ETH',
          amount: '0.01',
          recipientAddress: ETH_ADDRESS,
          status: 'approval_required',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          user: { id: 'u2', username: 'alice', email: 'a@example.com', displayName: 'Alice' },
        },
      ],
    };
    const rows = await listPayoutsForAdmin();
    assert.equal(rows[0].user.username, 'alice');
    assert.equal(rows[0].statusMeta.key, 'pending_approval');
    assert.equal(rows[0].statusMeta.label, 'Pending approval');
  } finally {
    restorePrisma(stash);
  }
});