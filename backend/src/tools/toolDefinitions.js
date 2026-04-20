/**
 * toolDefinitions.js — Groq/OpenAI tool format
 *
 * CRITICAL: Groq requires the OpenAI tool schema format:
 * {
 *   type: "function",
 *   function: {
 *     name: string,
 *     description: string,
 *     parameters: { type: "object", properties: {...}, required: [...] }
 *   }
 * }
 *
 * NOT the Anthropic format (no input_schema, no top-level name/description).
 */

const tool = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

// ── Tool library ─────────────────────────────────────────────────────────────

const SEARCH_WEB = tool(
  'search_web',
  'Search the internet for real-time information about crypto prices, DeFi opportunities, market news, or any financial topic.',
  { query: { type: 'string', description: 'Search query, e.g. "best DeFi yield April 2026" or "bitcoin price today"' } },
  ['query']
);

const FETCH_CRYPTO_PRICE = tool(
  'fetch_crypto_price',
  'Get the current USD price, 24h percentage change, and market cap for a cryptocurrency by CoinGecko ID.',
  {
    coin_id: {
      type: 'string',
      description: 'CoinGecko coin ID. Use lowercase: bitcoin, ethereum, solana, chainlink, uniswap, aave, matic-network, avalanche-2, polkadot, arbitrum',
    },
  },
  ['coin_id']
);

const FETCH_MARKET_OVERVIEW = tool(
  'fetch_market_overview',
  'Get a crypto market overview: trending coins, top volume coins, DeFi TVL rankings, or Fear & Greed index.',
  {
    category: {
      type: 'string',
      enum: ['trending', 'top_volume', 'defi_tvl', 'fear_greed'],
      description: 'Type of market data to fetch',
    },
  },
  ['category']
);

const CHECK_PRICE_SPREAD = tool(
  'check_price_spread',
  'Compare token price across two exchanges and estimate arbitrage profit potential after fees.',
  {
    token_symbol: { type: 'string', description: 'Token symbol: ETH, BTC, SOL, LINK, MATIC, etc.' },
    exchange_a: { type: 'string', description: 'First exchange: binance, coinbase, kraken, okx' },
    exchange_b: { type: 'string', description: 'Second exchange: uniswap, bybit, kucoin, htx' },
  },
  ['token_symbol', 'exchange_a', 'exchange_b']
);

const FETCH_DEFI_YIELDS = tool(
  'fetch_defi_yields',
  'Fetch current APY rates and TVL for DeFi protocols. Use this to find yield farming or staking opportunities.',
  {
    protocol_name: { type: 'string', description: 'Protocol: aave, compound, uniswap, curve, lido, convex, yearn' },
    token_filter: { type: 'string', description: 'Optional token filter: ETH, USDC, USDT, WBTC' },
  },
  ['protocol_name']
);

const ANALYSE_OPPORTUNITY = tool(
  'analyse_opportunity',
  'Structure and score a financial opportunity for monetisation potential. Returns analysis framework.',
  {
    opportunity_type: {
      type: 'string',
      enum: ['arbitrage', 'yield_farming', 'content_sale', 'freelance', 'staking', 'liquidity_provision'],
    },
    description: { type: 'string', description: 'Plain text description of the opportunity' },
    estimated_return: { type: 'string', description: 'Estimated return, e.g. "8% APY" or "$200/month"' },
  },
  ['opportunity_type', 'description']
);

const DRAFT_CONTENT = tool(
  'draft_content',
  'Write a complete piece of monetisable crypto/finance content ready to publish.',
  {
    content_type: {
      type: 'string',
      enum: ['article', 'twitter_thread', 'newsletter', 'research_report', 'nft_description'],
    },
    topic: { type: 'string', description: 'Topic or title' },
    target_audience: { type: 'string', description: 'Target readers, e.g. "DeFi investors", "crypto beginners"' },
  },
  ['content_type', 'topic']
);

const FIND_MONETISATION = tool(
  'find_monetisation_platform',
  'Find the best platform and pricing strategy to sell content or skills for crypto/fiat income.',
  {
    content_type: { type: 'string', description: 'article, report, course, twitter_thread, newsletter, nft' },
    topic: { type: 'string', description: 'What the content covers' },
    target_monthly_income: { type: 'string', description: 'Income goal, e.g. "$500/month"' },
  },
  ['content_type', 'topic']
);

const PREPARE_TRANSACTION = tool(
  'prepare_wallet_transaction',
  'Prepare (NEVER auto-send) an ERC-20 transfer or token swap. Returns unsigned tx for user approval.',
  {
    action: { type: 'string', enum: ['transfer', 'swap'] },
    token: { type: 'string', description: 'Token symbol: ETH, USDC, LINK, etc.' },
    amount: { type: 'string', description: 'Amount as string: "0.1", "100"' },
    recipient_address: { type: 'string', description: '0x wallet address' },
    network: { type: 'string', enum: ['ethereum', 'polygon', 'base', 'arbitrum', 'optimism'], default: 'ethereum' },
  },
  ['action', 'token', 'amount', 'recipient_address']
);

const CHECK_WALLET_BALANCE = tool(
  'check_wallet_balance',
  'Check ETH and ERC-20 token balances for a wallet address.',
  {
    wallet_address: { type: 'string', description: '0x Ethereum wallet address' },
    tokens: { type: 'array', items: { type: 'string' }, description: 'Token symbols to check: ["ETH","USDC","LINK"]' },
  },
  ['wallet_address']
);

// ── Agent tool sets ───────────────────────────────────────────────────────────

export const toolsByAgentType = {
  research:    [SEARCH_WEB, FETCH_CRYPTO_PRICE, FETCH_MARKET_OVERVIEW, ANALYSE_OPPORTUNITY],
  trading:     [SEARCH_WEB, FETCH_CRYPTO_PRICE, FETCH_MARKET_OVERVIEW, CHECK_PRICE_SPREAD, FETCH_DEFI_YIELDS, ANALYSE_OPPORTUNITY],
  content:     [SEARCH_WEB, FETCH_CRYPTO_PRICE, FETCH_MARKET_OVERVIEW, DRAFT_CONTENT, FIND_MONETISATION],
  execution:   [FETCH_CRYPTO_PRICE, FETCH_MARKET_OVERVIEW, CHECK_PRICE_SPREAD, FETCH_DEFI_YIELDS, CHECK_WALLET_BALANCE, PREPARE_TRANSACTION],
  coordinator: [SEARCH_WEB, FETCH_CRYPTO_PRICE, FETCH_MARKET_OVERVIEW, ANALYSE_OPPORTUNITY],
};