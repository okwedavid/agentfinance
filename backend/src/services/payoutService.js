import { randomUUID } from 'crypto';
import { Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';
import prisma from '../prismaClient.js';

const NETWORKS = {
  ethereum: {
    id: 'ethereum',
    label: 'Ethereum',
    symbol: 'ETH',
    kind: 'evm',
    chainId: 1,
  },
  polygon: {
    id: 'polygon',
    label: 'Polygon',
    symbol: 'MATIC',
    kind: 'evm',
    chainId: 137,
  },
  arbitrum: {
    id: 'arbitrum',
    label: 'Arbitrum',
    symbol: 'ETH',
    kind: 'evm',
    chainId: 42161,
  },
  base: {
    id: 'base',
    label: 'Base',
    symbol: 'ETH',
    kind: 'evm',
    chainId: 8453,
  },
  bsc: {
    id: 'bsc',
    label: 'BNB Smart Chain',
    symbol: 'BNB',
    kind: 'evm',
    chainId: 56,
  },
  bitcoin: {
    id: 'bitcoin',
    label: 'Bitcoin',
    symbol: 'BTC',
    kind: 'btc',
  },
  btc: {
    id: 'bitcoin',
    label: 'Bitcoin',
    symbol: 'BTC',
    kind: 'btc',
  },
};

function cleanText(value = '') {
  return String(value)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/[_*`#>|[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeNetwork(network) {
  const key = String(network || 'ethereum').toLowerCase().trim();
  return NETWORKS[key] || NETWORKS.ethereum;
}

function getEvmRpcUrl(networkId) {
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

function getBtcApiBase() {
  return (process.env.BTC_API_BASE || 'https://mempool.space/api').replace(/\/$/, '');
}

function isValidEvmPrivateKey(value) {
  return typeof value === 'string' && /^(0x)?[a-fA-F0-9]{64}$/.test(value.trim());
}

function normalizePrivateKey(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function getTreasurySignerStatus(network) {
  if (network.kind === 'btc') {
    return {
      ready: !!(process.env.BTC_TREASURY_WIF && process.env.BTC_TREASURY_ADDRESS),
      signerType: process.env.BTC_TREASURY_WIF ? 'btc' : 'none',
      treasuryAddress: process.env.BTC_TREASURY_ADDRESS || null,
      reason: process.env.BTC_TREASURY_WIF && process.env.BTC_TREASURY_ADDRESS
        ? null
        : 'Bitcoin payouts need BTC_TREASURY_WIF and BTC_TREASURY_ADDRESS.',
    };
  }

  const rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.EVM_TREASURY_PRIVATE_KEY || null;
  const treasuryAddress = process.env.TREASURY_WALLET_ADDRESS || process.env.EVM_TREASURY_WALLET_ADDRESS || null;
  if (!rawKey) {
    return {
      ready: false,
      signerType: 'none',
      treasuryAddress,
      reason: 'No EVM treasury private key is configured.',
    };
  }

  if (!isValidEvmPrivateKey(rawKey)) {
    return {
      ready: false,
      signerType: 'incompatible',
      treasuryAddress,
      reason: 'The configured treasury key is not an EVM private key. A Solana key cannot sign Ethereum or BNB Smart Chain payouts.',
    };
  }

  try {
    const wallet = new Wallet(normalizePrivateKey(rawKey));
    if (treasuryAddress && wallet.address.toLowerCase() !== treasuryAddress.toLowerCase()) {
      return {
        ready: false,
        signerType: 'evm',
        treasuryAddress: wallet.address,
        reason: 'TREASURY_WALLET_ADDRESS does not match the configured EVM private key.',
      };
    }

    return {
      ready: true,
      signerType: 'evm',
      treasuryAddress: treasuryAddress || wallet.address,
      reason: null,
    };
  } catch (error) {
    return {
      ready: false,
      signerType: 'incompatible',
      treasuryAddress,
      reason: cleanText(error.message || 'Could not load treasury signer.'),
    };
  }
}

export function isValidAddressForNetwork(address, network) {
  const value = String(address || '').trim();
  if (network.kind === 'btc') {
    return /^(bc1|[13])[a-zA-Z0-9]{24,87}$/.test(value);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function resolveRecipientAddress(user, network, explicitAddress) {
  if (explicitAddress) return explicitAddress.trim();

  const profiles = user?.walletProfiles && typeof user.walletProfiles === 'object'
    ? user.walletProfiles
    : {};

  return profiles?.[network.id] || profiles?.ethereum || user?.walletAddress || '';
}

function buildPayoutSummary({ payout, signer, network }) {
  const lines = [
    `Routing plan prepared for ${payout.amount} ${payout.assetSymbol} on ${network.label}.`,
    `Destination wallet: ${payout.recipientAddress}.`,
  ];

  if (signer.treasuryAddress) {
    lines.push(`Treasury wallet: ${signer.treasuryAddress}.`);
  }

  if (payout.status === 'approval_required') {
    lines.push('Status: ready for approval.');
    lines.push('Next step: approve the payout to sign and broadcast the transaction.');
  } else if (payout.status === 'blocked') {
    lines.push(`Status: blocked. ${signer.reason}`);
    lines.push('Next step: configure a compatible treasury signer for the selected network, then prepare the payout again.');
  } else if (payout.status === 'broadcasted') {
    lines.push(`Status: broadcasted. Transaction hash: ${payout.txHash}.`);
  } else if (payout.status === 'confirmed') {
    lines.push(`Status: confirmed. Transaction hash: ${payout.txHash}.`);
  }

  return lines.map(cleanText).join('\n');
}

async function buildUnsignedPayload({ network, recipientAddress, amount, signer }) {
  if (network.kind === 'btc') {
    return {
      kind: 'btc_transfer',
      network: network.id,
      symbol: network.symbol,
      amount,
      recipientAddress,
      treasuryAddress: signer.treasuryAddress,
      apiBase: getBtcApiBase(),
    };
  }

  const rpcUrl = getEvmRpcUrl(network.id);
  return {
    kind: 'evm_native_transfer',
    network: network.id,
    symbol: network.symbol,
    chainId: network.chainId,
    amount,
    recipientAddress,
    treasuryAddress: signer.treasuryAddress,
    rpcConfigured: !!rpcUrl,
    rpcUrlHint: rpcUrl ? cleanText(rpcUrl).slice(0, 64) : null,
  };
}

export async function preparePayoutPlan({
  userId,
  taskId = null,
  network: requestedNetwork,
  amount,
  recipientAddress,
}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found.');

  const network = normalizeNetwork(requestedNetwork);
  const resolvedRecipient = resolveRecipientAddress(user, network, recipientAddress);
  if (!isValidAddressForNetwork(resolvedRecipient, network)) {
    throw new Error(`Enter a valid ${network.label} wallet address.`);
  }

  const safeAmount = Number(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  const signer = getTreasurySignerStatus(network);
  const status = signer.ready ? 'approval_required' : 'blocked';
  const unsignedPayload = await buildUnsignedPayload({
    network,
    recipientAddress: resolvedRecipient,
    amount: safeAmount.toFixed(network.kind === 'btc' ? 8 : 6),
    signer,
  });

  const payout = await prisma.payout.create({
    data: {
      userId,
      taskId,
      network: network.id,
      assetSymbol: network.symbol,
      amount: safeAmount.toFixed(network.kind === 'btc' ? 8 : 6),
      recipientAddress: resolvedRecipient,
      treasuryAddress: signer.treasuryAddress,
      status,
      approvalToken: randomUUID(),
      unsignedPayload,
      summary: '',
      error: signer.reason || null,
    },
  });

  const summary = buildPayoutSummary({ payout, signer, network });
  return prisma.payout.update({
    where: { id: payout.id },
    data: { summary },
  });
}

async function broadcastEvmPayout(payout) {
  const network = normalizeNetwork(payout.network);
  const rpcUrl = getEvmRpcUrl(network.id);
  if (!rpcUrl) {
    throw new Error(`No RPC endpoint is configured for ${network.label}.`);
  }

  const rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.EVM_TREASURY_PRIVATE_KEY;
  if (!isValidEvmPrivateKey(rawKey)) {
    throw new Error('The configured treasury key is not a valid EVM private key.');
  }

  const provider = new JsonRpcProvider(rpcUrl, network.chainId);
  const signer = new Wallet(normalizePrivateKey(rawKey), provider);
  const tx = await signer.sendTransaction({
    to: payout.recipientAddress,
    value: parseEther(String(payout.amount)),
  });

  return {
    treasuryAddress: signer.address,
    txHash: tx.hash,
    signedPayload: {
      hash: tx.hash,
      nonce: tx.nonce,
      from: tx.from,
      to: tx.to,
      value: tx.value?.toString?.() || null,
      chainId: tx.chainId,
    },
  };
}

export async function approvePayout({ payoutId, userId }) {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, userId },
  });

  if (!payout) throw new Error('Payout not found.');
  if (payout.status === 'confirmed') return payout;

  const network = normalizeNetwork(payout.network);
  const signer = getTreasurySignerStatus(network);
  if (!signer.ready) {
    const blocked = await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: 'blocked',
        approvedAt: new Date(),
        error: signer.reason,
      },
    });
    return blocked;
  }

  if (network.kind !== 'evm') {
    const blocked = await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: 'blocked',
        approvedAt: new Date(),
        error: 'Bitcoin payout broadcasting is not enabled yet. Add BTC signing infrastructure before approval can broadcast.',
      },
    });
    return blocked;
  }

  const broadcasted = await broadcastEvmPayout(payout);
  const next = await prisma.payout.update({
    where: { id: payout.id },
    data: {
      status: 'broadcasted',
      treasuryAddress: broadcasted.treasuryAddress,
      txHash: broadcasted.txHash,
      signedPayload: broadcasted.signedPayload,
      approvedAt: new Date(),
      broadcastAt: new Date(),
      error: null,
    },
  });

  const summary = buildPayoutSummary({ payout: next, signer: { ...signer, treasuryAddress: broadcasted.treasuryAddress }, network });
  return prisma.payout.update({
    where: { id: payout.id },
    data: { summary },
  });
}

export async function refreshPayoutStatus({ payoutId, userId }) {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, userId },
  });
  if (!payout) throw new Error('Payout not found.');

  if (!payout.txHash) return payout;

  const network = normalizeNetwork(payout.network);
  if (network.kind === 'btc') return payout;

  const rpcUrl = getEvmRpcUrl(network.id);
  if (!rpcUrl) return payout;

  const provider = new JsonRpcProvider(rpcUrl, network.chainId);
  const receipt = await provider.getTransactionReceipt(payout.txHash);
  if (!receipt) return payout;

  const status = receipt.status === 1 ? 'confirmed' : 'failed';
  const updated = await prisma.payout.update({
    where: { id: payout.id },
    data: {
      status,
      confirmedAt: status === 'confirmed' ? new Date() : payout.confirmedAt,
      error: status === 'failed' ? 'The transaction was broadcast but did not confirm successfully.' : null,
    },
  });

  const signer = getTreasurySignerStatus(network);
  const summary = buildPayoutSummary({ payout: updated, signer, network });
  return prisma.payout.update({
    where: { id: payout.id },
    data: { summary },
  });
}

export async function listPayouts(userId) {
  return prisma.payout.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
}

export function summariseTaskResult(value) {
  if (!value) return '';
  const parsed = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      })()
    : value;

  if (typeof parsed === 'string') {
    return cleanText(parsed).replace(/\. /g, '.\n');
  }

  if (parsed?.summary) return cleanText(parsed.summary).replace(/\. /g, '.\n');
  if (parsed?.error) return `Task failed.\n${cleanText(parsed.error)}`;
  if (parsed?.output) return summariseTaskResult(parsed.output);
  return cleanText(JSON.stringify(parsed));
}

export function payoutRuntimeSnapshot() {
  const evm = getTreasurySignerStatus(NETWORKS.ethereum);
  const btc = getTreasurySignerStatus(NETWORKS.bitcoin);

  return {
    treasury: {
      evmReady: evm.ready,
      btcReady: btc.ready,
      signerType: evm.signerType,
      treasuryAddress: evm.treasuryAddress || btc.treasuryAddress || null,
      issue: evm.reason || btc.reason || null,
    },
    networks: Object.values(NETWORKS)
      .filter((value, index, list) => list.findIndex((item) => item.id === value.id) === index)
      .map((network) => ({
        id: network.id,
        label: network.label,
        symbol: network.symbol,
        kind: network.kind,
        rpcConfigured: network.kind === 'btc' ? true : !!getEvmRpcUrl(network.id),
      })),
  };
}
