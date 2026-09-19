/**
 * agentRunner.js
 *
 * Multi-provider task execution built on the single authoritative provider
 * configuration layer (backend/src/providers/*).
 *
 * Execution flow:
 *   - 'execution' tasks use the local execution engine (no LLM required).
 *   - 'research' tasks use the resilient research pipeline (verified evidence
 *     first, LLM synthesis second, graceful partial fallback).
 *   - other agent types cascade through configured providers with bounded
 *     retries and exponential backoff for transient failures only.
 *
 * Diagnostics use safe fields only: provider, configured, model,
 * request-started, request-success, error-category. API keys are never logged.
 */
import { executeTool as executeStructuredTool } from '../tools/toolExecutor.js';
import { getActiveProviders, toNormalizedError } from '../providers/providerFactory.js';
import { ErrorCategory } from '../providers/normalizedError.js';
import { runResearchTask } from '../services/researchService.js';
import logger from '../utils/logger.js';

// ── Retry helper: bounded retries + exponential backoff on transient errors ──
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff(fn, { maxAttempts = 2, baseDelayMs = 1000, shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= maxAttempts || !shouldRetry(error)) throw error;
      const backoff = baseDelayMs * (2 ** attempt);
      await delay(backoff);
    }
  }
  throw lastError;
}

export function isTransientError(error) {
  const category = error?.category;
  return category === ErrorCategory.RATE_LIMIT
    || category === ErrorCategory.PROVIDER_UNAVAILABLE
    || category === ErrorCategory.TIMEOUT;
}

const SYSTEM_PROMPTS = {
  research: `You are a DeFi and crypto research agent. You only use verified data provided to you. Be specific, name protocols only when verified, explain risks clearly, and never invent numbers.`,
  trading: `You are a crypto trading and arbitrage agent with access to live price data.
Find arbitrage opportunities between exchanges, yield farming strategies, and trading setups.
Calculate realistic profit estimates only from provided data. Include specific entry points, risk levels, and expected returns.
Always remind users to verify before executing any trades.`,
  content: `You are a crypto content creation agent. You write high-quality, engaging content about crypto and DeFi.
The content should be informative, well-structured, and ready to publish.
Include relevant statistics, clear explanations, and actionable insights.`,
  execution: `You are a blockchain transaction agent. You prepare and analyse on-chain transactions.
When asked to route earnings or check balances, provide step-by-step instructions.
Always explain what a transaction will do before suggesting execution.`,
  coordinator: `You are an AI financial agent coordinator helping users generate income with crypto/DeFi.
Provide detailed, actionable analysis where numbers come from provided verified data only.`,
};

function buildMessages({ action, agentType, walletAddress }) {
  const system = SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS.coordinator;
  const messages = [
    { role: 'system', content: agentType === 'execution' ? `${system}\nCurrent wallet: ${walletAddress || 'none connected'}.` : system },
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

    const safeText = (value) => String(value || '')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/[_*`#>|[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      success: true,
      output: [
        `Execution plan prepared for the connected wallet ${walletAddress || 'not connected'}.`,
        `Current wallet balance: ${safeText(typeof liveBalance === 'string' ? liveBalance : JSON.stringify(liveBalance))}.`,
        `Prepared transaction: ${safeText(typeof prepared === 'string' ? prepared : JSON.stringify(prepared))}.`,
        'Next step: review the prepared transaction and approve it in the wallet, or configure a funded payout signer on the server.',
      ].join('\n'),
      provider: 'local-execution-engine',
      agentType: 'execution',
    };
  }
  throw new Error('No executable instruction detected in the action.');
}

// ── LLM cascade (non-research paths) ──────────────────────────────────────────
async function runLlmCascade({ action, agentType, walletAddress }) {
  const messages = buildMessages({ action, agentType, walletAddress });
  const providers = getActiveProviders();
  const errors = [];

  for (const provider of providers) {
    if (!provider.configured) {
      logger.warn(`provider=${provider.id} configured=false`);
      errors.push(toNormalizedError(new Error(`${provider.id}: API key not set`), provider.id));
      continue;
    }
    logger.info(`provider=${provider.id} configured=true model=${provider.model} request-started=true`);

    try {
      const result = await retryWithBackoff(
        () => provider.chat(messages, { tools: [] }),
        {
          maxAttempts: provider.retryPolicy?.maxAttempts || 2,
          baseDelayMs: provider.retryPolicy?.baseDelayMs || 1000,
          shouldRetry: isTransientError,
        },
      );
      logger.info(`provider=${provider.id} request-success=true`);
      return {
        success: true,
        output: result.content,
        provider: provider.id,
        model: result.model,
        agentType,
      };
    } catch (error) {
      logger.warn(`provider=${provider.id} request-success=false error-category=${error.category || 'unknown'}`);
      errors.push(error);
    }
  }

  const preferred = errors.find((error) => error?.category) || errors[0];
  const category = preferred?.category || ErrorCategory.PROVIDER_UNAVAILABLE;
  const aggregate = toNormalizedError(new Error('All AI providers failed'), '');
  Object.assign(aggregate, { category });
  const out = new Error(aggregate.message);
  Object.assign(out, aggregate);
  out.technical = `All configured providers failed. Categories: ${errors.map((e) => e.category || 'unknown').join(', ')}`;
  logger.warn(`task-runner all-providers-failed categories=${errors.map((e) => e.category || 'unknown').join(',')}`);
  throw out;
}

// ── Public runner ─────────────────────────────────────────────────────────────
export async function runAgent({ action, agentType = 'coordinator', walletAddress = null }) {
  if (agentType === 'execution') {
    return runExecutionAgent({ action, walletAddress });
  }
  if (agentType === 'research') {
    return runResearchTask({ action, agentType });
  }
  return runLlmCascade({ action, agentType, walletAddress });
}

export default runAgent;