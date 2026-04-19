/**
 * Tool definitions for each agent type.
 * Each tool maps directly to Anthropic's tool-use API format.
 * Agents only receive the tools they are authorised to call — least-privilege model.
 */

export const researchTools = [
  {
    name: 'web_search',
    description: 'Search the web for current information, prices, news, or data.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        max_results: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_crypto_price',
    description: 'Get the current price and 24h change for a cryptocurrency.',
    input_schema: {
      type: 'object',
      properties: {
        coin_id: { type: 'string', description: 'CoinGecko coin ID e.g. bitcoin, ethereum, solana' },
      },
      required: ['coin_id'],
    },
  },
  {
    name: 'get_market_data',
    description: 'Get top crypto markets by volume, trending coins, or DeFi TVL data.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['trending', 'top_volume', 'defi_tvl', 'fear_greed'],
          description: 'Type of market data to fetch',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'analyze_opportunity',
    description: 'Analyze a financial or content opportunity and return a structured report with estimated earnings, risk level, and recommended action.',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_type: {
          type: 'string',
          enum: ['arbitrage', 'yield_farming', 'content_sale', 'freelance_task'],
        },
        description: { type: 'string', description: 'What the opportunity is' },
        data: { type: 'object', description: 'Any supporting data' },
      },
      required: ['opportunity_type', 'description'],
    },
  },
];

export const tradingTools = [
  ...researchTools,
  {
    name: 'get_token_price',
    description: 'Get real-time price of any ERC-20 token from CoinGecko.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Token symbol e.g. ETH, USDC, LINK' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'check_arbitrage',
    description: 'Check price difference of a token across two exchanges and calculate potential arbitrage profit.',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol' },
        exchange_a: { type: 'string', description: 'First exchange e.g. binance, coinbase' },
        exchange_b: { type: 'string', description: 'Second exchange e.g. uniswap, kraken' },
      },
      required: ['token', 'exchange_a', 'exchange_b'],
    },
  },
  {
    name: 'estimate_yield',
    description: 'Estimate current APY for a DeFi protocol pool.',
    input_schema: {
      type: 'object',
      properties: {
        protocol: { type: 'string', description: 'DeFi protocol name e.g. aave, compound, uniswap-v3' },
        pair: { type: 'string', description: 'Token pair e.g. ETH/USDC' },
      },
      required: ['protocol'],
    },
  },
];

export const contentTools = [
  ...researchTools,
  {
    name: 'write_content',
    description: 'Write a piece of content (article, newsletter, thread, report) optimised for a specific platform and audience.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['article', 'twitter_thread', 'newsletter', 'research_report', 'nft_description'],
        },
        topic: { type: 'string', description: 'Topic or title of the content' },
        audience: { type: 'string', description: 'Target audience' },
        word_count: { type: 'number', description: 'Approximate word count' },
      },
      required: ['type', 'topic'],
    },
  },
  {
    name: 'find_monetization',
    description: 'Find the best platform and pricing to sell a piece of content or skill.',
    input_schema: {
      type: 'object',
      properties: {
        content_type: { type: 'string' },
        topic: { type: 'string' },
        target_earnings: { type: 'string', description: 'Desired earnings e.g. $50/month' },
      },
      required: ['content_type', 'topic'],
    },
  },
];

export const executionTools = [
  ...tradingTools,
  {
    name: 'prepare_transaction',
    description: 'Prepare (but do NOT send) an ERC-20 transfer or swap transaction. Returns the unsigned tx for user approval.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['transfer', 'swap'] },
        token: { type: 'string', description: 'Token symbol or contract address' },
        amount: { type: 'string', description: 'Amount as a string to avoid float errors' },
        to_address: { type: 'string', description: 'Destination wallet address' },
        chain: { type: 'string', enum: ['ethereum', 'polygon', 'base', 'arbitrum'], default: 'ethereum' },
      },
      required: ['action', 'token', 'amount', 'to_address'],
    },
  },
  {
    name: 'get_wallet_balance',
    description: 'Get the ETH and ERC-20 token balances for a wallet address.',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Ethereum wallet address' },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of token symbols to check e.g. ["ETH","USDC","LINK"]',
        },
      },
      required: ['address'],
    },
  },
];

export const toolsByAgentType = {
  research: researchTools,
  trading: tradingTools,
  content: contentTools,
  execution: executionTools,
  coordinator: [...researchTools],
};