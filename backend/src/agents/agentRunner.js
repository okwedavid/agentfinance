/**
 * agentRunner.js — Multi-provider with automatic fallback
 *
 * Provider chain (all free tiers):
 *   1. Groq       — llama-3.3-70b-versatile    — 14,400 req/day, 1M tokens/hour
 *   2. Google      — gemini-2.0-flash           — 1,500 req/day, most generous
 *   3. OpenRouter  — meta-llama/llama-3.3-70b  — free models, good fallback
 *
 * All use OpenAI-compatible format (tool_calls, choices[0].message).
 * Google Gemini also supports OpenAI-compat via their v1beta endpoint.
 *
 * REQUIRED env vars (set in Railway):
 *   GROQ_API_KEY        — console.groq.com (free, no card)
 *   GOOGLE_AI_API_KEY   — aistudio.google.com (free, no card)
 *   OPENROUTER_API_KEY  — openrouter.ai (free tier available)
 */

import { toolsByAgentType } from '../tools/toolDefinitions.js';
import { executeTool } from '../tools/toolExecutor.js';
import logger from '../utils/logger.js';

const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 10;

// Provider configurations — OpenAI-compat format for all
const PROVIDERS = [
  {
    name: 'groq',
    model: 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: () => process.env.GROQ_API_KEY,
    available: () => !!process.env.GROQ_API_KEY,
  },
  {
    name: 'google',
    model: 'gemini-2.0-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKey: () => process.env.GOOGLE_AI_API_KEY,
    available: () => !!process.env.GOOGLE_AI_API_KEY,
  },
  {
    name: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    baseURL: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: () => process.env.OPENROUTER_API_KEY,
    available: () => !!process.env.OPENROUTER_API_KEY,
    extraHeaders: {
      'HTTP-Referer': 'https://agentfinance-production.up.railway.app',
      'X-Title': 'AgentFinance',
    },
  },
];

async function callProvider(provider, messages, tools, temperature = 0.1) {
  const body = {
    model: provider.model,
    max_tokens: MAX_TOKENS,
    temperature,
    messages,
  };

  // Only add tools if tools are provided (some providers fail with empty tools array)
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(provider.baseURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey()}`,
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${provider.name} HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  return res.json();
}

async function callWithFallback(messages, tools, attempt = 0) {
  const available = PROVIDERS.filter(p => p.available());

  if (available.length === 0) {
    throw new Error(
      'No AI provider configured. Add at least one to Railway env vars:\n' +
      '  GROQ_API_KEY (console.groq.com — free)\n' +
      '  GOOGLE_AI_API_KEY (aistudio.google.com — free)\n' +
      '  OPENROUTER_API_KEY (openrouter.ai — free tier)'
    );
  }

  for (const provider of available) {
    try {
      logger.info(`[Provider] Trying ${provider.name} (${provider.model})`);
      const data = await callProvider(provider, messages, tools);
      logger.info(`[Provider] ${provider.name} succeeded`);
      return { data, provider: provider.name };
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.toLowerCase().includes('rate');
      const isQuota = err.message.includes('quota') || err.message.includes('limit');
      logger.warn(`[Provider] ${provider.name} failed: ${err.message.slice(0, 120)}`);
      if (!isRateLimit && !isQuota) {
        // Non-rate-limit error — still try next provider but log it
        logger.warn(`[Provider] ${provider.name} non-rate error, trying next`);
      }
      // Continue to next provider
    }
  }

  throw new Error(
    'All AI providers failed or hit rate limits. ' +
    'Try again in a minute, or add more provider API keys to Railway env vars.'
  );
}

export async function runAgent({
  taskId,
  agentType,
  systemPrompt,
  userPrompt,
  walletAddress,
  onEvent,
}) {
  const tools = toolsByAgentType[agentType] || toolsByAgentType.research;
  const toolsUsed = [];
  let iterations = 0;

  const fullPrompt = walletAddress
    ? `${userPrompt}\n\n[User crypto wallet for earnings: ${walletAddress}]`
    : userPrompt;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: fullPrompt },
  ];

  onEvent?.({ type: 'agent:started', agentType, taskId, timestamp: Date.now() });
  logger.info(`[Agent:${agentType}] Starting task ${taskId}`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    let data, usedProvider;
    try {
      const result = await callWithFallback(messages, tools);
      data = result.data;
      usedProvider = result.provider;
    } catch (err) {
      logger.error(`[Agent:${agentType}] All providers failed: ${err.message}`);
      throw err;
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error(`Invalid response from ${usedProvider}: no choices`);
    }

    const { finish_reason, message } = choice;
    logger.info(`[Agent:${agentType}] iter=${iterations} finish=${finish_reason} provider=${usedProvider}`);

    // Add assistant message to history
    messages.push(message);

    if (finish_reason === 'stop' || finish_reason === 'length' || finish_reason === 'end_turn') {
      const result = message.content || 'Agent completed with no text output.';
      onEvent?.({ type: 'agent:completed', agentType, taskId, result, toolsUsed, iterations, provider: usedProvider, timestamp: Date.now() });
      logger.info(`[Agent:${agentType}] Completed. Tools: ${toolsUsed.join(', ') || 'none'}`);
      return { result, toolsUsed, iterations };
    }

    if (finish_reason === 'tool_calls') {
      const calls = message.tool_calls || [];

      for (const call of calls) {
        const name = call.function.name;
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); }
        catch (e) { logger.error(`[Agent] Bad tool args JSON for ${name}: ${call.function.arguments}`); }

        toolsUsed.push(name);
        onEvent?.({ type: 'agent:tool_call', agentType, taskId, tool: name, input: args, timestamp: Date.now() });
        logger.info(`[Agent:${agentType}] Tool: ${name}`);

        let toolResult;
        try { toolResult = await executeTool(name, args); }
        catch (err) { toolResult = `Tool "${name}" error: ${err.message}`; }

        onEvent?.({ type: 'agent:tool_result', agentType, taskId, tool: name, result: toolResult, timestamp: Date.now() });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
        });
      }
      continue;
    }

    // Unknown finish reason — treat as final answer
    const result = message.content || `Agent stopped: ${finish_reason}`;
    onEvent?.({ type: 'agent:completed', agentType, taskId, result, toolsUsed, iterations, timestamp: Date.now() });
    return { result, toolsUsed, iterations };
  }

  const timeoutResult = `Agent reached max iterations (${MAX_ITERATIONS}).`;
  onEvent?.({ type: 'agent:timeout', agentType, taskId, iterations, timestamp: Date.now() });
  return { result: timeoutResult, toolsUsed, iterations };
}