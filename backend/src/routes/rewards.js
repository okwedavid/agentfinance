// rewards.js — reward economy routes (user balance + admin pool/funding).
//
// Security notes:
//   - No endpoint ever returns a secret, private key, approval token, or
//     amount of treasury funding beyond public on-chain numbers.
//   - Funding confirmation is ADMIN_ONLY. Payout broadcasting itself remains
//     gated by the existing approval-token flow in payoutService.
//   - Demo mode (REWARD_DEMO_MODE=true) tags every figure SIMULATED and the
//     payout approve path refuses to broadcast.

import { Router } from 'express';
import { JsonRpcProvider, formatEther } from 'ethers';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { normalizeNetwork, getEvmRpcUrl } from '../services/payoutService.js';
import {
  getUserRewardBalance,
  getPoolOverview,
  createFundingEvent,
  confirmFundingEvent,
  listRewardEvents,
  listRewardLedger,
  listFundingEvents,
  listSettlementRecords,
  rewardInvariantSummary,
  SOURCE_TYPES,
  demoMode,
} from '../services/rewardService.js';
import logger from '../utils/logger.js';

const router = Router();
const adminRouter = Router();

function handle(res, error) {
  const status = Number(error?.status) || 500;
  const message = status === 500 ? 'Reward operation failed.' : (error?.message || 'Reward operation failed.');
  if (status >= 500) logger.error('[rewards] route error', error?.message);
  return res.status(status).json(status === 500 ? { error: message } : { error: message, ...(error?.payload || {}) });
}

// Read-only treasury balance for the admin overview. Uses public RPC reads
// only — the private key is never touched, constructed, or logged.
async function liveTreasuryBalanceBnb() {
  try {
    const network = normalizeNetwork('bsc');
    const rpcUrl = getEvmRpcUrl(network.id);
    const address = (process.env.TREASURY_WALLET_ADDRESS || '').trim();
    if (!rpcUrl || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
    const provider = new JsonRpcProvider(rpcUrl, network.chainId);
    const balance = await provider.getBalance(address);
    return formatEther(balance);
  } catch (error) {
    logger.warn('[rewards] live treasury balance unavailable', error?.message);
    return null;
  }
}

// ── User-facing ──────────────────────────────────────────────────────────────

router.get('/balance', authMiddleware, async (req, res) => {
  try {
    res.json(await getUserRewardBalance(req.user.sub));
  } catch (error) {
    handle(res, error);
  }
});

router.get('/events', authMiddleware, async (req, res) => {
  try {
    res.json({ events: await listRewardEvents(req.user.sub, req.query.take) });
  } catch (error) {
    handle(res, error);
  }
});

router.get('/ledger', authMiddleware, async (req, res) => {
  try {
    res.json({ entries: await listRewardLedger(req.user.sub, req.query.take) });
  } catch (error) {
    handle(res, error);
  }
});

// Public pool summary — deliberately does NOT include the live treasury
// balance or any wallet/credential details.
router.get('/pool', async (req, res) => {
  try {
    res.json(await getPoolOverview());
  } catch (error) {
    handle(res, error);
  }
});

// ── Admin pool / funding ─────────────────────────────────────────────────────

adminRouter.get('/overview', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [pool, funding, settlements, invariant] = await Promise.all([
      getPoolOverview(),
      listFundingEvents(200),
      listSettlementRecords(200),
      rewardInvariantSummary(),
    ]);

    if (!pool.onChainTreasuryBalanceBnb) {
      pool.onChainTreasuryBalanceBnb = await liveTreasuryBalanceBnb();
    }
    pool.liveRefresh = new Date().toISOString();

    res.json({
      pool,
      invariant,
      fundingEvents: funding,
      settlements,
      allowedSourceTypes: SOURCE_TYPES,
      demoMode: demoMode(),
    });
  } catch (error) {
    handle(res, error);
  }
});

adminRouter.post('/fund', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const event = await createFundingEvent({
      sourceType: req.body.sourceType,
      amountBnb: req.body.amountBnb,
      reference: req.body.reference,
      note: req.body.note,
    });
    res.status(201).json({
      event,
      note: 'Funding event created as PENDING. Confirm it to credit the pool (accounting only; on-chain funds remain operator-controlled).',
    });
  } catch (error) {
    handle(res, error);
  }
});

adminRouter.post('/fund/:id/confirm', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const event = await confirmFundingEvent({ eventId: req.params.id, requestedBy: req.user.sub });
    res.json({ event });
  } catch (error) {
    handle(res, error);
  }
});

// ──/api/rewards + /api/admin/rewards ─────────────────────────────────────────

export default function makeRewardsRouter() {
  return { rewards: router, adminRewards: adminRouter };
}