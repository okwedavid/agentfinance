# 🚀 DIGITAL FACTORY v2.0 - AI Product Factory to Ecommerce

> **Goal:** From "automation experiment" to **micro-SaaS content factory** that ships premium digital products to Gumroad, Etsy, Shopify, WooCommerce, Payhip, Ko-fi, LemonSqueezy automatically via n8n + Groq Free API on Windows 11.

This implements the improvement plan from your ChatGPT analysis:
- ✅ Outcome-driven products (not generic toolkits)
- ✅ Brandable names `FreelancerFlow AI™`, `ProposalPilot™`
- ✅ Evaluator gate (Demand, Competition, Value)
- ✅ Pricing Recommendation
- ✅ Customer/ vs Publishing/ vs Internal/ separation
- ✅ Professional cover & thumbnail generation
- ✅ Full publishing assets (title, desc per platform, SEO, social posts)
- ✅ ZIP → auto-publish to ecommerce

---

## 📁 NEW File Structure (Recommended)

```
C:/DigitalFactory/  (or ./digital-factory/Products for dev)
│
├── Products/
│   └── ai-freelancer-client-os/
│       ├── Customer/              # ONLY what buyer gets
│       │   ├── START_HERE.pdf (and .txt/.md/.html)
│       │   ├── User_Guide.pdf  -> 6-module premium system
│       │   ├── Prompt_Library.pdf -> 60+ prompts
│       │   ├── Bonus_Checklist.pdf -> 30-day tracker
│       │   ├── Resources.pdf -> tools, communities
│       │   ├── Bonus.pdf -> 7-day quick start + case studies
│       │   ├── License.txt
│       │   ├── Cover.png / cover.jpg
│       │   ├── Thumbnail.png / thumbnail.jpg
│       │   └── ai-freelancer-client-os.zip
│       │
│       ├── Publishing/            # YOUR marketing assets (NEVER shipped)
│       │   ├── listing.txt
│       │   ├── listing.json       # full combined
│       │   ├── gumroad.md         # Gumroad long description
│       │   ├── etsy.md            # Etsy optimized 600 chars
│       │   ├── shopify.html
│       │   ├── payhip.txt
│       │   ├── seo.txt
│       │   ├── hashtags.txt
│       │   ├── twitter.txt        # launch + thread
│       │   ├── linkedin.txt
│       │   ├── facebook.txt
│       │   ├── pinterest.txt
│       │   ├── instagram.txt
│       │   └── email.txt          # email campaign
│       │
│       ├── Internal/              # Regeneration & logs
│       │   ├── generation.json
│       │   ├── guide.md
│       │   ├── prompts.md
│       │   ├── sales.md
│       │   ├── seo.md
│       │   └── prompt_log.json
│       │
│       ├── quality_report.json    # Evaluator scores
│       └── release_manifest.json  # Full manifest
│
├── Published/
│   └── ai-freelancer-client-os/
│       ├── ai-freelancer-client-os.zip
│       ├── quality_report.json
│       ├── release_manifest.json
│       ├── Listing_Assets/
│       │   ├── cover.jpg
│       │   └── thumbnail.jpg
│       └── Package/
│           └── ai-freelancer-client-os/
│               └── (copy of Customer + zip - backward compat with your old tree)
│
├── catalog/
│   ├── approved_products.csv
│   └── approved_products.json
│
└── _quality_reports/
```

**Old what NOT to ship** (now in Internal/):
- `guide.html`, `prompts.html`, `sales.md`, `seo.md` - these are production assets, not customer deliverables.

---

## ⚡ Quick Start Windows 11

### 0. Prereqs

- Windows 11, Node.js 20+, npm
- Groq free API key: https://console.groq.com/keys
- Local n8n: `npm i -g n8n`

### 1. Setup

```bat
cd digital-factory
scripts\setup-windows.bat
```

This creates `C:\DigitalFactory\Products`, `Published`, `catalog` and installs deps.

### 2. Env

Copy `.env.example` to `.env`:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_FAST_MODEL=llama-3.1-8b-instant
FACTORY_ROOT=C:/DigitalFactory
```

### 3. Generate First Product

```bat
scripts\run-factory.bat
:: or
npm run factory:single
```

This does:
- 1. Idea generation (Groq 70b)
- 2. Evaluator (Groq 8b fast, gates <7 score)
- 3. Parallel content: Guide, Prompts, Checklist, Resources, Bonus
- 4. HTML styling + PDF (puppeteer, fallback to HTML if puppeteer fails on Windows without deps)
- 5. Cover & Thumbnail (SVG gradient premium, puppeteer screenshot to PNG)
- 6. Publishing assets (listings per platform + socials)
- 7. ZIP + catalog

Check `C:\DigitalFactory\Products\`.

### 4. n8n Import

```bat
n8n start
```

Open http://localhost:5678

- Settings -> Import from File -> import all JSONs from `n8n-workflows/` and `n8n-workflows/subworkflows/`
- Credentials -> Add:
  - **Header Auth**: Name `Groq Auth`, Header `Authorization`, Value `Bearer gsk_...`
  - Shopify, Etsy OAuth, etc. as needed

- Open `01 - DIGITAL FACTORY MASTER` -> Execute Workflow

Master orchestrates:
```
Trigger → Idea Generator → Evaluator → IF Approved → Content Factory (5 parallel branches) → HTML-PDF Generator → Publishing Assets → Packager + Cover + ZIP → Ecommerce Publishers
```

---

## 🧠 Pipeline Improvements Over Your Old Workflow

| Old | New v2.0 |
|-----|----------|
| One giant prompt | Separated sub-workflows |
| Generated `AI Productivity Toolkit` (generic) | `FreelancerFlow AI™: Get 3-5 Clients in 30 Days` (outcome) |
| Shipped `sales.md, seo.md` to customer | Clean `Customer/` only premium PDFs |
| No evaluation | Evaluator gate: Demand, Competition, Value, Price Confidence, overall must >=7 |
| No naming strategy | Brandable naming: `ProposalPilot™, CreatorSprint™, ResearchPilot™` |
| No pricing logic | `Best Price $19/$29/$49/$99 + Reason + Bundle recommendation` |
| Stopped at ZIP | Continues to Cover → Thumbnail → Listing → Description → Keywords → Social Posts → Publishing Folder → Ecom Upload |
| Manual publish | Auto to Gumroad, Shopify (node), Etsy (node), WooCommerce (node), Payhip, Ko-fi, LemonSqueezy |

---

## 🏷️ Example Output (Premium)

**Before:** AI Productivity Toolkit.zip (guide.pdf says "AI helps you be productive")

**After:** `FreelancerFlow AI™`

Customer ZIP contains:

- `START_HERE.pdf` - 5-min quick win map
- `User_Guide.pdf` - Module 1: ICP Clarity Framework, Module 2: Magnetic Offer Engine, Module 3: ProposalPilot System (closes 60%), etc.
- `Prompt_Library.pdf` - 62 prompts, categories: Lead Gen, Outreach, Proposal, Discovery Call
- `Bonus_Checklist.pdf` - 30-day execution, checkboxes
- `Resources.pdf` - Apollo, Instantly, Loom, Notion templates
- `Bonus.pdf` - 7-day quick start + 3 case studies: Sarah $1.2k→$6k MRR etc.
- `Cover.png` - gradient premium 1600x1200
- `Thumbnail.png` - square 600x600

Publishing folder has `gumroad.md` ready to paste, `etsy.md`, `twitter.txt` thread, etc.

Perceived value $49, not $19.

---

## 🔌 Ecommerce Integration Matrix

See `ECOMMERCE_CONNECTORS.md` for full guide.

Quick:

- **Gumroad**: Best for AI/devs/freelancers. Fees 10%. n8n via HTTP Request.
- **Payhip**: Beginner, bundles, affiliate. 5% free.
- **Etsy**: Planners, templates, productivity. $0.20 + 6.5%. Use Etsy node.
- **Shopify**: Brand, upsells, subscriptions. $39/mo. Use Shopify node.
- **WooCommerce**: Own site, 0% platform fee. Use WooCommerce node.
- **Ko-fi Shop**: Small downloads, audience. 5%.
- **LemonSqueezy**: Modern checkout, tax handling. 5% + 50c. HTTP Request.
- **Stripe Links**: Direct.

n8n master workflow (08) checks env vars and publishes only where credentials exist, so you can start with just Gumroad.

---

## 📈 Monetization Roadmap (From Your Assessment)

**Week 1: Generate 10 premium**

`npm run factory:batch` -> generates 10, review manually, reject weak.

**Week 2: Publish 2/day**

Use publishing assets. Get real feedback.

**Week 3: Bundle**

Example: `Freelancer AI Bundle - 5 Systems + 3 Prompt Libraries + 2 Checklists - $59 (was $245)`

Script to bundle: zip 5 Customer folders together, create bundle listing.

**Month 2: Membership**

`Monthly AI Vault - New downloads weekly - $12/mo` via Gumroad Memberships or Payhip Membership or Shopify subscriptions + LemonSqueezy subscriptions.

Highest ROI step now:

1. Upgrade quality (outcome not toolkit) ✅ Done in this v2
2. Professional cover mockups ✅ Done (gradient premium SVG + PNG)
3. Auto publishing assets ✅ Done
4. Publish immediately ✅ Ready

---

## 🤝 AgentFinance Integration

This factory is also integrated into existing AgentFinance backend:

- New model `DigitalProduct` in Prisma (see schema addition)
- New route `POST /api/factory/generate` (generates product via Groq)
- New route `GET /api/factory/products` (lists catalog)
- Frontend page `/factory` (dashboard)

Run backend: `npm run dev` in backend, groq key in env.

---

## 🛠️ Sub-Workflow Refactor Benefit

Your old workflow repeated HTML/PDF/write logic. New:

- `02 IDEA` - isolated
- `03 EVALUATOR` - fast model, gate
- `04 CONTENT` - 5 parallel Groq calls
- `05 HTML-PDF` - reusable, single file generation
- `06 PUBLISHING` - listings + socials
- `07 PACKAGER & COVER` - cover SVG → PNG → ZIP
- `08 PUBLISHERS` - ecommerce

Maintain one, not six.

---

## 🧪 Groq Free Tier Tips

- Model `llama-3.3-70b-versatile` = best quality, 6000 TPM free, ~14k TPD
- Model `llama-3.1-8b-instant` = fast evaluator, 20k TPM
- If rate limited, factory auto-retries; n8n will show error, just rerun node.
- Alternative: add OpenRouter `meta-llama/llama-3.1-8b-instruct:free` as fallback key in `groqClient.js`

---

## 📜 License

MIT for factory code. Products you generate are yours 100%.

Support: Check `ECOMMERCE_CONNECTORS.md` and `ARCHITECTURE.md`.

---

**Made for David - AgentFinance Digital Factory Evolution**
