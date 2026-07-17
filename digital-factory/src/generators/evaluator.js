/**
 * Product Evaluator - Gates bad products before generation
 * Scores: Demand, Competition, Value, Price, Confidence
 */
import { groqJSON } from '../groqClient.js';
import { CONFIG } from '../config.js';

const SYSTEM = `You are a ruthless product evaluator for digital marketplaces (Gumroad, Etsy, Payhip, Shopify).
You score product ideas against what ACTUALLY sells.
Scoring:
- Demand Score 1-10: Search volume, pain intensity, willingness to pay
- Competition 1-10: 10 = low competition (good), 1 = saturated
- Value Score 1-10: How concrete is outcome?
- Pricing Fit 1-10: Does price match value?
- Market Confidence 1-10: Would YOU pay for this?

Output JSON only.`;

export async function evaluateProduct(idea) {
  const userPrompt = `
Evaluate this product idea:

Title: ${idea.title}
Brand: ${idea.brand_name}
Avatar: ${idea.avatar}
Pain: ${idea.pain}
Outcome: ${idea.dream_outcome}
Price: $${idea.price_point}
Modules: ${JSON.stringify(idea.core_modules)}

Return JSON:
{
  "demand_score": 8,
  "competition_score": 7,
  "value_score": 9,
  "price_score": 8,
  "market_confidence": 8,
  "overall": 8.0,
  "verdict": "APPROVED or REJECTED",
  "reason": "short reason",
  "suggested_price": 49,
  "price_tiers": {"basic": 19, "standard": 49, "premium": 99},
  "target_audience_detailed": "detailed avatar",
  "improvement_tips": ["tip1","tip2"],
  "risk_flags": []
}

Overall = avg of 5 scores. APPROVED if overall >= ${CONFIG.factory.minQualityScore}.
REJECT if generic, vague, or toolkit slop.
`;

  const evalResult = await groqJSON({
    system: SYSTEM,
    user: userPrompt,
    model: CONFIG.groq.fastModel,
    temperature: 0.3,
  });

  if (!evalResult.overall) {
    const avg = (evalResult.demand_score + evalResult.competition_score + evalResult.value_score + evalResult.price_score + evalResult.market_confidence) / 5;
    evalResult.overall = Math.round(avg * 10)/10;
  }
  if (!evalResult.verdict) {
    evalResult.verdict = evalResult.overall >= CONFIG.factory.minQualityScore ? 'APPROVED' : 'REJECTED';
  }
  return evalResult;
}

export function filterApproved(evaluatedIdeas) {
  return evaluatedIdeas.filter(e => e.evaluation.verdict === 'APPROVED' && e.evaluation.overall >= CONFIG.factory.minQualityScore);
}
