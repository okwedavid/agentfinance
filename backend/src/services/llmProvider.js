/**
 * llmProvider.js — clean, environment-driven LLM provider abstraction.
 *
 * Phase 1 goal: at least one reliable provider must be able to complete a
 * task end-to-end, and no single provider failure should sink the agent.
 *
 * - Providers are selected from the environment (never hardcoded credentials).
 * - A provider is only usable when its API key env var is set on the server.
 * - Every error is normalized into a fixed set of categories so callers can
 *   decide to retry, fall back, or surface a safe message.
 * - Raw provider bodies and credentials never leave this module in a form that
 *   is exposed to end users.
 */

export const PROVIDER_ERROR = Object.freeze({
  AUTH: 'PROVIDER_AUTH_ERROR',
  RATE_LIMIT: 'PROVIDER_RATE_LIMIT',
  TIMEOUT: 'PROVIDER_TIMEOUT',
  UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NETWORK_ERROR: 'PROVIDER_NETWORK_ERROR',
  MODEL_UNAVAILABLE: 'PROVIDER_MODEL_UNAVAILABLE',
  PAYMENT_REQUIRED: 'PROVIDER_PAYMENT_REQUIRED',
  INVALID_RESPONSE: 'PROVIDER_INVALID_RESPONSE',
  CONFIGURATION: 'PROVIDER_CONFIGURATION_ERROR',
});

const RETRYABLE_CATEGORIES = new Set([
  PROVIDER_ERROR.RATE_LIMIT,
  PROVIDER_ERROR.TIMEOUT,
  PROVIDER_ERROR.UNAVAILABLE,
  PROVIDER_ERROR.NETWORK_ERROR,
]);

export class ProviderError extends Error {
  constructor(category, message, { provider = null, status = null, retryable } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.category = category;
    this.provider = provider;
    this.status = status;
    this.retryable = retryable !== undefined ? retryable : RETRYABLE_CATEGORIES.has(category);
  }
}

export function isRetryableCategory(category) {
  return RETRYABLE_CATEGORIES.has(category);
}

function envString(name) {
  const value = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
  return value || null;
}

// ── Provider registry ─────────────────────────────────────────────────────────
// Each provider is selected purely by its server-side API key env var and is
// free to override its model via `<PROVIDER>_MODEL`. Primary/fallback selection
// is controlled by LLM_PROVIDER / LLM_FALLBACK_PROVIDER (see primaryProvider).

const PROVIDER_SPECS = {
  groq: {
    id: 'groq',
    displayName: 'Groq',
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    // llama-3.3-70b-versatile was retired from the accessible account catalog
    // (HTTP 404 model_not_found). gpt-oss-20b is served on Groq, fast, and
    // available on this account. Override via GROQ_MODEL when needed.
    defaultModel: 'openai/gpt-oss-20b',
    maxTokens: 4096,
    format: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    toolsEnabled: true,
  },
  google: {
    id: 'google',
    displayName: 'Google AI',
    keyEnv: 'GOOGLE_AI_API_KEY',
    modelEnv: 'GOOGLE_AI_MODEL',
    // Legacy alias kept only for backward-compatible health flags. The active
    // Gemini spec below is the one wired into the provider router.
    defaultModel: 'gemini-2.5-flash',
    maxTokens: 4096,
    format: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    toolsEnabled: false,
    legacy: true,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    // gemini-2.5-flash verified live against the configured account (returns a
    // marker completion); 2.0-flash and 2.5-pro return 404 on this key.
    defaultModel: 'gemini-2.5-flash',
    maxTokens: 4096,
    format: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    toolsEnabled: false,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    toolsEnabled: false,
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    maxTokens: 2048,
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    toolsEnabled: false,
  },
  together: {
    id: 'together',
    displayName: 'Together',
    keyEnv: 'TOGETHER_API_KEY',
    modelEnv: 'TOGETHER_MODEL',
    defaultModel: 'meta-llama/Llama-3-8b-chat-hf',
    maxTokens: 2048,
    format: 'openai',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    toolsEnabled: false,
  },
  mistral: {
    id: 'mistral',
    displayName: 'Mistral',
    keyEnv: 'MISTRAL_API_KEY',
    modelEnv: 'MISTRAL_MODEL',
    defaultModel: 'mistral-small-latest',
    maxTokens: 2048,
    format: 'openai',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    toolsEnabled: false,
  },
  cerebras: {
    id: 'cerebras',
    displayName: 'Cerebras',
    keyEnv: 'CEREBRAS_API_KEY',
    modelEnv: 'CEREBRAS_MODEL',
    // Verified live: the account catalog is now ['gpt-oss-120b','qwen-3.8-27b'];
    // the legacy llama3.1-8b ids return 404. NOTE: this account currently gets
    // HTTP 402 payment_required on chat completions, so Cerebras is configured
    // but its generation is billing-blocked until the account has credit.
    defaultModel: 'gpt-oss-120b',
    maxTokens: 4096,
    format: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
    toolsEnabled: false,
  },
};

// Definitive fallback priority when LLM_PROVIDER is not explicitly set.
const PRIORITY_ORDER = ['groq', 'gemini', 'google', 'anthropic', 'openrouter', 'together', 'mistral', 'cerebras'];

// The production provider routing chain. Groq first (low-latency), Gemini
// second (verified working), Cerebras third (newest). Ordered via
// PROVIDER_FALLBACK_ORDER (comma-separated provider ids) when set.
const DEFAULT_FALLBACK_ORDER = ['groq', 'gemini', 'cerebras'];

/**
 * Deterministic, environment-driven provider order for task execution.
 * Providers whose API key is not configured are skipped immediately — a missing
 * key must never fail the task, it must just move routing to the next provider.
 *
 * Bonus semantic: when LLM_PROVIDER is set to one of the providers AND it is
 * configured, it is moved to the front (explicit primary intent), but an
 * explicitly-named-but-unconfigured LLM_PROVIDER is simply skipped, never fatal.
 */
export function providerFallbackOrder() {
  const raw = envString('PROVIDER_FALLBACK_ORDER') || DEFAULT_FALLBACK_ORDER.join(',');
  const order = raw
    .split(',')
    .map((id) => String(id || '').trim().toLowerCase())
    .filter(Boolean);

  const explicitPrimary = getProviderSpec(process.env.LLM_PROVIDER);
  const configured = order.filter((id) => providerIsConfigured(PROVIDER_SPECS[id]));

  if (explicitPrimary && providerIsConfigured(explicitPrimary) && !configured.includes(explicitPrimary.id)) {
    configured.unshift(explicitPrimary.id);
  }
  return configured;
}

export function getProviderSpec(id) {
  const key = String(id || '').toLowerCase();
  return PROVIDER_SPECS[key] || null;
}

export function providerIsConfigured(spec) {
  return Boolean(spec && envString(spec.keyEnv));
}

export function providerModel(spec) {
  return envString(spec.modelEnv) || spec.defaultModel;
}

export function configuredProviderIds() {
  return PRIORITY_ORDER.filter((id) => providerIsConfigured(PROVIDER_SPECS[id]));
}

/** The primary provider: LLM_PROVIDER env, else the first configured one. */
export function primaryProvider() {
  const explicit = getProviderSpec(process.env.LLM_PROVIDER);
  if (explicit) {
    if (!providerIsConfigured(explicit)) {
      throw new ProviderError(
        PROVIDER_ERROR.CONFIGURATION,
        `LLM_PROVIDER is set to "${explicit.id}" but ${explicit.keyEnv} is not configured on the server.`,
        { provider: explicit.id },
      );
    }
    return explicit;
  }
  const first = configuredProviderIds()[0];
  if (!first) return null;
  return PROVIDER_SPECS[first];
}

/** Optional fallback provider. Never the same instance as the primary. */
export function fallbackProvider(primary) {
  const explicit = getProviderSpec(process.env.LLM_FALLBACK_PROVIDER);
  if (!explicit) return null;
  if (!providerIsConfigured(explicit)) {
    throw new ProviderError(
      PROVIDER_ERROR.CONFIGURATION,
      `LLM_FALLBACK_PROVIDER is set to "${explicit.id}" but ${explicit.keyEnv} is not configured on the server.`,
      { provider: explicit.id },
    );
  }
  if (primary && explicit.id === primary.id) return null;
  return explicit;
}

// ── Error normalization ───────────────────────────────────────────────────────

function classifyHttpError(status, bodyText, providerName) {
  if (status === 401 || status === 403) return PROVIDER_ERROR.AUTH;
  if (status === 402) return PROVIDER_ERROR.PAYMENT_REQUIRED;
  if (status === 429) return PROVIDER_ERROR.RATE_LIMIT;
  if (status === 408) return PROVIDER_ERROR.TIMEOUT;
  if (status === 404) {
    return /model|not found|no such|deployment/i.test(bodyText)
      ? PROVIDER_ERROR.MODEL_UNAVAILABLE
      : PROVIDER_ERROR.UNAVAILABLE;
  }
  if (status >= 500) return PROVIDER_ERROR.UNAVAILABLE;
  // 400 + malformed model usually means an unsupported model name.
  if (status === 400) {
    return /model|malformed|invalid|unsupported|could not parse|not allowed/i.test(bodyText)
      ? PROVIDER_ERROR.MODEL_UNAVAILABLE
      : PROVIDER_ERROR.UNAVAILABLE;
  }
  return PROVIDER_ERROR.UNAVAILABLE;
}

/** Safe, user-facing message per category. Never includes credentials or bodies. */
export const ALL_PROVIDERS_FAILED_MESSAGE = 'AI execution is temporarily unavailable. All configured AI providers failed.';

export function safeMessageFor(category, providerName = null) {
  const name = providerName ? `${providerName} ` : '';
  switch (category) {
    case PROVIDER_ERROR.AUTH:
      return `AI provider ${name}could not authenticate. Check the server-side API key configuration.`;
    case PROVIDER_ERROR.CONFIGURATION:
      return `AI provider ${name}is not configured correctly. Check the server-side model configuration.`;
    case PROVIDER_ERROR.MODEL_UNAVAILABLE:
      return `AI provider ${name}does not offer the configured model. Check the server-side model configuration.`;
    case PROVIDER_ERROR.PAYMENT_REQUIRED:
      return `AI provider ${name}requires billing configuration before it can execute tasks.`;
    case PROVIDER_ERROR.RATE_LIMIT:
      return 'AI provider is temporarily rate limited. Please try again.';
    case PROVIDER_ERROR.TIMEOUT:
      return 'The agent task timed out. Please try again.';
    case PROVIDER_ERROR.UNAVAILABLE:
      return 'AI provider temporarily unavailable. Please try again.';
    case PROVIDER_ERROR.NETWORK_ERROR:
      return 'AI provider could not be reached. Please try again.';
    case PROVIDER_ERROR.INVALID_RESPONSE:
      return 'The AI provider returned an empty response. Please try again.';
    default:
      return 'Agent could not complete this task. Please try again.';
  }
}

// ── Request shaping per provider format ───────────────────────────────────────

function buildHeaders(spec, apiKey) {
  if (spec.format === 'google') {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  }
  if (spec.format === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (spec.id === 'openrouter') {
    headers['HTTP-Referer'] = envString('OPENROUTER_REFERER') || 'https://agentfinance.onrender.com';
    headers['X-Title'] = envString('OPENROUTER_SITE') || 'AgentFinance';
  }
  return headers;
}

function buildBody(spec, model, messages, useTools) {
  if (spec.format === 'google') {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const systemMsg = messages.find((m) => m.role === 'system');
    return {
      contents,
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      generationConfig: { maxOutputTokens: spec.maxTokens, temperature: 0.7 },
    };
  }

  if (spec.format === 'anthropic') {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');
    return {
      model,
      max_tokens: spec.maxTokens,
      messages: userMessages,
      ...(systemMsg ? { system: systemMsg.content } : {}),
    };
  }

  return {
    model,
    messages,
    max_tokens: spec.maxTokens,
    temperature: 0.7,
    ...(useTools && spec.toolsEnabled ? { tools: buildTools() } : {}),
  };
}

// Tool definitions kept small and stable (same set the agent used historically).
function buildTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for current information',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
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
          properties: { coin: { type: 'string', description: 'Coin ID e.g. bitcoin, ethereum, solana' } },
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
          properties: { protocol: { type: 'string', description: 'Protocol name e.g. aave, compound, curve, yearn' } },
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
}

function parseContent(spec, data) {
  if (spec.format === 'google') {
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || null,
      model: data.model || spec.id,
      usage: data.usageMetadata || null,
    };
  }
  if (spec.format === 'anthropic') {
    return {
      content: data.content?.[0]?.text || null,
      model: data.model || spec.id,
      usage: { promptTokens: data.usage?.input_tokens, completionTokens: data.usage?.output_tokens, totalTokens: data.usage?.input_tokens + data.usage?.output_tokens },
    };
  }
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || null,
    model: data.model || spec.id,
    usage: data.usage || null,
    finishReason: choice?.finish_reason || null,
    message: choice?.message || null,
  };
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

// ── Single provider call ──────────────────────────────────────────────────────
/**
 * Call one provider and return a normalized { content, provider, model, usage }.
 *
 * @param {object} spec provider spec from the registry
 * @param {object[]} messages OpenAI-style [{role, content}, ...]
 * @param {object} opts
 * @param {boolean} opts.useTools
 * @param {number} opts.timeoutMs per-request budget (ms)
 * @param {AbortSignal} [opts.signal] global task abort signal
 * @param {Function} [opts.executeTool] tool executor used during tool_calls
 */
export async function callProvider(spec, messages, { useTools = false, timeoutMs = 30000, signal = null, executeTool = null } = {}) {
  const apiKey = envString(spec.keyEnv);
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ERROR.CONFIGURATION, `${spec.displayName}: API key not set (${spec.keyEnv}).`, { provider: spec.id });
  }

  const model = providerModel(spec);
  const url = spec.format === 'google'
    ? `${spec.baseUrl}/models/${model}:generateContent`
    : spec.baseUrl;

  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  async function doFetch(spec2, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(spec2, apiKey),
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!res.ok) {
      const bodyText = await readErrorBody(res);
      const category = classifyHttpError(res.status, bodyText, spec2.displayName);
      throw new ProviderError(category, `${spec2.displayName} HTTP ${res.status}.`, {
        provider: spec2.id,
        status: res.status,
      });
    }
    return res.json();
  }

  let data;
  try {
    data = await doFetch(spec, buildBody(spec, model, messages, useTools));
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err?.name === 'AbortError') {
      throw new ProviderError(PROVIDER_ERROR.TIMEOUT, `${spec.displayName} request aborted.`, { provider: spec.id });
    }
    throw new ProviderError(PROVIDER_ERROR.NETWORK_ERROR, `${spec.displayName} network error: ${err?.message || 'unknown'}`, { provider: spec.id });
  }

  const parsed = parseContent(spec, data);
  const { content, message, finishReason } = parsed;

  // Tool calls (Groq tool-use model path): execute tools, then finish the turn.
  if (finishReason === 'tool_calls' && message?.tool_calls?.length && executeTool && spec.toolsEnabled) {
    const toolResults = [];
    for (const tc of message.tool_calls) {
      let args;
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await executeTool(tc.function?.name, args);
      toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }

    const continueData = await doFetch(spec, {
      model,
      messages: [...messages, message, ...toolResults],
      max_tokens: spec.maxTokens,
      temperature: 0.7,
    });
    const continued = parseContent(spec, continueData);
    if (!continued.content) {
      throw new ProviderError(PROVIDER_ERROR.INVALID_RESPONSE, `${spec.displayName}: empty response after tool call.`, { provider: spec.id });
    }
    return { content: continued.content, provider: spec.displayName, model, usage: continued.usage };
  }

  if (!content) {
    throw new ProviderError(PROVIDER_ERROR.INVALID_RESPONSE, `${spec.displayName}: empty response.`, { provider: spec.id });
  }

  return { content, provider: spec.displayName, model, usage: parsed.usage };
}