/**
 * Demo Product Generator - No API key needed
 * Creates a realistic product to showcase folder structure
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FACTORY_ROOT = process.env.FACTORY_ROOT || path.join(__dirname, '../..');
const PRODUCTS_DIR = path.join(FACTORY_ROOT, 'Products');
const PUBLISHED_DIR = path.join(FACTORY_ROOT, 'Published');
const CATALOG_DIR = path.join(FACTORY_ROOT, 'catalog');

const demoIdea = {
  slug: 'ai-freelancer-client-os',
  brand_name: 'FreelancerFlow AI™',
  title: 'AI Client Acquisition OS for Freelancers: Get 3-5 High-Ticket Clients in 30 Days Without Cold Calling',
  outcome: 'Transform from inconsistent $1-3k months to predictable $5k+ retainers',
  tagline: 'The plug-and-play system 2,400+ freelancers use to hit $5k MRR',
  avatar: 'Freelancers earning $1-3k/mo who want to hit $5k+ retainers, tired of Upwork race to bottom',
  pain: 'No predictable lead flow, low rates, wasting 10h/week writing proposals that get ignored, feast-famine cycle',
  dream_outcome: '3-5 qualified leads/week, 60% close rate, $2k+ per client, 15h/week freed',
  core_modules: [
    'ICP Clarity Framework - Define $2k+ dream client in 45 min',
    'Magnetic Offer Engine - Craft irresistible offer that sells itself',
    'ProposalPilot System - Proposal template that closes 60%+',
    'AI Outreach OS - 30 days of cold emails + LinkedIn scripts',
    'Discovery Call Script - 7-figure agency call framework',
    'Client Onboarding Vault - Contracts, SOPs, Loom templates'
  ],
  deliverables: [
    'User_Guide.pdf - 60 pages',
    'Prompt_Library.pdf - 62 prompts',
    'Bonus_Checklist.pdf - 30-day tracker',
    'Resources.pdf - tools & templates',
    'Bonus.pdf - 7-day quick start + 3 case studies',
    'Cover.png & Thumbnail.png'
  ],
  differentiation: 'Not generic ChatGPT prompts. Based on analysis of 150+ $10k/mo freelancers + 7-figure agency SOPs. Includes real proposal that closed $4,500 retainer.',
  price_point: 49,
  price_reason: 'Comparable freelance courses sell $99-299, but this is tactical OS, not theory. $49 is impulse + high value',
  bundle_with: ['AI Proposal Writing System', 'AI Cold Email OS'],
  keywords: ['freelance clients', 'client acquisition', 'freelancer proposal', 'cold email', 'AI freelancer', 'Upwork alternative', 'high ticket clients', 'freelance OS', 'client outreach', 'discovery call'],
  est_demand: 'high',
  competition_level: 'medium'
};

const demoEvaluation = {
  demand_score: 9,
  competition_score: 7,
  value_score: 9,
  price_score: 8,
  market_confidence: 8,
  overall: 8.2,
  verdict: 'APPROVED',
  reason: 'High pain, clear outcome, willingness to pay $49-99 proven on Gumroad. Medium competition but differentiation strong.',
  suggested_price: 49,
  price_tiers: { basic: 19, standard: 49, premium: 99 },
  target_audience_detailed: 'Freelancers 23-35yo, US/EU, 1-3 years experience, on Upwork/Fiverr but want off platform, follows @AlexHormozi, @DylanBowen, active in IndieHackers, r/freelance',
  improvement_tips: ['Add Loom video walkthrough', 'Add real outreach screenshots'],
  risk_flags: []
};

const demoContent = {
  guide: `# FreelancerFlow AI™ - Complete Operating System

## Quick Win (First 30 Min)

**Goal:** Get clarity on your $2k+ dream client.

### ICP Clarity Framework

Most freelancers say "I help businesses grow". That's why you charge $20/hr.

Instead use: "I help [Specific Avatar] achieve [Dream Outcome] in [Timeframe] without [Pain]"

**Example:** "I help B2B SaaS founders earning $20k MRR get 10 demo calls/week in 30 days without cold calling or ads"

**Action:** Fill template:
- My avatar: ____ (e.g. Series A SaaS founders)
- Their pain: ____ (e.g. No predictable demo flow)
- Dream outcome: ____ (10 demos/week)
- Timeframe: 30 days

---

## Module 1: Magnetic Offer Engine

Why most offers fail: They sell process, not outcome.

**Bad:** "I will build you a website"
**Good:** "Get a website that books 15 calls/month or you don't pay"

**Framework: $100M Offer Formula**
- Dream Outcome x Perceived Likelihood / (Time Delay x Effort)

**Template:** [Full template with fill-in blanks]

---

## Module 2: ProposalPilot System (60%+ Close Rate)

Old proposal: 5 pages about you.
New proposal: 1 page about them.

**Structure:**
1. Loom Video (2 min) - personalized audit
2. 3 problems you found
3. Your 90-day plan
4. Investment + guarantee
5. Next steps

**Swipe:** [Real proposal that closed $4,500 - redacted]

---

## Module 3-6: [Similar detailed modules...]

---

## 30-Day Roadmap

**Week 1:** ICP + Offer
**Week 2:** Outreach system (50 emails/day)
**Week 3:** Discovery calls (use script)
**Week 4:** Close + onboard

**Metrics:** Leads/week, Reply rate, Close rate, MRR

Troubleshooting: If reply <10%, fix subject line. If close <30%, fix discovery.

`,

  prompts: `# FreelancerFlow AI™ - Prompt Library (62 Prompts)

## Category 1: ICP & Offer Clarity (10 prompts)

### Prompt 1.1 - Define Dream Client

**Use Case:** When you have no idea who to target

**Prompt:**
\`\`\`
Act as a $50k/mo freelance consultant. Help me define my dream client.

My skills: [YOUR SKILLS e.g. Webflow, Copywriting, UGC]

My current clients are: [CURRENT e.g. small ecom brands $500/mo]

I want to work with: [ASPIRE e.g. SaaS founders]

Ask me 5 questions to clarify my ICP, then output:
1. Exact avatar (age, revenue, pain)
2. Where they hang out online
3. What keeps them up at night
4. Dream outcome they'd pay $2k+/mo for
\`\`\`

**Pro Tip:** Run this 3 times, merge best answers.

[... 61 more prompts organized by Lead Gen, Outreach, Proposal, Discovery, Onboarding, Content ...]
`,

  checklist: `# FreelancerFlow AI™ - 30-Day Execution Checklist

## Phase 1: Setup Day 1-3

- [ ] Quick Win: Define ICP using template (45 min)
- [ ] Write magnetic offer (1 hr)
- [ ] Record 1 Loom audit of dream client website (10 min)
- [ ] Setup Apollo + Instantly (30 min)
- [ ] Import 100 leads

## Phase 2: Execution Day 4-21

- [ ] Send 30 personalized cold emails/day (template from Guide p.23)
- [ ] 10 LinkedIn DMs/day
- [ ] Track reply rate: goal 15%+
- [ ] Book 3 discovery calls (use script p.31)
- [ ] Send ProposaPilot proposal within 2h of call
- [ ] Follow up sequence: Day 1,3,7

## Phase 3: Scale Day 22-30

- [ ] Close first $2k+ client
- [ ] Onboard using vault (contract + SOP)
- [ ] Ask for referral
- [ ] Systematize: Hire VA for lead list

## Quick Wins

- [ ] Post 1 value teardown on LinkedIn (get 2 inbound leads)
- [ ] DM 10 past clients with new offer
`,

  resources: `# Resource Vault - FreelancerFlow AI™

## Essential Tools

- **Apollo.io** - Find 100M contacts, $49/mo
- **Instantly.ai** - Cold email infrastructure, $37/mo
- **Loom** - Proposal videos, free
- **Notion** - Client portal, free
- **Tally.so** - Discovery form, free

## Templates

- Proposal template (Notion link placeholder)
- Contract template (PandaDoc)
- Onboarding checklist
- Cold email swipe dump 30 templates

## Communities

- r/freelance (Reddit)
- Indie Hackers
- FreelancerFlow Slack (invite in Bonus)

## Books

- $100M Offers - Hormozi
- Freelance to Freedom - ...

## AI Stack

- ChatGPT + Claude for outreach personalization
- Perplexity for lead research
`,

  bonus: `# BONUS: 7-Day Quick Start + Case Studies

## Case Study 1: Sarah - Web Designer $1.2k → $6k MRR in 45 Days

Before: Fiverr, $25/hr, 60h/week
After: 3 retainers at $2k = $6k, 25h/week
What changed: Niching to SaaS landing pages + ProposalPilot

## Case Study 2: Ahmed - UGC Creator $800 → $4,500/mo

...

## 7-Day Plan

**Day 1:** ICP
**Day 2:** Offer + Loom
**Day 3:** 50 leads + 30 emails
**Day 4:** 30 emails + 10 LI DMs + content
**Day 5:** Follow ups + 2 calls
**Day 6:** Proposals
**Day 7:** Close + onboard

Metrics to track: Emails sent, Reply %, Calls booked, Close %, MRR

`,
};

const demoPublishing = {
  title: "Freelancer Client Acquisition OS: Get 3-5 Clients in 30 Days",
  long_title: "FreelancerFlow AI™: Get 3-5 High-Ticket Clients in 30 Days Without Cold Calling - Proposal System That Closes 60%+",
  short_description: "The OS 2,400+ freelancers use to hit $5k MRR - proposals, outreach, scripts",
  seo_slug: "ai-freelancer-client-os-high-ticket",
  seo_tags: ["freelance clients", "client acquisition", "freelancer proposal", "cold email", "AI freelancer", "Upwork", "high ticket", "freelance OS", "outreach system", "discovery call"],
  etsy_tags: ["freelance template", "client acquisition", "freelancer OS", "proposal template", "cold email", "Notion template", "freelance guide", "business template", "client contract", "SaaS template", "outreach script", "freelance planner", "business OS"],
  hashtags: ["freelance", "freelancelife", "clientacquisition", "coldemail", "freelancer", "upwork", "freelancing", "proposal", "saas", "indiehackers", "solopreneur", "freelanceTips"],
  whats_included: [
    "User_Guide.pdf - 60-page complete OS (6 modules)",
    "Prompt_Library.pdf - 62 copy-paste AI prompts",
    "Bonus_Checklist.pdf - 30-day execution tracker",
    "Resources.pdf - Tools, templates, communities",
    "Bonus.pdf - 7-day crash course + 3 case studies",
    "Cover.png + Thumbnail.png - Premium mockups",
    "License.txt - Personal use"
  ],
  description_gumroad_md: `**Are you stuck at $1-3k/mo on Upwork, wasting 10h/week writing proposals that get ignored?**

FreelancerFlow AI™ is the plug-and-play system 2,400+ freelancers use to get 3-5 high-ticket clients in 30 days without cold calling.

**This is NOT another generic "AI Toolkit".**

It's a battle-tested OS from analyzing 150+ $10k/mo freelancers and 7-figure agency SOPs.

**Who is this for?**
- Freelancers 1-3 years experience
- Earning $1-3k/mo, want $5k+ retainers
- Tired of Upwork race to bottom
- Want predictable lead flow

**The Pain We Solve:**
No predictable leads, low rates, feast-famine cycle, proposals ignored.

**What You Get:**
- Complete 6-module OS
- Proposal template that closes 60%+
- 30 days of cold emails + LinkedIn scripts
- Discovery call framework ($100k/mo agency uses)
- AI prompt library 62 prompts

**Outcome:** 3-5 qualified leads/week, 60% close, $2k+ per client.

**Bonuses:** 7-day quick start + 3 case studies (Sarah $1.2k → $6k in 45 days)

**FAQ:**
Q: I have no audience? A: System works cold, no audience needed.
Q: Does this work for designers/writers/devs? A: Yes, web designers, copywriters, UGC, video editors tested.
Q: Refund? A: Digital product, but if faulty email us.

**Price:** $19 Basic (PDF only), $49 Standard (Full OS), $99 Premium + 30-min Loom audit.

👉 Buy now, implement module 1 today, get first reply in 48h.
`,
  description_etsy: `Get 3-5 high-ticket freelance clients in 30 days without cold calling!

FreelancerFlow AI™ includes proposal template that closes 60%+, cold email scripts, discovery call framework, 62 AI prompts, 30-day checklist.

Perfect for freelancers earning $1-3k wanting $5k+ retainers.

Instant digital download - 6 PDFs + covers.

- 60-page OS
- 62 prompts
- Tools & templates
- 7-day quick start

Not generic toolkit - real SOPs from $10k/mo freelancers.`,
  description_shopify: `<h2>FreelancerFlow AI™ - Client Acquisition OS</h2><p>Get 3-5 high-ticket clients in 30 days...</p><h3>What's Inside</h3><ul><li>60-page guide</li><li>62 prompts</li></ul>`,
  email_campaign: {
    subject: "How Sarah went from $1.2k to $6k MRR in 45 days (freelance)",
    preview: "No cold calling, just this OS",
    body: `Hey {firstName},

Sarah was stuck on Fiverr at $25/hr working 60h/week.

45 days later: $6k MRR, 3 retainers at $2k, 25h/week.

What changed? She stopped selling "websites" and started selling outcome + used ProposalPilot template.

I packed her exact system into FreelancerFlow AI™ - get 3-5 high-ticket clients in 30 days without cold calling.

Includes proposal template that closes 60%+, cold email scripts, discovery framework.

$49 today (Premium $99 includes Loom audit).

👉 [Link]

P.S. First 20 buyers get bonus outreach swipe file.

- David`
  },
  twitter_post: "🚀 Freelancers: Stop writing proposals that get ignored. I analyzed 150+ $10k/mo freelancers + packed their client acquisition OS into FreelancerFlow AI™. Get 3-5 high-ticket clients in 30 days without cold calling. Proposal template closes 60%+ 👉 link $49",
  launch_tweet_thread: `1/ Freelancers stuck at $1-3k/mo on Upwork: your proposal is the problem.

I analyzed 150+ $10k/mo freelancers and found 1 template that closes 60%+

I packed it into FreelancerFlow AI™ 👇

2/ Module 1: ICP Clarity - Stop saying "I help businesses grow"
Instead: "I help SaaS founders get 10 demos/week in 30 days without ads"

3/ Module 2: Offer Engine - Sell outcome, not process
Bad: "I will build website"
Good: "Get website that books 15 calls/mo or you don't pay"

4/ Module 3: ProposalPilot - 1 page about them, not 5 about you
Structure: Loom audit (2 min) + 3 problems + 90-day plan + guarantee

5/ Full OS: 60-page guide + 62 prompts + 30-day checklist + tools

2,400+ freelancers use it to hit $5k MRR.

$49 today → link in bio.`,
  linkedin_post: `After talking to 100+ freelancers stuck at $1-3k/mo, I noticed same pattern:

- No predictable lead flow
- Low rates, race to bottom on Upwork
- 10h/week writing proposals that get ignored
- Feast-famine cycle

The freelancers hitting $5k+ retainers do 3 things differently:

1. They niche to ONE avatar (not "I help businesses")
2. They sell outcome, not process (not "website" but "15 calls/mo")
3. Their proposal is 1 page about client, with Loom audit

I analyzed 150+ $10k/mo freelancers and 7-figure agency SOPs and packed it into FreelancerFlow AI™ - Get 3-5 high-ticket clients in 30 days without cold calling.

Includes:
- Proposal template that closes 60%+
- 30 days cold email + LinkedIn scripts
- Discovery call framework
- 62 AI prompts
- 30-day execution checklist

For freelancers 1-3 years exp who want off Upwork and predictable $5k+ retainers.

$49 Standard, $99 Premium includes Loom audit.

Link in comments - Would love feedback if you try module 1 today.

#freelance #clientacquisition`,
};

function ensureDemo() {
  const slug = demoIdea.slug;
  const productRoot = path.join(PRODUCTS_DIR, slug);
  const customerDir = path.join(productRoot, 'Customer');
  const publishingDir = path.join(productRoot, 'Publishing');
  const internalDir = path.join(productRoot, 'Internal');

  [customerDir, publishingDir, internalDir, CATALOG_DIR, PUBLISHED_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // customer files
  fs.writeFileSync(path.join(customerDir, 'User_Guide.md'), demoContent.guide, 'utf8');
  fs.writeFileSync(path.join(customerDir, 'Prompt_Library.md'), demoContent.prompts, 'utf8');
  fs.writeFileSync(path.join(customerDir, 'Bonus_Checklist.md'), demoContent.checklist, 'utf8');
  fs.writeFileSync(path.join(customerDir, 'Resources.md'), demoContent.resources, 'utf8');
  fs.writeFileSync(path.join(customerDir, 'Bonus.md'), demoContent.bonus, 'utf8');
  fs.writeFileSync(path.join(customerDir, 'README.md'), `# ${demoIdea.brand_name}\n${demoIdea.title}\n\nOutcome: ${demoIdea.dream_outcome}`, 'utf8');
  fs.writeFileSync(path.join(customerDir, 'License.txt'), 'Personal use only', 'utf8');
  fs.writeFileSync(path.join(customerDir, 'START_HERE.txt'), `START HERE - ${demoIdea.brand_name}\n\nWelcome! Outcome: ${demoIdea.dream_outcome}\nQuick start: Module 1 in 30 min`, 'utf8');

  // publishing
  fs.writeFileSync(path.join(publishingDir, 'gumroad.md'), demoPublishing.description_gumroad_md, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'etsy.md'), demoPublishing.description_etsy, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'shopify.html'), demoPublishing.description_shopify, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'payhip.txt'), demoPublishing.description_gumroad_md.slice(0,500), 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'seo.txt'), `Slug: ${demoPublishing.seo_slug}\nTags: ${demoPublishing.seo_tags.join(', ')}`, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'hashtags.txt'), demoPublishing.hashtags.map(h=>'#'+h).join(' '), 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'twitter.txt'), demoPublishing.twitter_post + '\n\n--- THREAD ---\n' + demoPublishing.launch_tweet_thread, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'linkedin.txt'), demoPublishing.linkedin_post || demoPublishing.twitter_post, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'facebook.txt'), demoPublishing.description_etsy, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'listing.txt'), `Title: ${demoPublishing.long_title}\nPrice: $${demoEvaluation.suggested_price}\nSlug: ${demoPublishing.seo_slug}`, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'listing.json'), JSON.stringify(demoPublishing, null, 2), 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'email.txt'), `Subject: ${demoPublishing.email_campaign.subject}\n\n${demoPublishing.email_campaign.body}`, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'instagram.txt'), demoPublishing.twitter_post, 'utf8');
  fs.writeFileSync(path.join(publishingDir, 'pinterest.txt'), demoPublishing.twitter_post, 'utf8');

  // internal
  fs.writeFileSync(path.join(internalDir, 'generation.json'), JSON.stringify({ idea: demoIdea, evaluation: demoEvaluation }, null, 2), 'utf8');

  const manifest = {
    slug,
    brand_name: demoIdea.brand_name,
    title: demoIdea.title,
    outcome: demoIdea.dream_outcome,
    avatar: demoIdea.avatar,
    price: demoEvaluation.suggested_price,
    evaluation: demoEvaluation,
    created_at: new Date().toISOString(),
    files_customer: fs.readdirSync(customerDir),
    files_publishing: fs.readdirSync(publishingDir),
  };

  fs.writeFileSync(path.join(productRoot, 'release_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(productRoot, 'quality_report.json'), JSON.stringify(demoEvaluation, null, 2), 'utf8');

  // Published compat
  const publishedDir = path.join(PUBLISHED_DIR, slug);
  const listingAssets = path.join(publishedDir, 'Listing_Assets');
  const packageDir = path.join(publishedDir, 'Package', slug);
  [listingAssets, packageDir].forEach(d => fs.mkdirSync(d, { recursive: true }));
  fs.writeFileSync(path.join(publishedDir, 'quality_report.json'), JSON.stringify(demoEvaluation, null, 2), 'utf8');
  fs.writeFileSync(path.join(publishedDir, 'release_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // catalog
  const csvPath = path.join(CATALOG_DIR, 'approved_products.csv');
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, 'slug,brand_name,title,price,overall,created_at,status\n', 'utf8');
  fs.appendFileSync(csvPath, `${slug},\"${demoIdea.brand_name}\",\"${demoIdea.title.replace(/"/g,'""')}\",${demoEvaluation.suggested_price},${demoEvaluation.overall},${manifest.created_at},APPROVED\n`, 'utf8');

  const jsonPath = path.join(CATALOG_DIR, 'approved_products.json');
  let jsonData = [];
  try { jsonData = JSON.parse(fs.readFileSync(jsonPath,'utf8')); } catch {}
  jsonData.push(manifest);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData,null,2), 'utf8');

  // dummy cover files
  fs.writeFileSync(path.join(customerDir, 'cover.jpg'), 'dummy cover - real will be generated by imageGenerator.js', 'utf8');
  fs.writeFileSync(path.join(customerDir, 'thumbnail.jpg'), 'dummy thumbnail', 'utf8');
  fs.writeFileSync(path.join(listingAssets, 'cover.jpg'), 'dummy cover', 'utf8');
  fs.writeFileSync(path.join(listingAssets, 'thumbnail.jpg'), 'dummy thumb', 'utf8');

  console.log(`✅ Demo product created: ${productRoot}`);
  console.log(`Customer files: ${customerDir}`);
  console.log(`Publishing: ${publishingDir}`);
}

ensureDemo();
