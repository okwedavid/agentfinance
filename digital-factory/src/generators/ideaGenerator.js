/**
 * Idea Generator - Outcome oriented, not toolkit
 * People buy outcomes, not toolkits.
 */
import { groqJSON } from '../groqClient.js';
import { CONFIG } from '../config.js';

const SYSTEM = `You are a premium digital product strategist. You create products that SELL on Gumroad/Etsy/Shopify.
RULES:
- Never generate generic "AI Toolkit". Always generate outcome-driven products.
- Each product must solve ONE painful problem for ONE avatar with MEASURABLE outcome.
- Price must be justifiable: $19-$99
- Think like Hormozi: Value = (Dream Outcome x Perceived Likelihood) / (Time Delay x Effort)
- Output valid JSON only.`;

export async function generateProductIdea(nicheHint = null) {
  const niches = CONFIG.factory.niches;
  const randomNiche = nicheHint || niches[Math.floor(Math.random() * niches.length)];

  const userPrompt = `
Generate ONE premium digital product idea that fits this direction: "${randomNiche}"

Return JSON with this exact schema:
{
  "slug": "kebab-case-like-ai-freelancer-client-os",
  "brand_name": "FreelancerFlow AI™",
  "title": "AI Client Acquisition OS for Freelancers: Get 3-5 High-Ticket Clients in 30 Days Without Cold Calling",
  "outcome": "Transform from inconsistent gigs to predictable $5k/month retainers",
  "tagline": "The plug-and-play system 2,400+ freelancers use",
  "avatar": "Freelancers earning $1-3k/mo who want to hit $5k+ retainers",
  "pain": "No predictable lead flow, low rates, wasting time writing proposals that get ignored",
  "dream_outcome": "3-5 qualified leads/week, 60% close rate, $2k+ per client",
  "core_modules": ["Module list 6-8 items, each is outcome not feature"],
  "deliverables": ["What customer actually downloads - PDF guides, prompt libs, checklists, templates"],
  "differentiation": "Why this is not generic AI slop - what unique framework/method",
  "price_point": 49,
  "price_reason": "why this price",
  "bundle_with": ["Product 1", "Product 2"],
  "keywords": ["10 seo keywords"],
  "est_demand": "high/medium/low",
  "competition_level": "high/medium/low"
}

Make it premium, specific, tangible. Name must be brandable with ™.
`;

  const idea = await groqJSON({
    system: SYSTEM,
    user: userPrompt,
    temperature: 0.9,
  });

  // Normalize
  if (!idea.slug) idea.slug = idea.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60);
  return idea;
}

export async function generateBatch(count = 5) {
  const ideas = [];
  for (let i=0; i<count; i++) {
    const idea = await generateProductIdea();
    ideas.push(idea);
    console.log(`💡 [${i+1}/${count}] ${idea.brand_name} - ${idea.title}`);
  }
  return ideas;
}
