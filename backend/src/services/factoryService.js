/**
 * Factory Service - Bridges Node factory logic into AgentFinance backend via Groq
 * Reuses Groq cascade from agentRunner but adds product-specific logic
 */
import Groq from 'groq-sdk';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const FAST_MODEL = process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant';

function getGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing');
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

async function groqJSON({ system, user, model = GROQ_MODEL, temperature = 0.7 }) {
  const groq = getGroq();
  const res = await groq.chat.completions.create({
    model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  const content = res.choices[0]?.message?.content || '{}';
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Invalid JSON from Groq');
  }
}

async function groqText({ system, user, model = GROQ_MODEL, temperature = 0.7, maxTokens = 4000 }) {
  const groq = getGroq();
  const res = await groq.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  return res.choices[0]?.message?.content || '';
}

export async function generateIdeaService(nicheHint = null) {
  const niches = [
    'AI Freelancer Client Acquisition OS',
    '30-Day AI Content Engine for Coaches',
    'AI Proposal Writing System',
    'AI Student Research Vault',
    'AI Job Application Accelerator',
    'AI Real Estate Lead Machine',
    'Notion + AI Second Brain for Founders',
    'AI YouTube Script & Thumbnail System',
    'AI Cold Email & LinkedIn Outreach OS',
    'AI Digital Product Launch Kit'
  ];
  const niche = nicheHint || niches[Math.floor(Math.random() * niches.length)];

  const idea = await groqJSON({
    system: `You are premium digital product strategist. Outcome-driven, brandable name with ™. JSON only.`,
    user: `Generate ONE premium product for niche: "${niche}". Return JSON: slug (kebab), brand_name with ™, title (outcome), outcome, tagline, avatar, pain, dream_outcome, core_modules[6-8], deliverables[], differentiation, price_point, price_reason, bundle_with[], keywords[10], est_demand, competition_level`,
    temperature: 0.9,
  });

  if (!idea.slug) idea.slug = idea.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60);
  return idea;
}

export async function evaluateIdeaService(idea) {
  const evaluation = await groqJSON({
    system: `You are ruthless product evaluator for Gumroad/Etsy. Score 1-10: Demand, Competition (10=low), Value, Price, Confidence. Overall=avg. APPROVED if >=7. JSON only.`,
    user: `Evaluate: Title: ${idea.title} Brand: ${idea.brand_name} Avatar: ${idea.avatar} Pain: ${idea.pain} Outcome: ${idea.dream_outcome} Price: ${idea.price_point} Modules: ${JSON.stringify(idea.core_modules)}. Return JSON: {demand_score, competition_score, value_score, price_score, market_confidence, overall, verdict APPROVED/REJECTED, reason, suggested_price, price_tiers:{basic,standard,premium}, target_audience_detailed}`,
    model: FAST_MODEL,
    temperature: 0.3,
  });

  if (!evaluation.overall) {
    const avg = (evaluation.demand_score + evaluation.competition_score + evaluation.value_score + evaluation.price_score + evaluation.market_confidence)/5;
    evaluation.overall = Math.round(avg*10)/10;
  }
  if (!evaluation.verdict) evaluation.verdict = evaluation.overall >= 7 ? 'APPROVED' : 'REJECTED';
  return evaluation;
}

export async function generateContentService(idea) {
  // Parallel
  const [guide, prompts, checklist, resources, bonus] = await Promise.all([
    groqText({
      system: `You are premium digital product author. Write $99-worthy guide. No fluff. Tactical frameworks. 2500-3500 words markdown.`,
      user: `Write MAIN GUIDE for ${idea.title} Brand: ${idea.brand_name} Outcome: ${idea.dream_outcome} Avatar: ${idea.avatar} Pain: ${idea.pain} Modules: ${JSON.stringify(idea.core_modules)}`,
      maxTokens: 6000,
      temperature: 0.75
    }),
    groqText({
      system: `You are prompt engineer. 60+ copy-paste prompts with variables. Markdown.`,
      user: `Prompt Library for ${idea.brand_name} Outcome: ${idea.dream_outcome} Avatar: ${idea.avatar} Modules: ${JSON.stringify(idea.core_modules)}`,
      maxTokens: 6000,
      temperature: 0.8
    }),
    groqText({
      system: `Create premium checklist markdown checkbox 30-50 items.`,
      user: `Checklist for ${idea.brand_name} Outcome: ${idea.dream_outcome}`,
      maxTokens: 3000,
      model: FAST_MODEL
    }),
    groqText({
      system: `Curate tools, real names, markdown.`,
      user: `Resources vault for ${idea.brand_name} Avatar ${idea.avatar}`,
      maxTokens: 2500,
      model: FAST_MODEL
    }),
    groqText({
      system: `Create bonus increasing value 2x tactical.`,
      user: `Bonus 7-day Quick Start + 3 case studies for ${idea.brand_name} Avatar ${idea.avatar}`,
      maxTokens: 3500,
      model: FAST_MODEL
    })
  ]);

  return { guide, prompts, checklist, resources, bonus };
}

export async function generatePublishingService(idea, evaluation) {
  const listing = await groqJSON({
    system: `You are Gumroad+Etsy top seller copywriter. 8-12% conversion. JSON only.`,
    user: `Product: ${idea.title} Brand: ${idea.brand_name} Avatar: ${idea.avatar} Pain: ${idea.pain} Outcome: ${idea.dream_outcome} Modules: ${JSON.stringify(idea.core_modules)} Price: ${evaluation.suggested_price} Keywords: ${idea.keywords?.join(', ')}. Return JSON: {title 60char Etsy, long_title, short_description 120char, description_gumroad_md 400-600 words, description_etsy 600 chars, description_shopify 500 words, description_payhip 300 words, seo_tags[10], seo_slug, hashtags[20], categories[], etsy_tags[13], keywords_csv 30, price_copy, faq[5 {q,a}], whats_included[7]}`,
    temperature: 0.7,
  });

  const socials = await groqJSON({
    system: `You are viral social media manager. JSON only.`,
    user: `Product: ${idea.title} Brand: ${idea.brand_name} Outcome: ${idea.dream_outcome} Avatar: ${idea.avatar}. Return JSON: {twitter_post 280char, launch_tweet_thread 5-tweet thread, linkedin_post 400 words, facebook_caption 150 words, pinterest_pin_title, pinterest_pin_desc 500 SEO, instagram_caption 150 words, email_campaign:{subject, preview, body 400 words}}`,
    temperature: 0.85,
  });

  return { ...listing, ...socials };
}

export async function fullFactoryRun({ nicheHint, userId = null, persist = true } = {}) {
  // Import prisma dynamically to avoid circular
  const { default: prisma } = await import('../prismaClient.js');

  const idea = await generateIdeaService(nicheHint);
  const evaluation = await evaluateIdeaService(idea);

  if (evaluation.verdict === 'REJECTED' || evaluation.overall < 7) {
    if (persist) {
      await prisma.digitalProduct.create({
        data: {
          slug: idea.slug + '-' + Date.now().toString(36),
          brandName: idea.brand_name,
          title: idea.title,
          outcome: idea.dream_outcome,
          avatar: idea.avatar,
          status: 'rejected',
          evaluation,
          manifest: { idea, evaluation },
          userId,
          price: idea.price_point || 49,
        }
      });
    }
    return { idea, evaluation, verdict: 'REJECTED' };
  }

  const contents = await generateContentService(idea);
  const publishing = await generatePublishingService(idea, evaluation);

  const readme = `# ${idea.brand_name}\n${idea.title}\n\n${idea.tagline}\n\nOutcome: ${idea.dream_outcome}\nAvatar: ${idea.avatar}\n\nPrice: $${evaluation.suggested_price}\n`;

  const license = `PERSONAL USE LICENSE © 2026`;

  const startHere = `START HERE - ${idea.brand_name}\n\nOutcome: ${idea.dream_outcome}\nQuick Start: Read guide module 1, implement quick win.`;

  const files = {
    guide: contents.guide.slice(0, 500) + '...',
    // full content stored in publishingAssets
  };

  let product = null;
  if (persist) {
    product = await prisma.digitalProduct.create({
      data: {
        slug: idea.slug,
        brandName: idea.brand_name,
        title: idea.title,
        outcome: idea.dream_outcome,
        tagline: idea.tagline,
        avatar: idea.avatar,
        pain: idea.pain,
        dreamOutcome: idea.dream_outcome,
        price: evaluation.suggested_price || idea.price_point || 49,
        priceTiers: evaluation.price_tiers,
        keywords: idea.keywords,
        bundleWith: idea.bundle_with,
        modules: idea.core_modules,
        deliverables: idea.deliverables,
        differentiation: idea.differentiation,
        status: 'approved',
        evaluation,
        files: contents,
        publishingAssets: publishing,
        internal: { readme, license, startHere, idea },
        manifest: { idea, evaluation, publishing, created_at: new Date().toISOString() },
        userId,
      }
    });
  }

  return {
    idea,
    evaluation,
    contents,
    publishing,
    readme,
    product,
    verdict: 'APPROVED',
    manifest: {
      slug: idea.slug,
      brand_name: idea.brand_name,
      title: idea.title,
      price: evaluation.suggested_price,
      overall: evaluation.overall,
    }
  };
}
