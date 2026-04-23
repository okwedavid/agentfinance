/**
 * agentRunner.js
 * Uses ALL your API keys with intelligent cascade fallback.
 * Priority: Groq → Google Gemini → Anthropic → OpenRouter → Together → Mistral → Cerebras
 *
 * This prevents rate limits because when one provider hits its limit,
 * it automatically tries the next one.
 */
import { executeTool as executeStructuredTool } from '../tools/toolExecutor.js';

// ── Provider configs ────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    name: 'Groq',
    apiKey: () => process.env.GROQ_API_KEY,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    format: 'openai',
    maxTokens: 4096,
  },
  {
    name: 'Google',
    apiKey: () => process.env.GOOGLE_AI_API_KEY,
    url: () => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`,
    model: 'gemini-2.0-flash',
    format: 'google',
    maxTokens: 4096,
  },
  {
    name: 'Anthropic',
    apiKey: () => process.env.ANTHROPIC_API_KEY,
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    format: 'anthropic',
    maxTokens: 4096,
  },
  {
    name: 'OpenRouter',
    apiKey: () => process.env.OPENROUTER_API_KEY,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    format: 'openai',
    maxTokens: 2048,
  },
  {
    name: 'Together',
    apiKey: () => process.env.TOGETHER_API_KEY,
    url: 'https://api.together.xyz/v1/chat/completions',
    model: 'meta-llama/Llama-3-8b-chat-hf',
    format: 'openai',
    maxTokens: 2048,
  },
  {
    name: 'Mistral',
    apiKey: () => process.env.MISTRAL_API_KEY,
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    format: 'openai',
    maxTokens: 2048,
  },
  {
    name: 'Cerebras',
    apiKey: () => process.env.CEREBRAS_API_KEY,
    url: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'llama3.1-8b',
    format: 'openai',
    maxTokens: 2048,
  },
];

// ── Tool definitions for agent use ──────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for current information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_crypto_price',
      description: 'Get current price and 24h change for a cryptocurrency',
      parameters: {
        type: 'object',
        properties: {
          coin: { type: 'string', description: 'Coin ID e.g. bitcoin, ethereum, solana' },
        },
        required: ['coin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_defi_yields',
      description: 'Get current DeFi yield rates from major protocols',
      parameters: {
        type: 'object',
        properties: {
          protocol: { type: 'string', description: 'Protocol name e.g. aave, compound, curve, yearn' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_market_overview',
      description: 'Get crypto market overview including top gainers and fear/greed index',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyse_opportunity',
      description: 'Analyse and score a potential income opportunity',
      parameters: {
        type: 'object',
        properties: {
          opportunity: { type: 'string', description: 'Description of the opportunity' },
          risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
          estimated_apy: { type: 'number', description: 'Estimated APY percentage' },
        },
        required: ['opportunity'],
      },
    },
  },
];

function safeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name, args) {
  try {
    switch (name) {
      case 'search_web': {
        const key = process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY;
        if (!key) return { result: `Search unavailable (add TAVILY_API_KEY). Query was: ${args.query}` };

        if (process.env.TAVILY_API_KEY) {
          const r = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: args.query, max_results: 5 }),
            signal: AbortSignal.timeout(8000),
          });
          const d = await r.json();
          const results = (d.results || []).slice(0, 3).map(r => `• ${r.title}: ${r.content?.slice(0, 200)}`).join('\n');
          return { result: results || 'No results found' };
        }

        if (process.env.SERPER_API_KEY) {
          const r = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY },
            body: JSON.stringify({ q: args.query }),
            signal: AbortSignal.timeout(8000),
          });
          const d = await r.json();
          const snippets = (d.organic || []).slice(0, 3).map(r => `• ${r.title}: ${r.snippet}`).join('\n');
          return { result: snippets };
        }
        break;
      }

      case 'fetch_crypto_price': {
        const coin = args.coin?.toLowerCase().replace(' ', '-') || 'bitcoin';
        let url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true`;
        const headers = {};
        if (process.env.COINGECKO_API_KEY) {
          headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
        }
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
        const d = await r.json();
        if (d[coin]) {
          return {
            result: `${coin.toUpperCase()} price: $${d[coin].usd?.toLocaleString()} | 24h change: ${d[coin].usd_24h_change?.toFixed(2)}%`
          };
        }
        // Try CMC fallback
        if (process.env.CMC_API_KEY) {
          const cmcR = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${coin.toUpperCase()}`, {
            headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY },
            signal: AbortSignal.timeout(5000),
          });
          const cmcD = await cmcR.json();
          const quote = Object.values(cmcD.data || {})[0];
          if (quote) {
            return { result: `${coin.toUpperCase()}: $${quote.quote?.USD?.price?.toFixed(2)} | 24h: ${quote.quote?.USD?.percent_change_24h?.toFixed(2)}%` };
          }
        }
        return { result: `Price data unavailable for ${coin}` };
      }

      case 'fetch_defi_yields': {
        // DeFiLlama - completely free, no key needed
        const r = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        const pools = (d.data || [])
          .filter(p => p.apy > 0 && p.tvlUsd > 1_000_000)
          .sort((a, b) => b.apy - a.apy)
          .slice(0, 8)
          .map(p => `• ${p.project} ${p.symbol}: ${p.apy.toFixed(2)}% APY (TVL: $${(p.tvlUsd/1e6).toFixed(1)}M)`);
        return { result: pools.join('\n') || 'No yield data available' };
      }

      case 'fetch_market_overview': {
        const [fearRes, globalRes] = await Promise.allSettled([
          fetch('https://api.alternative.me/fng/', { signal: AbortSignal.timeout(5000) }),
          fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(5000) }),
        ]);

        let fear = 'Unknown';
        if (fearRes.status === 'fulfilled') {
          const fd = await fearRes.value.json();
          fear = `${fd.data?.[0]?.value_classification} (${fd.data?.[0]?.value}/100)`;
        }

        let globalInfo = '';
        if (globalRes.status === 'fulfilled') {
          const gd = await globalRes.value.json();
          const m = gd.data || {};
          globalInfo = ` | Total market cap: $${(m.total_market_cap?.usd / 1e12)?.toFixed(2)}T | BTC dominance: ${m.market_cap_percentage?.btc?.toFixed(1)}%`;
        }

        return { result: `Market sentiment: ${fear}${globalInfo}` };
      }

      case 'analyse_opportunity': {
        const score = Math.min(10, Math.max(1,
          (args.estimated_apy || 5) / 10 +
          (args.risk_level === 'low' ? 3 : args.risk_level === 'medium' ? 1.5 : 0)
        ));
        return {
          result: `Opportunity Analysis: ${args.opportunity}\nRisk: ${args.risk_level || 'medium'} | Est. APY: ${args.estimated_apy || 'unknown'}% | Score: ${score.toFixed(1)}/10\nRecommendation: ${score > 6 ? 'Proceed with caution, looks viable' : 'More research needed before committing funds'}`
        };
      }

      default:
        return { result: `Tool ${name} not implemented` };
    }
  } catch (err) {
    return { result: `Tool error: ${err.message}` };
  }
}

// ── Call a single provider ───────────────────────────────────────────────────
async function callProvider(provider, messages, useTools = false) {
  const key = provider.apiKey();
  if (!key) throw new Error(`${provider.name}: API key not set`);

  if (provider.format === 'google') {
    // Google Gemini format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemMsg = messages.find(m => m.role === 'system');

    const body = {
      contents,
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      generationConfig: { maxOutputTokens: provider.maxTokens, temperature: 0.7 },
    };

    const r = await fetch(provider.url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`${provider.name} HTTP ${r.status}: ${err.error?.message || r.statusText}`);
    }

    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`${provider.name}: empty response`);
    return { content: text, provider: provider.name };

  } else if (provider.format === 'anthropic') {
    const systemMsg = messages.find(m => m.role === 'system')?.content;
    const userMessages = messages.filter(m => m.role !== 'system');

    const body = {
      model: provider.model,
      max_tokens: provider.maxTokens,
      messages: userMessages,
      ...(systemMsg ? { system: systemMsg } : {}),
    };

    const r = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`${provider.name} HTTP ${r.status}: ${err.error?.message}`);
    }

    const data = await r.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error(`${provider.name}: empty response`);
    return { content: text, provider: provider.name };

  } else {
    // OpenAI-compatible format (Groq, OpenRouter, Together, Mistral, Cerebras)
    const body = {
      model: provider.model,
      messages,
      max_tokens: provider.maxTokens,
      temperature: 0.7,
      ...(useTools && provider.name === 'Groq' ? { tools: TOOLS } : {}),
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    };

    // OpenRouter needs extra headers
    if (provider.name === 'OpenRouter') {
      headers['HTTP-Referer'] = 'https://agentfinance-production.up.railway.app';
      headers['X-Title'] = 'AgentFinance';
    }

    const r = await fetch(provider.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const errMsg = err.error?.message || err.message || r.statusText;
      throw new Error(`${provider.name} HTTP ${r.status}: ${errMsg}`);
    }

    const data = await r.json();
    const choice = data.choices?.[0];

    // Handle tool calls (Groq only for now)
    if (choice?.finish_reason === 'tool_calls' && choice?.message?.tool_calls) {
      const toolResults = [];
      for (const tc of choice.message.tool_calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        const result = await executeTool(tc.function.name, args);
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // Continue conversation with tool results
      const continueBody = {
        model: provider.model,
        messages: [...messages, choice.message, ...toolResults],
        max_tokens: provider.maxTokens,
        temperature: 0.7,
      };
      const r2 = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(continueBody),
        signal: AbortSignal.timeout(30000),
      });
      const d2 = await r2.json();
      const text2 = d2.choices?.[0]?.message?.content;
      return { content: text2 || 'Task completed', provider: provider.name };
    }

    const text = choice?.message?.content;
    if (!text) throw new Error(`${provider.name}: empty response`);
    return { content: text, provider: provider.name };
  }
}

// ── Main agent runner — cascade through all providers ────────────────────────
export async function runAgent({ action, agentType = 'coordinator', walletAddress = null }) {
  if (agentType === 'execution') {
    const actionText = action || '';
    const routingMatch = actionText.match(/([0-9]+(?:\.[0-9]+)?)\s*ETH/i);

    const liveBalance = walletAddress
      ? await executeStructuredTool('check_wallet_balance', { wallet_address: walletAddress, tokens: ['ETH'] })
      : JSON.stringify({ error: 'No wallet connected' });

    if (/route|sweep|transfer|wallet/i.test(actionText)) {
      const prepared = walletAddress
        ? await executeStructuredTool('prepare_wallet_transaction', {
            action: 'transfer',
            token: 'ETH',
            amount: routingMatch?.[1] || '0.0000',
            recipient_address: walletAddress,
            network: 'ethereum',
          })
        : JSON.stringify({ error: 'No wallet connected' });

      const output = JSON.stringify({
        mode: 'execution-prep',
        canBroadcast: false,
        reason: 'No funded treasury wallet or signer is configured on the server, so the platform can prepare but not auto-broadcast an ETH payout.',
        walletAddress,
        currentBalance: safeJson(liveBalance),
        preparedTransaction: safeJson(prepared),
        nextStep: 'Present this prepared transaction to the user wallet for review and approval, or configure a funded payout wallet with signing infrastructure.',
      }, null, 2);

      return {
        success: true,
        output,
        provider: 'local-execution-engine',
        agentType,
      };
    }
  }

  const systemPrompts = {
    research: `You are a DeFi and crypto research agent. You have access to real-time market data tools.
Your job is to find and analyse income-generating opportunities in the crypto/DeFi ecosystem.
Be specific: name protocols, give APY numbers, explain risks clearly.
Always end with a concrete recommendation the user can act on.`,

    trading: `You are a crypto trading and arbitrage agent with access to live price data.
Find arbitrage opportunities between exchanges, yield farming strategies, and trading setups.
Calculate realistic profit estimates. Include specific entry points, risk levels, and expected returns.
Always remind users to verify before executing any trades.`,

    content: `You are a crypto content creation agent. You write high-quality, engaging content about crypto and DeFi.
The content should be informative, well-structured, and ready to publish.
Include relevant statistics, clear explanations, and actionable insights.`,

    execution: `You are a blockchain transaction agent. You prepare and analyse on-chain transactions.
When asked to route earnings or check balances, provide step-by-step instructions.
Always explain what a transaction will do before suggesting execution.
Current wallet: ${walletAddress || 'none connected'}.`,

    coordinator: `You are an AI financial agent coordinator helping users generate income with crypto/DeFi.
You have access to market data, search, and analysis tools.
Provide detailed, actionable analysis with specific numbers and recommendations.`,
  };

  const messages = [
    {
      role: 'system',
      content: systemPrompts[agentType] || systemPrompts.coordinator,
    },
    {
      role: 'user',
      content: action,
    },
  ];

  const errors = [];

  // Try each provider in order
  for (const provider of PROVIDERS) {
    if (!provider.apiKey()) {
      errors.push(`${provider.name}: key not configured`);
      continue;
    }
    try {
      console.log(`[AgentRunner] Trying ${provider.name}…`);
      const result = await callProvider(provider, messages, true);
      console.log(`[AgentRunner] ✅ ${provider.name} succeeded`);
      return {
        success: true,
        output: result.content,
        provider: result.provider,
        agentType,
      };
    } catch (err) {
      const msg = err.message || String(err);
      console.warn(`[AgentRunner] ❌ ${provider.name} failed: ${msg}`);
      errors.push(`${provider.name}: ${msg}`);

      // If rate limited, try next immediately
      // If auth error (wrong key), try next
      // If timeout, try next
      continue;
    }
  }

  // All providers failed
  const summary = errors.join(' | ');
  console.error('[AgentRunner] All providers failed:', summary);
  throw new Error(
    `All AI providers failed. Errors: ${summary}. ` +
    'Check Railway backend env vars: GROQ_API_KEY, GOOGLE_AI_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY'
  );
}

export default runAgent;
