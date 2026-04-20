/**
 * Tool definitions formatted for Groq / OpenAI compatibility.
 */

// Helper to convert Anthropic format to Groq/OpenAI format
const formatTool = (tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
});

const researchToolsRaw = [
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
    description: 'Analyze a financial or content opportunity and return a structured report.',
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

const tradingToolsRaw = [
  ...researchToolsRaw,
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
    description: 'Check price difference across exchanges.',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol' },
        exchange_a: { type: 'string', description: 'First exchange' },
        exchange_b: { type: 'string', description: 'Second exchange' },
      },
      required: ['token', 'exchange_a', 'exchange_b'],
    },
  },
];

const contentToolsRaw = [
  ...researchToolsRaw,
  {
    name: 'write_content',
    description: 'Write optimized content for a specific platform.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['article', 'twitter_thread', 'newsletter', 'research_report'] },
        topic: { type: 'string' },
        audience: { type: 'string' },
      },
      required: ['type', 'topic'],
    },
  },
];

const executionToolsRaw = [
  ...tradingToolsRaw,
  {
    name: 'prepare_transaction',
    description: 'Prepare an ERC-20 transfer or swap.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['transfer', 'swap'] },
        token: { type: 'string' },
        amount: { type: 'string' },
        to_address: { type: 'string' },
      },
      required: ['action', 'token', 'amount', 'to_address'],
    },
  },
];

// Export properly formatted tools
export const researchTools = researchToolsRaw.map(formatTool);
export const tradingTools = tradingToolsRaw.map(formatTool);
export const contentTools = contentToolsRaw.map(formatTool);
export const executionTools = executionToolsRaw.map(formatTool);

export const toolsByAgentType = {
  research: researchTools,
  trading: tradingTools,
  content: contentTools,
  execution: executionTools,
  coordinator: researchTools,
};
