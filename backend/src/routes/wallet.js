import express from 'express';
import jwt from 'jsonwebtoken';
import { JsonRpcProvider, formatEther } from 'ethers';
import { normalizeNetwork, isValidAddressForNetwork } from '../services/payoutService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me';

function optionalAuth(req, _res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
    if (token) req.user = jwt.verify(token, JWT_SECRET);
  } catch {}
  next();
}

function getRpcUrl(networkId) {
  const alchemy = process.env.ALCHEMY_API_KEY;
  const ankrValue = process.env.ANKR_RPC_URL || process.env.ANKR_API_KEY;
  const ankrUrl = ankrValue?.startsWith('http') ? ankrValue : null;

  switch (networkId) {
    case 'ethereum':
      return process.env.ETH_RPC_URL
        || (alchemy ? `https://eth-mainnet.g.alchemy.com/v2/${alchemy}` : null)
        || (process.env.INFURA_API_KEY ? `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}` : null);
    case 'polygon':
      return process.env.POLYGON_RPC_URL
        || (alchemy ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemy}` : null)
        || 'https://polygon-rpc.com';
    case 'arbitrum':
      return process.env.ARBITRUM_RPC_URL
        || (alchemy ? `https://arb-mainnet.g.alchemy.com/v2/${alchemy}` : null)
        || 'https://arb1.arbitrum.io/rpc';
    case 'base':
      return process.env.BASE_RPC_URL
        || (alchemy ? `https://base-mainnet.g.alchemy.com/v2/${alchemy}` : null)
        || 'https://mainnet.base.org';
    case 'bsc':
      return process.env.BSC_RPC_URL || ankrUrl || 'https://bsc-dataseed.binance.org';
    default:
      return null;
  }
}

async function fetchEvmBalance(address, network) {
  const rpcUrl = getRpcUrl(network.id);
  if (!rpcUrl) {
    throw new Error(`No RPC endpoint is configured for ${network.label}.`);
  }

  const provider = new JsonRpcProvider(rpcUrl, network.chainId);
  const wei = await provider.getBalance(address);
  const nativeBalance = formatEther(wei);
  const roundedBalance = Number(nativeBalance).toFixed(6);

  let usdPrice = null;
  try {
    const coinId = network.id === 'bsc'
      ? 'binancecoin'
      : network.id === 'polygon'
        ? 'matic-network'
        : 'ethereum';
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`, {
      signal: AbortSignal.timeout(3000),
    });
    const priceData = await response.json();
    usdPrice = priceData?.[coinId]?.usd || null;
  } catch {}

  return {
    address,
    network: network.id,
    symbol: network.symbol,
    balance: roundedBalance,
    usd: usdPrice ? (Number(roundedBalance) * usdPrice).toFixed(2) : null,
    priceUsd: usdPrice,
    timestamp: new Date().toISOString(),
  };
}

async function fetchBitcoinBalance(address) {
  const base = (process.env.BTC_API_BASE || 'https://mempool.space/api').replace(/\/$/, '');
  const response = await fetch(`${base}/address/${address}`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) {
    throw new Error(`Bitcoin balance lookup failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  const funded = data?.chain_stats?.funded_txo_sum || 0;
  const spent = data?.chain_stats?.spent_txo_sum || 0;
  const sats = funded - spent;
  const btc = (sats / 100000000).toFixed(8);

  let usd = null;
  let priceUsd = null;
  try {
    const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
      signal: AbortSignal.timeout(3000),
    });
    const priceData = await priceResponse.json();
    priceUsd = priceData?.bitcoin?.usd || null;
    usd = priceUsd ? (Number(btc) * priceUsd).toFixed(2) : null;
  } catch {}

  return {
    address,
    network: 'bitcoin',
    symbol: 'BTC',
    balance: btc,
    usd,
    priceUsd,
    timestamp: new Date().toISOString(),
  };
}

router.get('/balance', optionalAuth, async (req, res) => {
  const address = String(req.query.address || '').trim();
  const network = normalizeNetwork(req.query.network);

  if (!address) {
    return res.status(400).json({ error: 'address query param required' });
  }
  if (!isValidAddressForNetwork(address, network)) {
    return res.status(400).json({ error: `Invalid ${network.label} address.` });
  }

  try {
    const payload = network.kind === 'btc'
      ? await fetchBitcoinBalance(address)
      : await fetchEvmBalance(address, network);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      address,
      network: network.id,
      balance: null,
      usd: null,
    });
  }
});

export default router;
