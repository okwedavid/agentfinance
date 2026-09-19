/**
 * normalizedError.js — maps raw provider/network failures into a safe,
 * human-readable error category. The category is safe to surface to users and
 * logs; technical detail stays server-side only.
 */

export const ErrorCategory = Object.freeze({
  PROVIDER_NOT_CONFIGURED: 'provider_not_configured',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  AUTHENTICATION_FAILURE: 'authentication_failure',
  RATE_LIMIT: 'rate_limit',
  TIMEOUT: 'timeout',
  INVALID_REQUEST: 'invalid_request',
  MALFORMED_RESPONSE: 'malformed_response',
  INSUFFICIENT_DATA: 'insufficient_data',
  USER_CANCELLED: 'user_cancelled',
  APPLICATION_ERROR: 'application_error',
});

const CATEGORY_HINT = Object.freeze({
  provider_not_configured: {
    message: 'AI provider unavailable',
    retryable: false,
    incomeEligible: false,
  },
  provider_unavailable: {
    message: 'Provider temporarily unavailable',
    retryable: true,
    incomeEligible: false,
  },
  authentication_failure: {
    message: 'AI configuration unavailable',
    retryable: false,
    incomeEligible: false,
  },
  rate_limit: {
    message: 'Rate limit reached',
    retryable: true,
    incomeEligible: false,
  },
  timeout: {
    message: 'Task timed out',
    retryable: true,
    incomeEligible: false,
  },
  invalid_request: {
    message: 'Request could not be processed',
    retryable: false,
    incomeEligible: false,
  },
  malformed_response: {
    message: 'Provider returned an unreadable response',
    retryable: false,
    incomeEligible: false,
  },
  insufficient_data: {
    message: 'Insufficient market data',
    retryable: false,
    incomeEligible: false,
  },
  user_cancelled: {
    message: 'Task cancelled',
    retryable: false,
    incomeEligible: false,
  },
  application_error: {
    message: 'Unexpected processing error',
    retryable: false,
    incomeEligible: false,
  },
});

/** Opinionated classifier used before any HTTP-level detail is known. */
export function classifyProviderError(error, providerId = '') {
  const raw = error?.message || String(error || '');
  const text = raw.toLowerCase();
  const provider = String(providerId || '').toLowerCase();

  if (/api key not set|not configured|credentials? missing|missing api key/i.test(text)) {
    return ErrorCategory.PROVIDER_NOT_CONFIGURED;
  }
  if (/timeout|timed out|aborted|econnreset|fetch failed|undici|network/i.test(text)) {
    return ErrorCategory.TIMEOUT;
  }
  if (/rate\s?limit|429|too many requests/i.test(text)) {
    return ErrorCategory.RATE_LIMIT;
  }
  if (/401|403|unauthor/i.test(text)) {
    return ErrorCategory.AUTHENTICATION_FAILURE;
  }
  if (/400|invalid request|invalid_api|bad request/i.test(text)) {
    return ErrorCategory.INVALID_REQUEST;
  }
  if (/empty response|invalid json|unexpected response|malformed|parse/i.test(text)) {
    return ErrorCategory.MALFORMED_RESPONSE;
  }
  if (/insufficient|no data|unavailable data/i.test(text)) {
    return ErrorCategory.INSUFFICIENT_DATA;
  }
  if (/cancelled|cancel/i.test(text)) {
    return ErrorCategory.USER_CANCELLED;
  }
  if (/500|502|503|504|5xx|unavailable|service/i.test(text)) {
    return ErrorCategory.PROVIDER_UNAVAILABLE;
  }
  return ErrorCategory.PROVIDER_UNAVAILABLE;
}

export function categoryMetadata(category) {
  return CATEGORY_HINT[category] || CATEGORY_HINT[ErrorCategory.APPLICATION_ERROR];
}

/**
 * Create a normalized task error object. `technical` is only ever used for
 * server-side logs; `message` and `category` are safe to surface.
 */
export function toNormalizedError(error, providerId = '') {
  const category = classifyProviderError(error, providerId);
  return {
    category,
    message: categoryMetadata(category).message,
    retryable: categoryMetadata(category).retryable,
    provider: providerId || null,
    technical: undefined, // populated by callers when safe
  };
}