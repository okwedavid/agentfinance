/**
 * providerFactory.js — builds executable provider instances from the single
 * authoritative providerConfig. Each instance exposes:
 *
 *   enabled()          -> boolean (API key present)
 *   chat(messages, opts) -> Promise<{ content, provider, model, usage? }>
 *
 * All HTTP failures are normalised via normalizeError. API keys are never
 * logged and never included in the returned objects.
 */
import {
  getProviderRecord,
  resolveModel,
  isProviderConfigured,
  getConfiguredProviders,
} from './providerConfig.js';
import { toNormalizedError, ErrorCategory } from './normalizedError.js';

function envString(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildOpenAiBody({ model, messages, maxTokens, tools, responseFormat }) {
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  if (tools && tools.length > 0) body.tools = tools;
  if (responseFormat === 'json') body.response_format = { type: 'json_object' };
  return body;
}

function parseOpenAiResponse(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('empty response from OpenAI-compatible provider');
  }
  return {
    content,
    usage: data?.usage || null,
    toolCalls: choice?.message?.tool_calls || null,
    finishReason: choice?.finish_reason || null,
  };
}

function buildGooglePayload({ model, messages, maxTokens }) {
  const contents = messages
    .filter((item) => item.role !== 'system')
    .map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    }));
  const system = messages.find((item) => item.role === 'system')?.content;
  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return body;
}

function parseGoogleResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('empty response from Google Gemini provider');
  }
  return { content: text };
}

function buildAnthropicPayload({ model, messages, maxTokens }) {
  const system = messages.find((item) => item.role === 'system')?.content;
  const rest = messages.filter((item) => item.role !== 'system');
  const body = { model, max_tokens: maxTokens, messages: rest };
  if (system) body.system = system;
  return body;
}

function parseAnthropicResponse(data) {
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('empty response from Anthropic provider');
  }
  return { content: text };
}

function buildHeaders(provider, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.authScheme === 'Bearer') {
    headers.Authorization = `Bearer ${key}`;
  } else if (provider.authScheme === 'x-api-key') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  }
  if (provider.extraHeaders) Object.assign(headers, provider.extraHeaders);
  return headers;
}

/**
 * Execute a single request against a provider. Throws normalized errors.
 */
async function requestOnce(provider, bodyBuilder, payload, key, timeoutMs) {
  let url = provider.baseUrl;
  let headers = buildHeaders(provider, key);

  if (provider.apiFormat === 'google') {
    const params = new URLSearchParams({ key });
    url = `${provider.baseUrl}/models/${provider.model}:generateContent?${params.toString()}`;
    headers = { 'Content-Type': 'application/json' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyBuilder(payload)),
      signal: controller.signal,
    });

    let data = null;
    const raw = await response.text();
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const detail = data?.error?.message
        || data?.error
        || data?.message
        || response.statusText
        || '';
      const error = new Error(`${provider.id}: HTTP ${response.status}: ${String(detail)}`);
      error.status = response.status;
      throw error;
    }

    if (!data) throw new Error(`${provider.id}: malformed response`);

    if (provider.apiFormat === 'google') return parseGoogleResponse(data);
    if (provider.apiFormat === 'anthropic') return parseAnthropicResponse(data);
    return parseOpenAiResponse(data);
  } catch (error) {
    const isTimeout = error?.name === 'AbortError' || controller.signal.aborted;
    if (isTimeout) {
      const timeoutError = new Error(`${provider.id}: timeout after ${timeoutMs}ms`);
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a provider instance. `chat` performs the request with an internal
 * timeout and normalizes errors (unified category, safe message).
 */
export function createProvider(id) {
  const record = getProviderRecord(id);
  if (!record) return null;
  const provider = { ...record };

  async function chat(messages, { tools = [], responseFormat = null } = {}) {
    const key = envString(provider.envKey);
    if (!key) {
      const error = new Error(`${provider.id}: API key not set`);
      throw toNormalizedError(error, provider.id);
    }

    const model = resolveModel(provider);
    const payload = { model, messages, maxTokens: provider.maxTokens, tools, responseFormat };

    try {
      const parsed = await requestOnce(provider, buildPayloadFor(provider.apiFormat), payload, key, provider.timeoutMs);
      return { ...parsed, provider: provider.id, model };
    } catch (error) {
      if (error.ts) {
        Object.defineProperty(error, 'category', { value: error.category, enumerable: true });
        throw error;
      }
      const normalized = toNormalizedError(error, provider.id);
      normalized.technical = String(error?.message || error || '');
      const out = new Error(normalized.message);
      Object.assign(out, normalized);
      throw out;
    }
  }

  return {
    id: provider.id,
    label: provider.label,
    configured: isProviderConfigured(provider),
    model: resolveModel(provider),
    timeoutMs: provider.timeoutMs,
    retryPolicy: provider.retryPolicy,
    chat,
  };
}

function buildPayloadFor(format) {
  if (format === 'google') return buildGooglePayload;
  if (format === 'anthropic') return buildAnthropicPayload;
  return buildOpenAiBody;
}

/**
 * Resolve the list of provider instances that are both selected by
 * LLM_PROVIDER priority AND have credentials configured.
 */
export function getActiveProviders() {
  return getConfiguredProviders().map((record) => createProvider(record.id)).filter(Boolean);
}

/** Single-provider lookup independent of priority. */
export function getProvider(id) {
  return createProvider(id);
}

export { classifyProviderError, toNormalizedError, ErrorCategory } from './normalizedError.js';
export { getRequestedProvider, providerDiagnostics, configuredProviderSummary } from './providerConfig.js';