/**
 * walletRoutes.js
 * Mount: app.use('/wallet', walletRouter)
 *
 * GET  /wallet/balance?address=0x...    → ETH balance via Alchemy
 * GET  /wallet/tokens?address=0x...     → ERC-20 token balances
 * POST /auth/wallet                     → save wallet address for user
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prismaClient.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me';

// ── Auth middleware ──────────────────────────────────────────────────────────
function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
    if (token) req.user = jwt.verify(token, JWT_SECRET);
  } catch {}
  next();
}

function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

// ── GET /wallet/balance?address=0x... ──────────────────────────────────────
router.get('/balance', optionalAuth, async (req, res) => {
  const { address } = req.query;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address query param required' });
  }
  if (!address.startsWith('0x') || address.length !== 42) {
    return res.status(400).json({ error: 'invalid Ethereum address' });
  }

  const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
  if (!ALCHEMY_KEY) {
    return res.status(503).json({
      error: 'ALCHEMY_API_KEY not set in Railway backend env vars',
      eth: '0.000000',
      usd: '0.00',
    });
  }

  try {
    // Fetch ETH balance from Alchemy
    const alchemyRes = await fetch(
      `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [address, 'latest'],
        }),
      }
    );

    if (!alchemyRes.ok) {
      throw new Error(`Alchemy HTTP ${alchemyRes.status}`);
    }

    const alchemyData = await alchemyRes.json();

    if (alchemyData.error) {
      throw new Error(alchemyData.error.message || 'Alchemy error');
    }

    const weiHex = alchemyData.result;
    const wei = BigInt(weiHex);
    const eth = (Number(wei) / 1e18).toFixed(6);

    // Get ETH price from CoinGecko (no key needed)
    let ethPrice = 3200;
    try {
      const priceRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { signal: AbortSignal.timeout(3000) }
      );
      const priceData = await priceRes.json();
      ethPrice = priceData?.ethereum?.usd || 3200;
    } catch {}

    const usd = (parseFloat(eth) * ethPrice).toFixed(2);

    return res.json({ address, eth, usd, ethPrice, timestamp: new Date().toISOString() });

  } catch (err) {
    console.error('[Wallet] balance error:', err.message);
    return res.status(500).json({
      error: err.message,
      eth: null,
      usd: null,
    });
  }
});

// ── GET /wallet/tokens?address=0x... ──────────────────────────────────────
router.get('/tokens', optionalAuth, async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
  if (!ALCHEMY_KEY) return res.status(503).json({ error: 'ALCHEMY_API_KEY not set' });

  try {
    const r = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'alchemy_getTokenBalances',
        params: [address],
      }),
    });
    const data = await r.json();
    const tokens = (data.result?.tokenBalances || [])
      .filter(t => t.tokenBalance !== '0x0000000000000000000000000000000000000000000000000000000000000000')
      .slice(0, 20);
    return res.json({ address, tokens });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
