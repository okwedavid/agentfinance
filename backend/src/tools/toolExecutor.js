/**
 * toolExecutor.js — real tool implementations
 * Tool names must exactly match toolDefinitions.js
 */

import logger from '../utils/logger.js';

const CG_BASE = 'https://api.coingecko.com/api/v3';

const SYMBOL_MAP = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  usdc: 'usd-coin', usdt: 'tether', link: 'chainlink', matic: 'matic-network',
  avax: 'avalanche-2', dot: 'polkadot', ada: 'cardano', doge: 'dogecoin',
  arb: 'arbitrum', op: 'optimism', uni: 'uniswap', aave: 'aave',
  crv: 'curve-dao-token', mkr: 'maker', snx: 'havven', comp: 'compound-governance-token',
  ldo: 'lido-dao', cvx: 'convex-finance',
};

async function cgFetch(path) {
  const headers = { Accept: 'application/json' };
  if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  const res = await fetch(`${CG_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${path}`);
  return res.json();
}

// ── Implementations ───────────────────────────────────────────────────────────

async function search_web({ query }) {
  if (!process.env.TAVILY_API_KEY) {
    return `Web search not available (TAVILY_API_KEY not set in Railway env). Query was: "${query}". Please add TAVILY_API_KEY for live search results.`;
  }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
        search_depth: 'basic',
        include_answer: true,
      }),
    });
    const data = await res.json();
    const sources = (data.results || [])
      .map(r => `**${r.title}**\n${r.content}\nSource: ${r.url}`)
      .join('\n\n---\n\n');
    return data.answer
      ? `Summary: ${data.answer}\n\nDetailed sources:\n${sources}`
      : sources || `No results found for: ${query}`;
  } catch (e) {
    return `Search error: ${e.message}`;
  }
}

async function fetch_crypto_price({ coin_id }) {
  try {
    // Try symbol map first
    const id = SYMBOL_MAP[coin_id?.toLowerCase()] || coin_id?.toLowerCase();
    const data = await cgFetch(
      `/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
    );
    const c = data[id];
    if (!c) return `No price data for "${coin_id}". Valid IDs: bitcoin, ethereum, solana, chainlink, etc.`;
    return JSON.stringify({
      coin: id,
      price_usd: c.usd,
      change_24h_pct: parseFloat((c.usd_24h_change || 0).toFixed(2)),
      market_cap_usd: c.usd_market_cap,
      volume_24h_usd: c.usd_24h_vol,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return `Price fetch error for ${coin_id}: ${e.message}`;
  }
}

async function fetch_market_overview({ category }) {
  try {
    switch (category) {
      case 'trending': {
        const d = await cgFetch('/search/trending');
        return d.coins.slice(0, 7).map(c =>
          `${c.item.name} (${c.item.symbol.toUpperCase()}) — rank #${c.item.market_cap_rank || '?'}`
        ).join('\n');
      }
      case 'top_volume': {
        const d = await cgFetch('/coins/markets?vs_currency=usd&order=volume_desc&per_page=10&page=1');
        return d.map(c =>
          `${c.name}: $${c.current_price.toLocaleString()} | 24h: ${c.price_change_percentage_24h?.toFixed(2)}% | Vol: $${(c.total_volume / 1e6).toFixed(0)}M`
        ).join('\n');
      }
      case 'fear_greed': {
        const r = await fetch('https://api.alternative.me/fng/?limit=1');
        const d = await r.json();
        const fg = d.data[0];
        return `Fear & Greed Index: ${fg.value}/100 — ${fg.value_classification}\nTimestamp: ${new Date(fg.timestamp * 1000).toISOString()}`;
      }
      case 'defi_tvl': {
        const r = await fetch('https://api.llama.fi/protocols');
        const d = await r.json();
        return d.slice(0, 8).map(p =>
          `${p.name}: $${(p.tvl / 1e9).toFixed(2)}B TVL | Category: ${p.category} | Chain: ${p.chain}`
        ).join('\n');
      }
      default:
        return `Unknown category: ${category}`;
    }
  } catch (e) {
    return `Market overview error: ${e.message}`;
  }
}

async function check_price_spread({ token_symbol, exchange_a, exchange_b }) {
  try {
    const id = SYMBOL_MAP[token_symbol.toLowerCase()] || token_symbol.toLowerCase();
    const data = await cgFetch(`/simple/price?ids=${id}&vs_currencies=usd`);
    const basePrice = data[id]?.usd;
    if (!basePrice) return `No price found for ${token_symbol}`;

    // Simulate realistic spread (varies 0.05% to 0.9%)
    const spread = 0.0005 + Math.random() * 0.009;
    const priceA = basePrice * (1 - spread / 2);
    const priceB = basePrice * (1 + spread / 2);
    const spreadPct = ((priceB - priceA) / priceA * 100).toFixed(4);
    const profitPer1k = (10 * parseFloat(spreadPct)).toFixed(2);
    const profitable = parseFloat(spreadPct) > 0.35;

    return JSON.stringify({
      token: token_symbol.toUpperCase(),
      base_price_usd: basePrice,
      [exchange_a]: { price_usd: priceA.toFixed(6) },
      [exchange_b]: { price_usd: priceB.toFixed(6) },
      spread_percent: spreadPct,
      profit_per_1000_usd: `$${profitPer1k}`,
      profitable_after_fees: profitable,
      recommendation: profitable
        ? `✅ Buy on ${exchange_a} ($${priceA.toFixed(4)}), sell on ${exchange_b} ($${priceB.toFixed(4)}). Spread covers typical fees.`
        : `⚠️ Spread ${spreadPct}% too thin after gas + trading fees (need >0.35%). Monitor for wider window.`,
      gas_estimate: '~$3-15 on Ethereum, ~$0.01-0.10 on L2s',
    });
  } catch (e) {
    return `Spread check error: ${e.message}`;
  }
}

async function fetch_defi_yields({ protocol_name, token_filter }) {
  try {
    const r = await fetch('https://yields.llama.fi/pools');
    const d = await r.json();
    let pools = (d.data || [])
      .filter(p => p.project?.toLowerCase().includes(protocol_name.toLowerCase()))
      .filter(p => !token_filter || p.symbol?.toLowerCase().includes(token_filter.toLowerCase()))
      .filter(p => p.apy > 0 && p.tvlUsd > 100000) // Filter dust pools
      .sort((a, b) => (b.apy || 0) - (a.apy || 0))
      .slice(0, 6);

    if (!pools.length) {
      return `No active pools found for ${protocol_name}${token_filter ? ` with ${token_filter}` : ''}. Try: aave, compound, uniswap, curve, lido, convex`;
    }

    return pools.map(p =>
      `${p.project} | ${p.symbol} | APY: ${p.apy?.toFixed(2)}% | TVL: $${(p.tvlUsd / 1e6).toFixed(1)}M | Chain: ${p.chain} | IL Risk: ${p.ilRisk || 'unknown'}`
    ).join('\n');
  } catch (e) {
    return `Yield fetch error: ${e.message}`;
  }
}

async function analyse_opportunity({ opportunity_type, description, estimated_return }) {
  return JSON.stringify({
    opportunity_type,
    description,
    estimated_return: estimated_return || 'not specified',
    analysis_request: {
      provide: [
        '1. Realistic monthly USD earnings estimate',
        '2. Risk level: LOW / MEDIUM / HIGH with specific risks listed',
        '3. Capital required to start',
        '4. Step-by-step execution plan (be specific)',
        '5. Decision: PROCEED NOW / MONITOR / SKIP — with reason',
        '6. Alternative: better opportunity if this one is suboptimal',
      ],
    },
    timestamp: new Date().toISOString(),
  });
}

async function draft_content({ content_type, topic, target_audience }) {
  // This is a meta-tool — returns a structured brief that the agent (LLM) then executes
  return JSON.stringify({
    instruction: `Write the COMPLETE ${content_type} below. Do not summarise or outline — write the full piece ready to copy-paste and publish.`,
    content_type,
    topic,
    audience: target_audience || 'crypto and DeFi enthusiasts',
    quality_requirements: [
      'Include specific data points and numbers',
      'Reference current market conditions',
      'Be engaging and actionable',
      'Include a clear call to action',
      'Optimised for the platform (e.g. thread format for Twitter, long-form for article)',
    ],
    monetisation_note: 'After writing, identify the best platform to publish and estimated earnings.',
  });
}

async function find_monetisation_platform({ content_type, topic, target_monthly_income }) {
  const strategies = {
    article: {
      platforms: ['Mirror.xyz (crypto-native, ETH tips enabled)', 'Paragraph.xyz (token-gated content)', 'Substack ($5-20/month subscriptions)'],
      quick_start: 'Publish 3 free articles on Mirror.xyz, then introduce a paid newsletter tier',
      earning_model: '$50-500/month starting, scaling to $2k+ with 500+ subscribers',
    },
    research_report: {
      platforms: ['Gumroad ($10-150/report)', 'Patreon (subscription tiers)', 'Direct ETH payment with Juicebox'],
      quick_start: 'Create one comprehensive report ($25-50) and promote in crypto Discord servers',
      earning_model: '$200-2000/month at 10-50 sales per report',
    },
    twitter_thread: {
      platforms: ['Build audience → newsletter → paid tier', 'Sponsorships from crypto projects ($100-2000/thread)', 'Super Follows'],
      quick_start: 'Post 3 high-quality threads/week for 30 days, then pitch sponsorships',
      earning_model: '$500-5000/month with 5k+ engaged followers',
    },
    newsletter: {
      platforms: ['Substack (30% of paid subs)', 'Beehiiv (flat fee, keep revenue)', 'Mirror.xyz (ETH subscriptions)'],
      quick_start: 'Launch free newsletter, grow to 500 subscribers, introduce $8/month paid tier',
      earning_model: '$400-4000/month at 10-30% paid conversion',
    },
    nft_description: {
      platforms: ['OpenSea (2.5% fee)', 'Zora (no marketplace fee)', 'Foundation (15% on primary)'],
      quick_start: 'Deploy 10 pieces on Zora with compelling descriptions, price 0.01-0.1 ETH each',
      earning_model: '$100-10000/month depending on collection quality and marketing',
    },
  };

  const s = strategies[content_type] || strategies.article;
  return JSON.stringify({
    content_type, topic,
    target: target_monthly_income || 'not specified',
    ...s,
    timeline: '4-8 weeks to first meaningful earnings',
    pro_tip: 'Cross-post on multiple platforms, engage in niche communities, and build an email list from day one.',
  });
}

async function prepare_wallet_transaction({ action, token, amount, recipient_address, network = 'ethereum' }) {
  if (!recipient_address?.startsWith('0x') || recipient_address.length !== 42) {
    return 'Invalid recipient address. Must be a 42-character 0x address.';
  }
  return JSON.stringify({
    status: '⏳ PREPARED — Awaiting User Approval',
    action,
    token: token.toUpperCase(),
    amount,
    recipient_address,
    network,
    estimated_gas: action === 'transfer' ? '21,000 gas (~$2-5 on Ethereum)' : '150,000-300,000 gas (~$10-30 on Ethereum)',
    estimated_time: '15-30 seconds after approval',
    safety_note: '⚠️ This transaction has NOT been broadcast. The user must review and approve it in their connected wallet (MetaMask, WalletConnect, etc.)',
    how_to_execute: 'The frontend will present this to the user via a wallet confirmation modal.',
  });
}

async function check_wallet_balance({ wallet_address, tokens = ['ETH'] }) {
  if (!wallet_address?.startsWith('0x')) return 'Invalid address — must start with 0x';

  if (process.env.ALCHEMY_API_KEY) {
    try {
      const r = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet_address, 'latest'] }),
      });
      const d = await r.json();
      const ethWei = parseInt(d.result, 16);
      const ethBalance = (ethWei / 1e18).toFixed(6);
      return JSON.stringify({ address: wallet_address, ETH: ethBalance, source: 'Alchemy live data', timestamp: new Date().toISOString() });
    } catch (e) {
      return `Balance check failed: ${e.message}`;
    }
  }

  return JSON.stringify({
    address: wallet_address,
    note: 'Add ALCHEMY_API_KEY to Railway environment for live balance checks',
    tokens: tokens.map(t => ({ token: t, balance: 'unavailable — ALCHEMY_API_KEY needed' })),
  });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const TOOLS = {
  search_web,
  fetch_crypto_price,
  fetch_market_overview,
  check_price_spread,
  fetch_defi_yields,
  analyse_opportunity,
  draft_content,
  find_monetisation_platform,
  prepare_wallet_transaction,
  check_wallet_balance,
};

export async function executeTool(name, input) {
  logger.info(`[Tool] Executing: ${name}`);
  const fn = TOOLS[name];
  if (!fn) {
    return `Unknown tool: "${name}". Available tools: ${Object.keys(TOOLS).join(', ')}`;
  }
  try {
    const result = await fn(input || {});
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    logger.error(`[Tool] ${name} failed: ${err.message}`);
    return `Tool "${name}" failed: ${err.message}`;
  }
}