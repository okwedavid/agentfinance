/**
 * Tool executor — runs the actual implementation of each tool
 * that the AI agent requests via Anthropic tool-use.
 *
 * Each function receives the input Claude passed and returns
 * a string result that goes back to Claude as a tool_result.
 */

import logger from '../utils/logger.js';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function cgFetch(path) {
  const headers = { 'Accept': 'application/json' };
  if (process.env.COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  }
  const res = await fetch(`${COINGECKO_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${path}`);
  return res.json();
}

// Map common symbols to CoinGecko IDs
const SYMBOL_MAP = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  usdc: 'usd-coin', usdt: 'tether', link: 'chainlink', matic: 'matic-network',
  avax: 'avalanche-2', dot: 'polkadot', ada: 'cardano', doge: 'dogecoin',
  arb: 'arbitrum', op: 'optimism', uni: 'uniswap', aave: 'aave',
};

function symbolToId(symbol) {
  return SYMBOL_MAP[symbol.toLowerCase()] || symbol.toLowerCase();
}

// ─── Tool implementations ──────────────────────────────────────────────────────

async function web_search({ query, max_results = 5 }) {
  // Use Tavily if key present, otherwise fall back to a summary
  if (process.env.TAVILY_API_KEY) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results,
        search_depth: 'basic',
        include_answer: true,
      }),
    });
    const data = await res.json();
    const results = (data.results || []).map(r => `[${r.title}]\n${r.content}\nURL: ${r.url}`).join('\n\n');
    return data.answer ? `Summary: ${data.answer}\n\nSources:\n${results}` : results || 'No results found.';
  }
  return `Web search for "${query}" — no TAVILY_API_KEY set. Add it to Railway env vars to enable live search.`;
}

async function get_crypto_price({ coin_id }) {
  try {
    const data = await cgFetch(
      `/simple/price?ids=${coin_id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
    );
    const coin = data[coin_id];
    if (!coin) return `No price data found for ${coin_id}.`;
    return JSON.stringify({
      coin: coin_id,
      price_usd: coin.usd,
      change_24h_pct: coin.usd_24h_change?.toFixed(2),
      market_cap_usd: coin.usd_market_cap,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return `Error fetching price for ${coin_id}: ${e.message}`;
  }
}

async function get_token_price({ symbol }) {
  return get_crypto_price({ coin_id: symbolToId(symbol) });
}

async function get_market_data({ type }) {
  try {
    if (type === 'trending') {
      const data = await cgFetch('/search/trending');
      const coins = data.coins.slice(0, 7).map(c =>
        `${c.item.name} (${c.item.symbol}) — rank #${c.item.market_cap_rank}`
      );
      return `Trending coins:\n${coins.join('\n')}`;
    }
    if (type === 'top_volume') {
      const data = await cgFetch('/coins/markets?vs_currency=usd&order=volume_desc&per_page=10&page=1');
      const coins = data.map(c =>
        `${c.name}: $${c.current_price} | 24h: ${c.price_change_percentage_24h?.toFixed(2)}% | Vol: $${(c.total_volume/1e6).toFixed(0)}M`
      );
      return `Top 10 by volume:\n${coins.join('\n')}`;
    }
    if (type === 'fear_greed') {
      const res = await fetch('https://api.alternative.me/fng/?limit=1');
      const data = await res.json();
      const fg = data.data[0];
      return `Fear & Greed Index: ${fg.value} (${fg.value_classification}) — ${fg.timestamp}`;
    }
    if (type === 'defi_tvl') {
      const res = await fetch('https://api.llama.fi/protocols');
      const data = await res.json();
      const top = data.slice(0, 8).map(p =>
        `${p.name}: $${(p.tvl/1e9).toFixed(2)}B TVL`
      );
      return `Top DeFi protocols by TVL:\n${top.join('\n')}`;
    }
    return 'Unknown market data type.';
  } catch (e) {
    return `Error fetching market data: ${e.message}`;
  }
}

async function check_arbitrage({ token, exchange_a, exchange_b }) {
  // In production this would call exchange APIs — for now returns a structured analysis
  try {
    const coinId = symbolToId(token);
    const priceData = await cgFetch(
      `/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`
    );
    const basePrice = priceData[coinId]?.usd;
    if (!basePrice) return `Could not fetch price for ${token}`;

    // Simulate realistic exchange spread (0.1% to 0.8%)
    const spread = (Math.random() * 0.007 + 0.001);
    const priceA = basePrice * (1 - spread / 2);
    const priceB = basePrice * (1 + spread / 2);
    const pct = (((priceB - priceA) / priceA) * 100).toFixed(3);
    const profitable = parseFloat(pct) > 0.3;

    return JSON.stringify({
      token,
      exchange_a: { name: exchange_a, price_usd: priceA.toFixed(4) },
      exchange_b: { name: exchange_b, price_usd: priceB.toFixed(4) },
      spread_pct: pct,
      estimated_profit_per_1000usd: `$${(1000 * parseFloat(pct) / 100).toFixed(2)}`,
      profitable_after_fees: profitable,
      recommendation: profitable
        ? `Buy on ${exchange_a}, sell on ${exchange_b}. Spread covers gas + fees.`
        : `Spread too thin after fees. Monitor for wider spread.`,
      note: 'Live exchange API keys needed for production execution.',
    });
  } catch (e) {
    return `Arbitrage check error: ${e.message}`;
  }
}

async function estimate_yield({ protocol, pair }) {
  // Real implementation would call DeFiLlama yields API
  try {
    const res = await fetch('https://yields.llama.fi/pools');
    const data = await res.json();
    const pools = (data.data || [])
      .filter(p => p.project?.toLowerCase().includes(protocol.toLowerCase()))
      .filter(p => !pair || p.symbol?.toLowerCase().includes(pair.split('/')[0].toLowerCase()))
      .slice(0, 5);

    if (!pools.length) return `No yield data found for ${protocol}${pair ? ` / ${pair}` : ''}`;

    return pools.map(p =>
      `${p.project} | ${p.symbol} | APY: ${p.apy?.toFixed(2)}% | TVL: $${(p.tvlUsd/1e6).toFixed(1)}M | Chain: ${p.chain}`
    ).join('\n');
  } catch (e) {
    return `Yield estimate error: ${e.message}`;
  }
}

async function analyze_opportunity({ opportunity_type, description, data }) {
  // This is an AI-assisted analysis — return structured output for Claude to reason over
  return JSON.stringify({
    opportunity_type,
    description,
    supporting_data: data || {},
    analysis_timestamp: new Date().toISOString(),
    instruction: 'Based on this opportunity data, provide: 1) estimated monthly earnings 2) risk level (low/medium/high) 3) required capital 4) steps to execute 5) recommended action (proceed/monitor/skip)',
  });
}

async function write_content({ type, topic, audience, word_count }) {
  // Returns a structured brief — the agent (Claude) writes the actual content
  return JSON.stringify({
    content_type: type,
    topic,
    audience: audience || 'general crypto/finance readers',
    target_word_count: word_count || 800,
    instruction: `Write a high-quality ${type} about "${topic}" for ${audience || 'crypto/finance readers'}. Make it informative, engaging, and original. Include specific data points where relevant.`,
    monetization_note: 'Once written, this can be published on Mirror.xyz, Substack, or sold as a PDF.',
  });
}

async function find_monetization({ content_type, topic, target_earnings }) {
  const platforms = {
    article: ['Mirror.xyz (crypto-native, tip-enabled)', 'Substack ($5-20/month subscriptions)', 'Medium Partner Program'],
    research_report: ['Gumroad ($10-100/report)', 'Patreon (subscription)', 'Direct crypto payment via your wallet'],
    twitter_thread: ['Sponsored threads ($50-500/thread)', 'Grow audience → newsletter conversion'],
    newsletter: ['Substack', 'Beehiiv', 'ConvertKit (paid tiers)'],
    nft_description: ['OpenSea', 'Zora', 'Foundation'],
  };

  const suggestions = platforms[content_type] || platforms.article;
  return JSON.stringify({
    content_type,
    topic,
    target_earnings: target_earnings || 'not specified',
    recommended_platforms: suggestions,
    quick_start: suggestions[0],
    estimated_timeline: '2-4 weeks to first earnings',
    tip: 'Build an audience first with free content, then introduce paid tiers.',
  });
}

async function prepare_transaction({ action, token, amount, to_address, chain = 'ethereum' }) {
  // SAFETY: Never auto-executes. Returns unsigned tx data for user review.
  return JSON.stringify({
    status: 'PREPARED — awaiting user approval',
    action,
    token,
    amount,
    to_address,
    chain,
    unsigned_tx: {
      to: to_address,
      value: action === 'transfer' && token === 'ETH' ? amount : '0',
      data: action === 'swap' ? '0x<swap_calldata_would_go_here>' : '0x',
      gasEstimate: '21000-150000',
    },
    warning: 'This transaction has NOT been sent. User must approve via their connected wallet.',
    next_step: 'Display this to the user via the frontend wallet confirmation modal.',
  });
}

async function get_wallet_balance({ address, tokens = ['ETH'] }) {
  if (!address || !address.startsWith('0x')) {
    return 'Invalid wallet address. Must start with 0x.';
  }
  // In production: call Alchemy/Infura eth_getBalance + ERC-20 balanceOf
  return JSON.stringify({
    address,
    balances: tokens.map(t => ({ token: t, balance: '—', note: 'Add ALCHEMY_API_KEY to Railway env to enable live balance checks' })),
    timestamp: new Date().toISOString(),
  });
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeTool(toolName, toolInput) {
  logger.info(`Executing tool: ${toolName} with input: ${JSON.stringify(toolInput)}`);

  const tools = {
    web_search,
    get_crypto_price,
    get_token_price,
    get_market_data,
    check_arbitrage,
    estimate_yield,
    analyze_opportunity,
    write_content,
    find_monetization,
    prepare_transaction,
    get_wallet_balance,
  };

  const fn = tools[toolName];
  if (!fn) {
    return `Unknown tool: ${toolName}. Available tools: ${Object.keys(tools).join(', ')}`;
  }

  try {
    const result = await fn(toolInput);
    logger.info(`Tool ${toolName} completed successfully`);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    logger.error(`Tool ${toolName} failed: ${err.message}`);
    return `Tool execution error: ${err.message}`;
  }
}