# PROJECT SCOPE SCHEMA — Digital Factory Rules (Must Always Follow)

This file is your reference for scope validation. Every task, every n8n workflow, every code change MUST pass these rules.

## 1. Core Mission (From ChatGPT Assessment)

**STOP:** "Automation experiment that generates AI Productivity Toolkit"
**START:** "Micro SaaS Content Factory that ships premium outcome-driven products"

> People buy outcomes, not toolkits.

### ❌ FORBIDDEN (Reject Immediately)

- Generic name like "AI Productivity Toolkit", "AI Tools Bundle", "100 AI Prompts"
- Product that doesn't solve ONE painful problem for ONE avatar
- Description that starts "In today's fast-paced world..."
- Shipping production assets to customer (guide.html, sales.md, seo.md)
- Stopping pipeline at ZIP creation
- Price without reason
- No evaluation gate

### ✅ REQUIRED (Must Have)

- Brandable name with ™: `FreelancerFlow AI™`, `ProposalPilot™`, `CreatorSprint™`
- Outcome in title: "Get 3-5 High-Ticket Clients in 30 Days Without Cold Calling"
- Avatar specific: "Freelancers $1-3k/mo who want $5k retainers"
- Pain + Dream Outcome: Measurable, time-bound
- 6-8 modules that are outcomes, not features
- Evaluation scores: Demand, Competition, Value, Price, Confidence, Overall >=7
- Pricing tiers: Basic $19, Standard $49, Premium $99 + Reason + Bundle With
- File structure: Customer/ (only buyer gets) vs Publishing/ (marketing) vs Internal/ (logs)
- Publishing assets: 13 files minimum (gumroad.md, etsy.md, shopify.html, seo.txt, hashtags, twitter thread, linkedin, facebook, pinterest, instagram, email)
- Cover & Thumbnail: SVG premium source + PNG
- Pipeline continues after ZIP: Cover → Thumbnail → Listing → Description → SEO → Social → Publishing Folder → Ecommerce Upload

## 2. File Structure Schema (Validation)

```
Products/<kebab-slug>/
├── Customer/               ← ONLY these shipped
│   ├── START_HERE.pdf/.txt
│   ├── User_Guide.pdf      ← 2500-3500 words, 6 modules tactical
│   ├── Prompt_Library.pdf  ← 60+ prompts, copy-paste, variables [NICHE]
│   ├── Bonus_Checklist.pdf ← 30-50 items, 3 phases
│   ├── Resources.pdf       ← Tools, templates, communities
│   ├── Bonus.pdf           ← 7-day quick start + 3 case studies
│   ├── License.txt
│   ├── Cover.png / cover.jpg
│   ├── Thumbnail.png / thumbnail.jpg
│   ├── Cover.svg (premium source)
│   └── <slug>.zip
├── Publishing/             ← NEVER shipped to customer
│   ├── listing.txt
│   ├── listing.json        ← Combined meta
│   ├── gumroad.md          ← 400-600 words, Hook, Who For, Pain, Inside, Outcome, Bonus, FAQ
│   ├── etsy.md             ← 600 chars Etsy optimized
│   ├── shopify.html
│   ├── payhip.txt
│   ├── seo.txt             ← Slug, Title Tag, Meta, Keywords, Etsy tags
│   ├── hashtags.txt        ← 20 hashtags without #
│   ├── twitter.txt         ← Launch 280 char + 5-tweet thread
│   ├── linkedin.txt        ← 400 words story + CTA
│   ├── facebook.txt        ← 150 words
│   ├── pinterest.txt
│   ├── instagram.txt
│   └── email.txt           ← Subject, Preview, Body 400 words
├── Internal/               ← Regen logs
│   ├── generation.json
│   ├── guide.md
│   ├── prompts.md
│   ├── sales.md
│   ├── seo.md
│   └── prompt_log.json
├── quality_report.json     ← {overall:8.2, verdict:APPROVED, demand:9...}
└── release_manifest.json
```

**Validation:** If Customer/ contains `sales.md` or `seo.md` → FAIL. Move to Internal/.

## 3. Product Quality Schema (JSON)

```json
{
  "slug": "kebab-case",
  "brand_name": "FreelancerFlow AI™ (must include ™)",
  "title": "Outcome-driven, measurable, time-bound",
  "outcome": "Transform from X to Y in Z days",
  "tagline": "Social proof placeholder 2,400+",
  "avatar": "Specific age/revenue/pain/platform",
  "pain": "No predictable lead flow...",
  "dream_outcome": "3-5 leads/week, 60% close, $2k/client",
  "core_modules": ["Outcome 1", "Outcome 2", "Outcome 3", "Outcome 4", "Outcome 5", "Outcome 6"],
  "deliverables": ["User_Guide.pdf 60 pages", "Prompt_Library 62 prompts"],
  "differentiation": "Why not generic AI slop",
  "price_point": 49,
  "price_reason": "Comparable courses $99-299, but tactical OS $49 impulse",
  "bundle_with": ["Product 1", "Product 2"],
  "keywords": ["10 keywords"],
  "est_demand": "high/medium/low",
  "competition_level": "high/medium/low"
}
```

## 4. Evaluation Schema (Gate)

```json
{
  "demand_score": "1-10",
  "competition_score": "1-10 (10=low good)",
  "value_score": "1-10",
  "price_score": "1-10",
  "market_confidence": "1-10",
  "overall": "avg must >=7.0",
  "verdict": "APPROVED/REJECTED",
  "suggested_price": 49,
  "price_tiers": {"basic":19,"standard":49,"premium":99}
}
```

If overall <7 → REJECT → Regenerate max 2 retries

## 5. n8n Workflow Scope Rules

Master must: Schedule+Manual → Config → Idea → Eval → IF Approved? → Content Factory (5 parallel) → HTML-PDF → Publishing → Packager+Cover+ZIP → Ecommerce

Sub-workflows must be SEPARATE workflows, not merged. Your screenshot shows 14 nodes merged (master+idea) in one workflow named "02 - IDEA GENERATOR" → WRONG. Should be 8 separate workflows.

Use 00-ALL-IN-ONE-SIMPLE for beginners (single canvas, no sub-workflow calls).

## 6. Ecommerce Scope

Support Gumroad via HTTP Request minimum. Others via nodes.

## 7. Windows 11 + Groq Free

No native deps, must work with `npm install --omit=optional`, short path C:/factory, Groq models llama-3.3-70b-versatile + 3.1-8b-instant, handle 429 with Wait.

## 8. Validation Checklist

- [ ] Name has ™ and outcome?
- [ ] Customer/ no sales.md/seo.md?
- [ ] Publishing/ has 13+ files?
- [ ] quality_report.json overall>=7?
- [ ] Cover.svg exists?
- [ ] Pipeline continues after ZIP?
- [ ] Works with npm install --omit=optional?
- [ ] n8n workflows separated not merged?
- [ ] Step-by-step pathway given?
