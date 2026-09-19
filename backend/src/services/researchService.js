/**
 * researchService.js — resilient research pipeline.
 *
 * Task
 *  -> Research/data retrieval (verified factual evidence only)
 *  -> Structured evidence
 *  -> LLM synthesis (provider cascade)
 *  -> Validated result
 *
 * If the LLM is temporarily unavailable the pipeline returns a graceful
 * PARTIAL result built from the verified evidence and clearly states that AI
 * synthesis was unavailable. It NEVER fabricates numbers, protocols or risks.
 */
import { executeTool } from '../tools/toolExecutor.js';
import { getActiveProviders } from '../providers/providerFactory.js';
import { toNormalizedError, ErrorCategory } from '../providers/normalizedError.js';
import logger from '../utils/logger.js';

function fetchJson(url, { timeoutMs = 8000, headers = {} } = {}) {
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

async function gatherDeFiYields() {
  try {
    const data = await fetchJson('https://yields.llama.fi/pools');
    const pools = (data.data || [])
      .filter((pool) => pool.apy > 0 && pool.tvlUsd > 1_000_000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 10)
      .map((pool) => ({
        protocol: pool.project,
        symbol: pool.symbol,
        apyPct: Number(pool.apy.toFixed(2)),
        tvlUsd: Math.round(pool.tvlUsd),
        chain: pool.chain,
        ilRisk: pool.ilRisk || null,
      }));
    return { ok: true, protocol: 'defillama', pools };
  } catch (error) {
    return { ok: false, reason: `DeFiLlama unavailable: ${error.message}` };
  }
}

async function gatherPrices() {
  const ids = ['bitcoin', 'ethereum', 'solana', 'tether'];
  try {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
      { headers: process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {} },
    );
    const prices = ids.map((id) => {
      const row = data[id];
      if (!row) return null;
      return {
        coin: id,
        priceUsd: row.usd ?? null,
        change24hPct: row.usd_24h_change != null ? Number(row.usd_24h_change.toFixed(2)) : null,
        marketCapUsd: row.usd_market_cap ?? null,
      };
    }).filter(Boolean);
    return { ok: prices.length > 0, protocol: 'coingecko', prices };
  } catch (error) {
    return { ok: false, reason: `CoinGecko unavailable: ${error.message}` };
  }
}

async function gatherSentiment() {
  try {
    const data = await fetchJson('https://api.alternative.me/fng/?limit=1');
    const fng = data.data?.[0];
    if (!fng) return { ok: false, reason: 'No fear & greed data' };
    return {
      ok: true,
      protocol: 'alternative.me',
      fearGreed: `${fng.value_classification} (${fng.value}/100)`,
    };
  } catch (error) {
    return { ok: false, reason: `Fear & greed unavailable: ${error.message}` };
  }
}

async function gatherWebEvidence(query) {
  if (!process.env.TAVILY_API_KEY && !process.env.SERPER_API_KEY) {
    return { ok: false, reason: 'Web search not enabled (TAVILY_API_KEY missing)' };
  }
  try {
    const result = await executeTool('search_web', { query: String(query).slice(0, 200) });
    return { ok: true, protocol: 'web_search', summary: String(result) };
  } catch (error) {
    return { ok: false, reason: `Web search failed: ${error.message}` };
  }
}

/**
 * Gather verified factual evidence relevant to the research action. Every
 * block is real fetched data; errors are reported per-source and never
 * converted into invented numbers.
 */
export async function gatherResearchEvidence({ action, agentType = 'research' }) {
  const [yields, prices, sentiment, web] = await Promise.all([
    gatherDeFiYields(),
    gatherPrices(),
    gatherSentiment(),
    gatherWebEvidence(action),
  ]);

  return {
    retrievedAt: new Date().toISOString(),
    action,
    yields,
    prices,
    sentiment,
    web,
  };
}

const RESEARCH_PROMPT = `You are a DeFi and crypto research agent synthesising REAL data.
Below is verified evidence retrieved from live sources.

STRICT RULES:
- ONLY use numbers, protocols and risks that appear in the evidence below.
- NEVER invent APYs, protocols, TVL, token prices or returns.
- If a fact is not in the evidence, say "not available in verified data".
- Clearly label each risk.
- End with a clear recommendation or "insufficient data to recommend" when the data does not support one.`;

function evidenceBlock(evidence) {
  const lines = [];
  lines.push('[VERIFIED EVIDENCE]');
  if (evidence.sentiment?.ok) lines.push(`Sentiment: ${evidence.sentiment.fearGreed}`);

  if (evidence.prices?.ok) {
    lines.push('Prices (CoinGecko):');
    for (const price of evidence.prices.prices) {
      lines.push(`- ${price.coin}: $${price.priceUsd ?? 'n/a'} (24h ${price.change24hPct ?? 'n/a'}%)`);
    }
  } else {
    lines.push(`Prices: ${evidence.prices?.reason || 'unavailable'}`);
  }

  if (evidence.yields?.ok) {
    lines.push('Top DeFi yields (DeFiLlama):');
    for (const pool of evidence.yields.pools) {
      lines.push(`- ${pool.protocol} ${pool.symbol} on ${pool.chain}: ${pool.apyPct}% APY, TVL $${(pool.tvlUsd / 1e6).toFixed(1)}M` + (pool.ilRisk ? `, IL risk: ${pool.ilRisk}` : ''));
    }
  } else {
    lines.push(`DeFi yields: ${evidence.yields?.reason || 'unavailable'}`);
  }

  if (evidence.web?.ok) {
    lines.push(`Web evidence: ${String(evidence.web.summary).slice(0, 2500)}`);
  } else {
    lines.push(`Web evidence: ${evidence.web?.reason || 'unavailable'}`);
  }
  lines.push('[END EVIDENCE]');
  return lines.join('\n');
}

function buildPartialResult(evidence) {
  return {
    status: 'partial',
    aiSynthesisUnavailable: true,
    title: 'Research summary (AI synthesis unavailable)',
    content: [
      'AI synthesis was temporarily unavailable, so this result contains ONLY verified data gathered from live sources.',
      'No APYs, protocols, prices or returns have been invented.',
      '',
      evidenceBlock(evidence),
      '',
      'Recommendation: insufficient data to recommend because the analysis model could not verify additional context.',
    ].join('\n'),
    evidence,
  };
}

/**
 * Run a research task: evidence first, then LLM synthesis. Never fabricates.
 */
export async function runResearchTask({ action, agentType }) {
  const evidence = await gatherResearchEvidence({ action, agentType });

  const messages = [
    { role: 'system', content: RESEARCH_PROMPT },
    { role: 'user', content: `Research request: ${action}\n\n${evidenceBlock(evidence)}` },
  ];

  const providers = getActiveProviders();
  const errors = [];

  for (const provider of providers) {
    try {
      logger.info(`research provider=${provider.id} request-started=true`);
      const result = await provider.chat(messages, { tools: [] });
      logger.info(`research provider=${provider.id} request-success=true`);
      return {
        status: 'completed',
        aiSynthesisUnavailable: false,
        content: result.content,
        provider: provider.id,
        model: result.model,
        evidence,
      };
    } catch (error) {
      logger.warn(`research provider=${provider.id} error-category=${error.category || 'unknown'}`);
      errors.push(error);
    }
  }

  logger.warn(`research all-providers-failed count=${providers.length} returning-partial=true`);
  return buildPartialResult(evidence);
}

export function researchFallbackResult(evidence) {
  return buildPartialResult(evidence);
}

export { toNormalizedError, ErrorCategory };