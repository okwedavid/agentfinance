/**
 * providerConfig.js — the SINGLE authoritative source of truth for LLM
 * provider configuration in AgentFinance.
 *
 * Everything that talks to an AI provider reads from here:
 *   - provider selection / priority
 *   - model name resolution (defaults + per-provider env override)
 *   - API endpoint, auth header scheme and request format
 *   - timeout and retry policy
 *
 * No other module should hardcode provider names, models or endpoints.
 *
 * Safe diagnostics only. Never return API keys.
 */

export const PROVIDER_IDS = ['groq', 'google', 'anthropic', 'openrouter', 'together', 'mistral', 'cerebras'];

const PROVIDER_RECORDS = {
  groq: {
    id: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiFormat: 'openai', // OpenAI-compatible chat.completions
    authScheme: 'Bearer',
    maxTokens: 4096,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    envKey: 'GOOGLE_AI_API_KEY',
    modelEnv: 'GOOGLE_AI_MODEL',
    defaultModel: 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiFormat: 'google',
    authScheme: 'query-key',
    maxTokens: 4096,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-haiku-4-5-20251001',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    apiFormat: 'anthropic',
    authScheme: 'x-api-key',
    maxTokens: 4096,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openai',
    authScheme: 'Bearer',
    extraHeaders: { 'HTTP-Referer': 'https://agentfinance.onrender.com', 'X-Title': 'AgentFinance' },
    maxTokens: 2048,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
  together: {
    id: 'together',
    label: 'Together',
    envKey: 'TOGETHER_API_KEY',
    modelEnv: 'TOGETHER_MODEL',
    defaultModel: 'meta-llama/Llama-3-8b-chat-hf',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    apiFormat: 'openai',
    authScheme: 'Bearer',
    maxTokens: 2048,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    modelEnv: 'MISTRAL_MODEL',
    defaultModel: 'mistral-small-latest',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    apiFormat: 'openai',
    authScheme: 'Bearer',
    maxTokens: 2048,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
    modelEnv: 'CEREBRAS_MODEL',
    defaultModel: 'llama3.1-8b',
    baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
    apiFormat: 'openai',
    authScheme: 'Bearer',
    maxTokens: 2048,
    timeoutMs: 30000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000 },
  },
};

/**
 * The default cascade priority is the order providers are tried when
 * LLM_PROVIDER is unset or 'auto'.
 */
const DEFAULT_PRIORITY = [...PROVIDER_IDS];

function envString(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Lowercase sanitised value of LLM_PROVIDER ('auto' | specific provider id). */
export function getRequestedProvider() {
  const value = envString('LLM_PROVIDER') || 'auto';
  return value.toLowerCase();
}

/**
 * Resolve the effective provider order.
 * - 'auto' (default): all configured providers in cascade priority order.
 * - a single provider id: that provider only.
 * Returns provider records (never used without checking configured later).
 */
export function resolveProviderPriority() {
  const requested = getRequestedProvider();
  if (requested !== 'auto' && requested !== '') {
    const single = getProviderRecord(requested);
    return single ? [single] : [];
  }
  return DEFAULT_PRIORITY
    .map(getProviderRecord)
    .filter(Boolean);
}

/** Return the configured model for a provider record, honouring per-provider env override. */
export function resolveModel(provider) {
  return envString(provider.modelEnv) || provider.defaultModel;
}

/** True when the provider's API key env var is present and non-empty. */
export function isProviderConfigured(provider) {
  if (!provider) return false;
  return Boolean(envString(provider.envKey));
}

export function getProviderRecord(id) {
  const key = String(id || '').toLowerCase();
  return PROVIDER_RECORDS[key] || null;
}

/** All provider records that have an API key configured, in cascade order. */
export function getConfiguredProviders() {
  return resolveProviderPriority().filter(isProviderConfigured);
}

export function getProviderById(id) {
  return getProviderRecord(id);
}

/** Public build of the model name used by each configured provider (safe to log). */
export function configuredProviderSummary() {
  return resolveProviderPriority()
    .filter(isProviderConfigured)
    .map((provider) => ({
      provider: provider.id,
      configured: true,
      model: resolveModel(provider),
    }));
}

/** Startup / runtime diagnostic: provider=groq configured=true/false model=<model> */
export function providerDiagnostics() {
  return PROVIDER_IDS.map((id) => {
    const record = getProviderRecord(id);
    return {
      provider: record.id,
      configured: isProviderConfigured(record),
      model: resolveModel(record),
      requested: getRequestedProvider(),
    };
  });
}