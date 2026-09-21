/**
 * agentRunner.js
 * Reliable multi-provider agent execution (Phase 1).
 *
 * Primary provider is selected from the environment (LLM_PROVIDER, or the first
 * configured provider). Transient failures are retried a bounded number of
 * times, then an optional fallback provider (LLM_FALLBACK_PROVIDER) is tried,
 * then the task fails with a normalized, safe error. A global task timeout
 * (AGENT_TASK_TIMEOUT_MS) is enforced end-to-end and aborts in-flight requests.
 */
import { executeTool as executeStructuredTool } from '../tools/toolExecutor.js';
import {
  callProvider,
  fallbackProvider,
  primaryProvider,
  ProviderError,
  PROVIDER_ERROR,
  safeMessageFor,
} from '../services/llmProvider.js';

export const DEFAULT_TASK_TIMEOUT_MS = 120_000;
export const DEFAULT_PROVIDER_RETRIES = 2;
const MAX_SINGLE_REQUEST_MS = 60_000;

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function cleanPlainText(value = '') {
  return String(value)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/[_*`#>|[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tool executor (used when a Groq tool-use model issues tool_calls) ────────
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
Always explain what a transaction will do before suggesting execution.`,

  coordinator: `You are an AI financial agent coordinator helping users generate income with crypto/DeFi.
You have access to market data, search, and analysis tools.
Provide detailed, actionable analysis with specific numbers and recommendations.`,
};

/**
 * Try one provider with bounded retries for transient failures.
 * Returns { content, provider, model } or throws ProviderError.
 */
async function attemptProvider(spec, messages, { useTools, deadline, signal }) {
  const maxRetries = envInt('AGENT_PROVIDER_RETRIES', DEFAULT_PROVIDER_RETRIES);
  let errors = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ProviderError(PROVIDER_ERROR.TIMEOUT, 'Agent task timed out.', { provider: spec.id });
    }

    const timeoutMs = Math.min(remaining, MAX_SINGLE_REQUEST_MS);
    try {
      return await callProvider(spec, messages, { useTools, timeoutMs, signal, executeTool });
    } catch (err) {
      errors.push(err instanceof ProviderError ? err : new ProviderError(PROVIDER_ERROR.UNAVAILABLE, String(err), { provider: spec.id }));

      const lastError = errors[errors.length - 1];
      const canRetry = lastError.retryable && attempt < maxRetries;
      if (!canRetry) break;

      const backoff = Math.min(600 * (attempt + 1), remaining - 1);
      if (backoff <= 0) break;
      await sleep(backoff);
    }
  }

  throw errors[errors.length - 1];
}

/**
 * Run the agent to completion.
 *
 * @param {object} opts
 * @param {string} opts.action task prompt
 * @param {string} [opts.agentType]
 * @param {string|null} [opts.walletAddress]
 * @param {AbortSignal} [opts.signal] global task abort signal (timeout)
 * @param {number} [opts.timeoutMs] overall task budget
 */
export async function runAgent({ action, agentType = 'coordinator', walletAddress = null, signal = null, timeoutMs = null }) {
  const taskTimeoutMs = timeoutMs || envInt('AGENT_TASK_TIMEOUT_MS', DEFAULT_TASK_TIMEOUT_MS);
  const deadline = Date.now() + taskTimeoutMs;

  if (agentType === 'execution') {
    const actionText = action || '';
    const routingMatch = actionText.match(/([0-9]+(?:\.[0-9]+)?)\s*ETH/i);

    const liveBalance = walletAddress
      ? await executeStructuredTool('check_wallet_balance', { wallet_address: walletAddress, tokens: ['ETH'] }, { signal })
      : JSON.stringify({ error: 'No wallet connected' });

    if (/route|sweep|transfer|wallet/i.test(actionText)) {
      const prepared = walletAddress
        ? await executeStructuredTool('prepare_wallet_transaction', {
            action: 'transfer',
            token: 'ETH',
            amount: routingMatch?.[1] || '0.0000',
            recipient_address: walletAddress,
            network: 'ethereum',
          }, { signal })
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

      const readableOutput = [
        `Execution plan prepared for the connected wallet ${walletAddress || 'not connected'}.`,
        `Current wallet balance: ${cleanPlainText(typeof liveBalance === 'string' ? liveBalance : JSON.stringify(liveBalance))}.`,
        `Prepared transaction: ${cleanPlainText(typeof prepared === 'string' ? prepared : JSON.stringify(prepared))}.`,
        'Next step: review the prepared transaction and approve it in the wallet, or configure a funded payout signer on the server.',
      ].join('\n');

      return {
        success: true,
        output: readableOutput,
        meta: output,
        provider: 'local-execution-engine',
        agentType,
      };
    }
  }

  const messages = [
    { role: 'system', content: systemPrompts[agentType] || systemPrompts.coordinator },
    { role: 'user', content: action },
  ];
  return messages;
}

// ── Execution agent (no LLM required) ────────────────────────────────────────
async function runExecutionAgent({ action, walletAddress }) {
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

  const primary = primaryProvider();
  if (!primary) {
    throw new ProviderError(
      PROVIDER_ERROR.CONFIGURATION,
      'No AI provider is configured. Set one of GROQ_API_KEY, GOOGLE_AI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, TOGETHER_API_KEY, MISTRAL_API_KEY or CEREBRAS_API_KEY.',
    );
  }

  const secondary = fallbackProvider(primary);
  const failures = [];

  async function tryProvider(spec) {
    try {
      return await attemptProvider(spec, messages, { useTools: true, deadline, signal });
    } catch (err) {
      const providerError = err instanceof ProviderError
        ? err
        : new ProviderError(PROVIDER_ERROR.UNAVAILABLE, String(err), { provider: spec.id });
      providerError.provider = providerError.provider || spec.id;
      failures.push({
        provider: spec.id,
        category: providerError.category,
        status: providerError.status || null,
        message: providerError.message,
      });
      return null;
    }
  }

  // Primary provider.
  let result = await tryProvider(primary);
  // Fallback provider (only tried when the primary failed).
  if (!result && secondary) {
    result = await tryProvider(secondary);
  }

  if (result) {
    return {
      success: true,
      output: result.content,
      provider: result.provider,
      model: result.model || null,
      agentType,
    };
  }

  const firstFailure = failures[0] || { provider: null, category: PROVIDER_ERROR.UNAVAILABLE };
  const error = new ProviderError(
    firstFailure.category,
    safeMessageFor(firstFailure.category, firstFailure.provider),
    { provider: firstFailure.provider },
  );
  error.diagnostics = failures;

  const summary = failures.map((f) => `${f.provider}:${f.category}`).join(', ');
  console.error(`[AgentRunner] All AI providers failed (${summary}).`);
  throw error;
}

export default runAgent;