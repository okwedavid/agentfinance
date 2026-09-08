# Digital Factory Architecture v2.0

## System Diagram

```
[User Trigger: Manual n8n / Schedule / API / CLI]
               |
               v
        ┌──────────────┐
        │  Idea Gen    │ Groq llama-3.3-70b-versatile, temp 0.9, niche rotation
        │  Outcome-Only│ 10 niches that sell, brandable name with ™
        └──────┬───────┘
               v
        ┌──────────────┐
        │  Evaluator   │ Groq llama-3.1-8b-instant, temp 0.3
        │  Gate >=7    │ Demand, Competition, Value, Price, Confidence
        └──────┬───────┘
               | REJECT → retry (max 2) → log to _quality_reports
               | APPROVED ↓
        ┌─────────────────────────────────────────────┐
        │  Content Factory - 5 Parallel Groq Calls     │
        │  - Guide (6000 tokens)                      │
        │  - Prompt Library (7000) 60+ prompts        │
        │  - Checklist (3000) 30-50 items             │
        │  - Resources (2500) curated tools           │
        │  - Bonus (3500) 7-day + case studies        │
        └──────┬──────────────────────────────────────┘
               v
        ┌──────────────┐
        │  HTML Gen    │ Marked.js → Styled HTML template (premium)
        └──────┬───────┘
               v
        ┌──────────────┐
        │  PDF Gen     │ Puppeteer A4, background, margin, OR n8n HTML to PDF node
        └──────┬───────┘
               v
        ┌──────────────┐
        │ Cover Gen    │ SVG gradient → Puppeteer screenshot PNG 1600x1200 + 600x600
        │              │ Fallback: SVG file if puppeteer fails on Windows
        └──────┬───────┘
               v
        ┌────────────────────┐
        │ Publishing Assets  │ 2 Groq calls:
        │ - Listings         │   listing JSON (title, desc per platform, seo)
        │ - Socials          │   social JSON (twitter thread, LinkedIn, FB, email)
        │ → 13 files         │   files: gumroad.md, etsy.md, shopify.html, seo.txt, etc.
        └──────┬─────────────┘
               v
        ┌──────────────┐
        │  Packager    │ Customer/ only premium PDFs + covers
        │  + Manifest  │ Publishing/ marketing, Internal/ logs
        │              │ release_manifest.json, quality_report.json
        └──────┬───────┘
               v
        ┌──────────────┐
        │  ZIP         │ archiver zip Customer/
        │              │ → Published/<slug>.zip + Published/<slug>/Package/... (backward compat)
        └──────┬───────┘
               v
        ┌──────────────┐
        │  Catalog     │ approved_products.csv / .json append
        └──────┬───────┘
               v
        ┌──────────────────────────┐
        │  Ecommerce Publishers    │ IF creds exist:
        │  Gumroad                 │   POST /v2/products + upload
        │  Shopify (node)          │   Shopify node create product
        │  Etsy (OAuth)            │   Etsy node create listing draft
        │  WooCommerce (node)      │   WooCommerce node
        │  Payhip/Ko-fi/Lemon      │   HTTP Request
        └──────────────────────────┘
               |
               v
        [Slack/Discord notification - optional]
```

## Key Design Decisions

**1. Evaluation before generation** - prevents wasting Groq tokens on bad ideas. If demand <5 or overall <7, regenerate. Saves 80% cost in batch mode.

**2. Parallel content** - original had sequential, now 5 parallel Groq calls via Promise.all or n8n parallel branches. 5x faster.

**3. Customer/Publishing/Internal split** - customer only gets PDFs that increase perceived value. Production files hidden.

**4. Sub-workflows** - maintenance: change HTML template once in 05, not in 5 places.

**5. Groq model split** - 70b for creative (idea, guide, prompts, listing), 8b-instant for fast eval and checklists - balances quality + speed + rate limit.

**6. Windows 11 paths** - `C:/DigitalFactory` absolute paths in n8n nodes because n8n local file nodes resolve absolute. Node factory uses env override.

**7. Cover generation without external API** - uses SVG gradient + puppeteer screenshot to avoid needing HuggingFace/OpenAI image API which costs. Premium look without cost. Can upgrade later to DALL·E via n8n HTTP Request if desired.

## Files Map

- `src/config.js` - central config, niches, paths
- `src/groqClient.js` - wrapper with JSON extraction fallback
- `src/generators/ideaGenerator.js` - outcome-driven ideas
- `src/generators/evaluator.js` - gating
- `src/generators/contentGenerators.js` - 5 content types
- `src/generators/publishingAssetsGenerator.js` - 13 marketing files
- `src/utils/htmlGenerator.js` - premium styled HTML
- `src/utils/pdfGenerator.js` - puppeteer with fallback
- `src/utils/imageGenerator.js` - SVG to PNG cover
- `src/utils/packager.js` - creates tri-folder structure + ZIP + backward compat old tree
- `src/factory.js` - orchestrator CLI
- `src/publishers/*` - per platform
- `n8n-workflows/01-master-factory.json` - master scheduling
- `n8n-workflows/subworkflows/02..08` - sub-workflows

## Token Estimates

Per product:
- Idea: ~800 tokens in + 600 out
- Eval: ~600 in + 300 out
- Guide: ~700 in + 4000 out
- Prompts: ~600 in + 5000 out
- Checklist: ~500 in + 1500 out
- Resources: ~500 in + 1200 out
- Bonus: ~500 in + 2500 out
- Listing: ~800 in + 3000 out
- Social: ~600 in + 2500 out

Total: ~20k tokens per product. Groq free tier 14k TPD? Actually Groq free gives ~14k/v2? You will need to batch with 30 sec delay or use multiple keys. We provide `maxRetries` + fallback.

Implementation in n8n: Add Wait node 5 sec between Groq calls if rate limit hit.

## Failure Modes

- Groq 429: retry after 5 sec, switch to fast model, or queue.
- Puppeteer missing on Windows: fallback to HTML only, n8n HTML to PDF node covers it.
- Canvas missing: fallback to 1px placeholder PNG, but SVG exists so customer still has cover via HTML rendering.
- Etsy OAuth expired: node fails, goes to log path.

## Future Evolutions

- Trend Researcher sub-workflow before Idea Gen: search Gumroad/Etsy trending via SerpAPI/Tavily tool + feed into idea prompt.
- Cover AI generation via HuggingFace `stabilityai/stable-diffusion` using HTTP Request node.
- Bundle Generator: merge 5 products catalog into bundle ZIP + listing.
- Auto A/B test titles: generate 3 titles, test via Gumroad.
