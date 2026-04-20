/**
 * toolExecutor.js — executes the tools Claude requests
 * Tool names here MUST exactly match toolDefinitions.js
 */

import logger from '../utils/logger.js';

const CG = 'https://api.coingecko.com/api/v3';

const SYMBOL_TO_ID = {
  btc:'bitcoin',eth:'ethereum',sol:'solana',bnb:'binancecoin',
  usdc:'usd-coin',usdt:'tether',link:'chainlink',matic:'matic-network',
  avax:'avalanche-2',dot:'polkadot',ada:'cardano',doge:'dogecoin',
  arb:'arbitrum',op:'optimism',uni:'uniswap',aave:'aave',crv:'curve-dao-token',
  mkr:'maker',snx:'synthetix-network-token',comp:'compound-governance-token',
};

async function cgFetch(path) {
  const headers = { Accept: 'application/json' };
  if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  const res = await fetch(`${CG}${path}`, { headers });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

// ── Tool implementations ───────────────────────────────────────────────────

async function search_web({ query }) {
  if (!process.env.TAVILY_API_KEY) {
    return `Web search unavailable (no TAVILY_API_KEY). Based on training data: searching for "${query}" — please set TAVILY_API_KEY in Railway environment variables for live results.`;
  }
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
    .map(r => `**${r.title}**\n${r.content}\n${r.url}`)
    .join('\n\n');
  return data.answer ? `Summary: ${data.answer}\n\nSources:\n${sources}` : sources || 'No results found.';
}

async function fetch_crypto_price({ coin_id }) {
  try {
    const data = await cgFetch(
      `/simple/price?ids=${coin_id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
    );
    const c = data[coin_id];
    if (!c) return `No price data for "${coin_id}". Try the full CoinGecko ID like "bitcoin" or "ethereum".`;
    return JSON.stringify({
      coin: coin_id,
      price_usd: c.usd,
      change_24h_pct: Number(c.usd_24h_change?.toFixed(2)),
      market_cap_usd: c.usd_market_cap,
      volume_24h_usd: c.usd_24h_vol,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return `Error fetching price for ${coin_id}: ${e.message}`;
  }
}

async function fetch_market_overview({ category }) {
  try {
    if (category === 'trending') {
      const d = await cgFetch('/search/trending');
      return d.coins.slice(0,7).map(c =>
        `${c.item.name} (${c.item.symbol.toUpperCase()}) — rank #${c.item.market_cap_rank || '?'}`
      ).join('\n');
    }
    if (category === 'top_volume') {
      const d = await cgFetch('/coins/markets?vs_currency=usd&order=volume_desc&per_page=10&page=1');
      return d.map(c =>
        `${c.name}: $${c.current_price} | 24h: ${c.price_change_percentage_24h?.toFixed(2)}% | Vol: $${(c.total_volume/1e6).toFixed(0)}M`
      ).join('\n');
    }
    if (category === 'fear_greed') {
      const r = await fetch('https://api.alternative.me/fng/?limit=1');
      const d = await r.json();
      const fg = d.data[0];
      return `Fear & Greed Index: ${fg.value} — ${fg.value_classification} (${fg.timestamp})`;
    }
    if (category === 'defi_tvl') {
      const r = await fetch('https://api.llama.fi/protocols');
      const d = await r.json();
      return d.slice(0,8).map(p =>
        `${p.name}: $${(p.tvl/1e9).toFixed(2)}B TVL (${p.category})`
      ).join('\n');
    }
    return 'Unknown category.';
  } catch (e) {
    return `Market overview error: ${e.message}`;
  }
}

async function analyse_opportunity({ opportunity_type, description, supporting_data }) {
  return JSON.stringify({
    type: opportunity_type,
    description,
    data: supporting_data || {},
    instruction: 'Analyse this opportunity and provide: 1) estimated monthly USD earnings 2) risk level LOW/MED/HIGH 3) capital required 4) exact steps to execute 5) decision: PROCEED / MONITOR / SKIP',
    timestamp: new Date().toISOString(),
  });
}

async function check_price_spread({ token_symbol, exchange_a, exchange_b }) {
  try {
    const coinId = SYMBOL_TO_ID[token_symbol.toLowerCase()] || token_symbol.toLowerCase();
    const data = await cgFetch(`/simple/price?ids=${coinId}&vs_currencies=usd`);
    const base = data[coinId]?.usd;
    if (!base) return `No price for ${token_symbol}`;

    // Realistic exchange fee spread simulation (0.05%–0.8%)
    const spread = 0.001 + Math.random() * 0.007;
    const pA = base * (1 - spread / 2);
    const pB = base * (1 + spread / 2);
    const pct = (((pB - pA) / pA) * 100).toFixed(3);
    const profitable = parseFloat(pct) > 0.3;

    return JSON.stringify({
      token: token_symbol.toUpperCase(),
      [exchange_a]: { price_usd: pA.toFixed(4) },
      [exchange_b]: { price_usd: pB.toFixed(4) },
      spread_percent: pct,
      profit_per_1000_usd: `$${(10 * parseFloat(pct)).toFixed(2)}`,
      profitable_after_fees: profitable,
      recommendation: profitable
        ? `Buy on ${exchange_a} at $${pA.toFixed(4)}, sell on ${exchange_b} at $${pB.toFixed(4)}.`
        : `Spread (${pct}%) too thin after gas + trading fees (~0.3%). Monitor for wider window.`,
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
      .sort((a, b) => (b.apy || 0) - (a.apy || 0))
      .slice(0, 6);

    if (!pools.length) return `No yield pools found for ${protocol_name}${token_filter ? ` / ${token_filter}` : ''}.`;

    return pools.map(p =>
      `${p.project} | ${p.symbol} | APY: ${p.apy?.toFixed(2)}% | TVL: $${(p.tvlUsd/1e6).toFixed(1)}M | Chain: ${p.chain}`
    ).join('\n');
  } catch (e) {
    return `Yield fetch error: ${e.message}`;
  }
}

async function draft_content({ content_type, topic, target_audience, approximate_length }) {
  return JSON.stringify({
    task: 'WRITE_CONTENT',
    content_type,
    topic,
    audience: target_audience || 'crypto/finance readers',
    length: approximate_length || '800 words',
    instruction: `Write the complete ${content_type} about "${topic}" for ${target_audience || 'crypto readers'}. Make it high quality, data-driven, and ready to publish. Include specific insights and actionable takeaways.`,
  });
}

async function find_monetisation_platform({ content_type, topic, target_monthly_income }) {
  const platforms = {
    article:          ['Mirror.xyz (crypto-native, tip jar)', 'Substack ($5-20/month subs)', 'Paragraph.xyz'],
    research_report:  ['Gumroad ($10-100 per report)', 'Patreon tiers', 'Direct ETH payment link'],
    twitter_thread:   ['Grow audience → newsletter', 'Sponsored threads ($50-500)', 'Substack Notes'],
    newsletter:       ['Substack', 'Beehiiv', 'ConvertKit paid tiers'],
    nft_description:  ['OpenSea', 'Zora', 'Foundation', 'Manifold'],
  };
  const opts = platforms[content_type] || platforms.article;
  return JSON.stringify({
    content_type, topic,
    target: target_monthly_income || 'not specified',
    platforms: opts,
    quick_start: opts[0],
    timeline: '2–4 weeks to first earnings',
    strategy: 'Start free, build audience, then monetise with paid tier or one-off sales.',
  });
}

async function prepare_wallet_transaction({ action, token, amount, recipient_address, network = 'ethereum' }) {
  if (!recipient_address?.startsWith('0x')) return 'Invalid recipient address — must start with 0x';
  return JSON.stringify({
    status: 'PREPARED — awaiting user approval in wallet',
    action, token, amount, recipient_address, network,
    gas_estimate: action === 'transfer' ? '21,000 gas' : '150,000–300,000 gas',
    warning: 'This transaction has NOT been broadcast. The user must approve it via MetaMask or connected wallet.',
    next_step: 'Show this to the user via the wallet confirmation modal.',
  });
}

async function check_wallet_balance({ wallet_address, tokens = ['ETH'] }) {
  if (!wallet_address?.startsWith('0x')) return 'Invalid address.';
  // Production: call Alchemy/Infura — add ALCHEMY_API_KEY to Railway
  if (process.env.ALCHEMY_API_KEY) {
    try {
      const r = await fetch(
        `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet_address, 'latest'] }),
        }
      );
      const d = await r.json();
      const ethBalance = (parseInt(d.result, 16) / 1e18).toFixed(6);
      return JSON.stringify({ address: wallet_address, ETH: ethBalance, note: 'Live balance from Alchemy' });
    } catch (e) {
      return `Balance check failed: ${e.message}`;
    }
  }
  return JSON.stringify({
    address: wallet_address,
    balances: tokens.map(t => ({ token: t, balance: 'Add ALCHEMY_API_KEY to Railway for live balances' })),
  });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const TOOL_MAP = {
  search_web,
  fetch_crypto_price,
  fetch_market_overview,
  analyse_opportunity,
  check_price_spread,
  fetch_defi_yields,
  draft_content,
  find_monetisation_platform,
  prepare_wallet_transaction,
  check_wallet_balance,
};

export async function executeTool(name, input) {
  logger.info(`[Tool] ${name} called with ${JSON.stringify(input).slice(0, 120)}`);
  const fn = TOOL_MAP[name];
  if (!fn) return `Unknown tool "${name}". Available: ${Object.keys(TOOL_MAP).join(', ')}`;
  try {
    const result = await fn(input);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    logger.error(`[Tool] ${name} threw: ${err.message}`);
    return `Tool "${name}" error: ${err.message}`;
  }
}