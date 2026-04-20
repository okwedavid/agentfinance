/**
 * toolDefinitions.js
 *
 * IMPORTANT: Tool names must:
 * - Use only letters, numbers, underscores (no hyphens, no spaces)
 * - Not clash with Anthropic built-in tool names (web_search, computer etc)
 * - Have clear, specific descriptions so Claude picks the right tool
 *
 * We prefix custom tools with nothing but keep names unambiguous.
 */

export const researchTools = [
  {
    name: 'search_web',
    description: 'Search the internet for current information about crypto markets, prices, news, or financial topics. Use this to get real-time data.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string, e.g. "bitcoin price today" or "best DeFi yields April 2026"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_crypto_price',
    description: 'Get the current USD price, 24h % change, and market cap for a specific cryptocurrency by its CoinGecko ID.',
    input_schema: {
      type: 'object',
      properties: {
        coin_id: {
          type: 'string',
          description: 'CoinGecko coin ID. Examples: bitcoin, ethereum, solana, chainlink, uniswap, aave, matic-network',
        },
      },
      required: ['coin_id'],
    },
  },
  {
    name: 'fetch_market_overview',
    description: 'Get a market-wide overview: trending coins, top volume coins, DeFi TVL rankings, or the Fear & Greed index.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['trending', 'top_volume', 'defi_tvl', 'fear_greed'],
          description: 'Which market overview to fetch',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'analyse_opportunity',
    description: 'Structure and analyse a financial opportunity (arbitrage, yield, content sale, freelance). Returns a formatted analysis prompt for Claude to reason over.',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_type: {
          type: 'string',
          enum: ['arbitrage', 'yield_farming', 'content_sale', 'freelance'],
        },
        description: { type: 'string', description: 'Describe the opportunity in plain text' },
        supporting_data: { type: 'object', description: 'Any numbers or data you have' },
      },
      required: ['opportunity_type', 'description'],
    },
  },
];

export const tradingTools = [
  ...researchTools,
  {
    name: 'check_price_spread',
    description: 'Compare the price of a token across two exchanges and estimate potential arbitrage profit after fees.',
    input_schema: {
      type: 'object',
      properties: {
        token_symbol: { type: 'string', description: 'Token symbol, e.g. ETH, BTC, SOL, LINK' },
        exchange_a: { type: 'string', description: 'First exchange name, e.g. binance, coinbase, kraken' },
        exchange_b: { type: 'string', description: 'Second exchange name, e.g. uniswap, bybit, okx' },
      },
      required: ['token_symbol', 'exchange_a', 'exchange_b'],
    },
  },
  {
    name: 'fetch_defi_yields',
    description: 'Fetch current APY and TVL for a DeFi protocol. Use this to find yield farming or liquidity provision opportunities.',
    input_schema: {
      type: 'object',
      properties: {
        protocol_name: { type: 'string', description: 'Protocol name, e.g. aave, compound, uniswap, curve, lido' },
        token_filter: { type: 'string', description: 'Optional: filter by token symbol, e.g. ETH, USDC' },
      },
      required: ['protocol_name'],
    },
  },
];

export const contentTools = [
  ...researchTools,
  {
    name: 'draft_content',
    description: 'Generate a full piece of monetisable content: crypto article, newsletter, Twitter/X thread, research report, or NFT description.',
    input_schema: {
      type: 'object',
      properties: {
        content_type: {
          type: 'string',
          enum: ['article', 'twitter_thread', 'newsletter', 'research_report', 'nft_description'],
        },
        topic: { type: 'string', description: 'The topic or title' },
        target_audience: { type: 'string', description: 'Who this is for, e.g. "crypto beginners", "DeFi investors"' },
        approximate_length: { type: 'string', description: 'e.g. "800 words", "10 tweets", "500 words"' },
      },
      required: ['content_type', 'topic'],
    },
  },
  {
    name: 'find_monetisation_platform',
    description: 'Find the best platform and pricing strategy to sell a piece of content or skill online for crypto or fiat.',
    input_schema: {
      type: 'object',
      properties: {
        content_type: { type: 'string', description: 'Type of content: article, report, course, thread, etc.' },
        topic: { type: 'string', description: 'What the content is about' },
        target_monthly_income: { type: 'string', description: 'Target monthly income, e.g. "$500/month"' },
      },
      required: ['content_type', 'topic'],
    },
  },
];

export const executionTools = [
  ...tradingTools,
  {
    name: 'prepare_wallet_transaction',
    description: 'Prepare (DO NOT send) an ERC-20 transfer or token swap. Returns unsigned transaction data for the user to review and approve in their wallet.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['transfer', 'swap'], description: 'Type of transaction' },
        token: { type: 'string', description: 'Token symbol or contract address, e.g. ETH, USDC' },
        amount: { type: 'string', description: 'Amount as string, e.g. "0.1"' },
        recipient_address: { type: 'string', description: '0x wallet address to send to' },
        network: { type: 'string', enum: ['ethereum', 'polygon', 'base', 'arbitrum', 'optimism'], default: 'ethereum' },
      },
      required: ['action', 'token', 'amount', 'recipient_address'],
    },
  },
  {
    name: 'check_wallet_balance',
    description: 'Check the ETH and token balances for a given wallet address.',
    input_schema: {
      type: 'object',
      properties: {
        wallet_address: { type: 'string', description: '0x Ethereum wallet address' },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of token symbols to check, e.g. ["ETH", "USDC", "LINK"]',
        },
      },
      required: ['wallet_address'],
    },
  },
];

export const toolsByAgentType = {
  research:    researchTools,
  trading:     tradingTools,
  content:     contentTools,
  execution:   executionTools,
  coordinator: researchTools,
};