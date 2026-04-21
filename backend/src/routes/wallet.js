/**
 * wallet.js — backend route for wallet operations
 * Handles balance checks with server-side Alchemy key (never exposed to frontend)
 */
import express from 'express';
import fetch from 'node-fetch';
import logger from '../utils/logger.js';

const router = express.Router();

// GET /wallet/balance?address=0x...
router.get('/balance', async (req, res) => {
  const { address } = req.query;

  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return res.status(400).json({ error: 'Invalid address' });
  }

  const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
  if (!ALCHEMY_KEY) {
    return res.status(503).json({ error: 'ALCHEMY_API_KEY not configured in Railway', eth: null, usd: null });
  }

  try {
    // Fetch ETH balance
    const balRes = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [address, 'latest'],
      }),
    });

    if (!balRes.ok) {
      throw new Error(`Alchemy HTTP ${balRes.status}`);
    }

    const balData = await balRes.json();
    const weiHex = balData.result;
    const ethBalance = (parseInt(weiHex, 16) / 1e18).toFixed(6);

    // Fetch ETH price from CoinGecko
    let ethPrice = 3200;
    try {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const priceData = await priceRes.json();
      ethPrice = priceData?.ethereum?.usd || 3200;
    } catch {}

    const usdValue = (parseFloat(ethBalance) * ethPrice).toFixed(2);

    logger.info(`[Wallet] Balance for ${address.slice(0, 10)}… : ${ethBalance} ETH`);

    return res.json({
      address,
      eth: ethBalance,
      usd: usdValue,
      ethPrice,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    logger.error(`[Wallet] Balance check failed: ${err.message}`);
    return res.status(500).json({ error: err.message, eth: null, usd: null });
  }
});

// GET /wallet/tokens?address=0x...
router.get('/tokens', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;
  if (!ALCHEMY_KEY) return res.status(503).json({ error: 'ALCHEMY_API_KEY not configured' });

  try {
    const r = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getTokenBalances',
        params: [address],
      }),
    });
    const data = await r.json();
    const tokens = (data.result?.tokenBalances || [])
      .filter((t: any) => t.tokenBalance !== '0x0000000000000000000000000000000000000000000000000000000000000000')
      .slice(0, 20);

    return res.json({ address, tokens });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;