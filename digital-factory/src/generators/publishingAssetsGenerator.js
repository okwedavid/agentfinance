/**
 * Publishing Assets Generator
 * Creates all listing, SEO, social assets for multi-platform launch
 */
import { groqJSON, groqText } from '../groqClient.js';

export async function generatePublishingAssets(idea, evaluation) {
  console.log(`📢 Generating publishing assets for ${idea.brand_name}...`);

  const system = `You are a Gumroad + Etsy + Shopify top seller copywriter. You write listings that convert at 8-12%.
Rules:
- Outcome > Features
- Use social proof placeholders ("2,400+ freelancers")
- Price anchors
- Call to action
- SEO optimized but human
- JSON output only when asked; otherwise text`;

  const baseContext = `
Product: ${idea.title}
Brand: ${idea.brand_name}
Tagline: ${idea.tagline}
Avatar: ${idea.avatar}
Pain: ${idea.pain}
Outcome: ${idea.dream_outcome}
Modules: ${JSON.stringify(idea.core_modules)}
Price: $${idea.price_point} (tiers $${evaluation.price_tiers?.basic || 19}/$${evaluation.suggested_price}/$${evaluation.price_tiers?.premium || 99})
Keywords: ${idea.keywords?.join(', ')}
Differentiation: ${idea.differentiation}
`;

  // Parallel generate social assets via Groq
  const [listingJSON, socials] = await Promise.all([
    groqJSON({
      system: system + `\nReturn JSON.`,
      user: `${baseContext}

Return JSON:
{
  "title": "60-char max Etsy optimized title",
  "long_title": "Full Gumroad title with outcome",
  "short_description": "1 sentence, <120 char for thumbnail",
  "description_gumroad_md": "Markdown, 400-600 words, sections: Hook, Who For, Pain, What Inside, Outcome, Bonus, FAQ",
  "description_etsy": "Etsy optimized, bullet points, personal tone, 600 chars",
  "description_shopify": "Shopify long description HTML friendly, 500 words",
  "description_payhip": "Payhip version 300 words",
  "seo_tags": ["10 tags gumroad"],
  "seo_slug": "url-slug-like-ai-freelancer-os",
  "hashtags": ["20 hashtags without #"],
  "categories": ["Gumroad categories"],
  "etsy_tags": ["13 etsy tags max 20 chars each"],
  "keywords_csv": "comma separated 30 keywords",
  "price_copy": "Why $X",
  "faq": [{"q":"...","a":"..."} 5 items],
  "whats_included": ["7 bullets"]
}
`,
      temperature: 0.7,
      maxTokens: 5000,
    }),
    groqJSON({
      system: `You are viral social media manager for digital products. Write high-converting social copy. Return JSON.`,
      user: `${baseContext}
Return JSON:
{
  "twitter_post": "280 char launch tweet with outcome + price + link placeholder",
  "launch_tweet_thread": "5-tweet thread announcing product",
  "linkedin_post": "400 words professional story + pain + outcome + CTA",
  "facebook_caption": "150 words friendly",
  "pinterest_pin_title": "title",
  "pinterest_pin_desc": "500 chars SEO",
  "instagram_caption": "150 words",
  "email_campaign": {"subject":"subject line","preview":"preview","body":"400 words email"},
  "product_hunt_tagline": "60 char"
}
`,
      temperature: 0.85,
      maxTokens: 4000,
    }),
  ]);

  // Compose files
  const files = {
    'listing.txt': `TITLE: ${listingJSON.long_title}
SHORT: ${listingJSON.short_description}
SLUG: ${listingJSON.seo_slug}
PRICE: $${evaluation.suggested_price}
PRICE TIERS: Basic $${evaluation.price_tiers.basic} | Standard $${evaluation.suggested_price} | Premium $${evaluation.price_tiers.premium}
`,

    'gumroad.md': `${listingJSON.long_title}

${listingJSON.description_gumroad_md}

---
What's Included:
${listingJSON.whats_included?.map(b=>`- ${b}`).join('\n')}

Tags: ${listingJSON.seo_tags?.join(', ')}

FAQ:
${listingJSON.faq?.map(f=>`Q: ${f.q}\nA: ${f.a}`).join('\n\n')}
`,

    'etsy.md': `${listingJSON.title}

${listingJSON.description_etsy}

What's Included:
${listingJSON.whats_included?.join('\\n')}

Tags: ${listingJSON.etsy_tags?.join(', ')}

Digital download - instant.
`,

    'shopify.html': `<h2>${listingJSON.long_title}</h2>
<p><em>${listingJSON.short_description}</em></p>
<div>${listingJSON.description_shopify}</div>
<h3>What's Included</h3>
<ul>${listingJSON.whats_included?.map(i=>`<li>${i}</li>`).join('')}</ul>
`,

    'payhip.txt': listingJSON.description_payhip,

    'seo.txt': `Slug: ${listingJSON.seo_slug}
Title Tag: ${listingJSON.long_title} | ${idea.brand_name}
Meta Description: ${listingJSON.short_description}
Keywords: ${listingJSON.keywords_csv}
Etsy Tags: ${listingJSON.etsy_tags?.join(', ')}
`,

    'hashtags.txt': (listingJSON.hashtags || []).map(t=>`#${t.replace(/^#/,'')}`).join(' '),

    'twitter.txt': `${socials.twitter_post}

--- THREAD ---
${socials.launch_tweet_thread}
`,

    'linkedin.txt': socials.linkedin_post,
    'facebook.txt': socials.facebook_caption,
    'pinterest.txt': `Title: ${socials.pinterest_pin_title}\nDesc: ${socials.pinterest_pin_desc}`,
    'instagram.txt': socials.instagram_caption,
    'email.txt': `Subject: ${socials.email_campaign?.subject}
Preview: ${socials.email_campaign?.preview}

${socials.email_campaign?.body}
`,
  };

  // full combined object for API
  const combined = {
    ...listingJSON,
    ...socials,
    files,
    meta: {
      brand_name: idea.brand_name,
      title: idea.title,
      slug: listingJSON.seo_slug || idea.slug,
      price: evaluation.suggested_price,
      avatar: idea.avatar,
      outcome: idea.dream_outcome,
    }
  };

  return combined;
}
