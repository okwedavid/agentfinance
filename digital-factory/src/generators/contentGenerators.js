/**
 * Content Generators - Parallel generation of premium product content
 * Uses Groq llama-3.3-70b-versatile
 */
import { groqText, groqJSON } from '../groqClient.js';

export async function generateAllContent(idea) {
  console.log(`📝 Generating content for ${idea.brand_name}...`);

  const [guide, prompts, checklist, resources, bonus, readme, license] = await Promise.all([
    generateGuide(idea),
    generatePromptLibrary(idea),
    generateChecklist(idea),
    generateResources(idea),
    generateBonus(idea),
    generateReadme(idea),
    generateLicense(idea),
  ]);

  const startHere = generateStartHere(idea);

  return {
    guide,
    prompts,
    checklist,
    resources,
    bonus,
    readme,
    license,
    startHere,
  };
}

async function generateGuide(idea) {
  const system = `You are a premium digital product author. Write guides that feel like $99 products, not AI slop.
Rules:
- No fluff intro like "In today's fast-paced world..."
- Start with pain + promise
- Use frameworks, tables, scripts, templates
- Actionable, tactical, specific numbers
- Format in Markdown with headers, bullet points, bold key terms
- 2500-3500 words, 6-8 modules
- Human, expert tone`;

  const user = `
Write the MAIN GUIDE for: ${idea.title}
Brand: ${idea.brand_name}
Outcome: ${idea.dream_outcome}
Avatar: ${idea.avatar}
Pain: ${idea.pain}
Modules to cover: ${JSON.stringify(idea.core_modules)}
Deliverables: ${JSON.stringify(idea.deliverables)}
Differentiation: ${idea.differentiation}

Structure:
# ${idea.brand_name} - Complete Operating System
## Quick Win (first 30 min)
## Module 1-6 (each with: Why it matters, Framework, Templates, Action Steps, Mistakes)
## Swipe Files & Scripts
## 30-Day Implementation Roadmap
## Troubleshooting

Make it tactical, premium, worth $49+.
`;

  return await groqText({ system, user, temperature: 0.75, maxTokens: 6000 });
}

async function generatePromptLibrary(idea) {
  const system = `You are a prompt engineer for premium AI product. Create 50-75 powerful prompts that deliver outcome.
Each prompt must be copy-paste ready, with variables like [NICHE], [CLIENT_TYPE].
Organize by use-case, not random list. Markdown format.`;

  const user = `
Create Prompt Library for ${idea.brand_name}
Outcome: ${idea.dream_outcome}
Avatar: ${idea.avatar}
Modules: ${JSON.stringify(idea.core_modules)}

Structure:
# ${idea.brand_name} - Prompt Library (60+ Prompts)

## Category 1: [Name] - 10 prompts
### Prompt 1.1 - Title
**Use Case:** ...
**Prompt:**
\`\`\`
...
\`\`\`
**Pro Tip:** ...

(Repeat for 60+)

Make prompts highly specific to ${idea.avatar} and ${idea.title}. Not generic.
`;

  return await groqText({ system, user, maxTokens: 7000, temperature: 0.8 });
}

async function generateChecklist(idea) {
  const system = `Create a premium bonus checklist that ensures customer gets outcome. Markdown, checkbox format, actionable.`;
  const user = `
Create Checklist for ${idea.brand_name}
Title: ${idea.title}
Outcome: ${idea.dream_outcome}
Avatar: ${idea.avatar}

Create 30-50 item checklist in 3 phases: Setup (Day 1-3), Execution (Day 4-21), Scale (Day 22-30)
Use [ ] and categories.
Include "Quick Wins" section.

# ${idea.brand_name} - 30-Day Execution Checklist
`;
  return await groqText({ system, user, maxTokens: 3000 });
}

async function generateResources(idea) {
  const system = `You curate tools, templates, swipe files. Provide real tools names, not fake links. Markdown curated list.`;
  const user = `
Create Resources.pdf content for ${idea.brand_name}
Avatar: ${idea.avatar}
Title: ${idea.title}

Structure:
# Resource Vault

## Essential Tools (Free & Paid)
## Templates & Swipe Files (link placeholders)
## Communities
## Books & Courses
## AI Tools Stack
## Bonus Discounts (invent realistic partner tools)

Be specific, value-packed.
`;
  return await groqText({ system, user, maxTokens: 2500 });
}

async function generateBonus(idea) {
  const system = `You create bonus that increases perceived value by 2x. Must be tactical, not fluff.`;
  const user = `
Create Bonus Guide for ${idea.brand_name}
Should be: 7-Day Quick Start Crash Course or Swipe File or Case Studies
Avatar: ${idea.avatar}

# BONUS: ${idea.brand_name} - 7-Day Quick Start & Case Studies

Include:
- 3 real-world case studies (invent but realistic)
- Day-by-day 7 day plan
- Scripts
- Metrics to track
`;
  return await groqText({ system, user, maxTokens: 3500 });
}

function generateReadme(idea) {
  return `# ${idea.brand_name}
### ${idea.title}

**Tagline:** ${idea.tagline}

**Who is this for?** ${idea.avatar}

**Pain it solves:** ${idea.pain}

**Outcome:** ${idea.dream_outcome}

## What's Inside Customer Download

- START_HERE.pdf - Read first, 5-min overview
- User_Guide.pdf - Complete 6-module system (${idea.core_modules.length} modules)
- Prompt_Library.pdf - 60+ copy-paste prompts
- Bonus_Checklist.pdf - 30-day execution checklist
- Resources.pdf - Tools, templates, communities
- Bonus.pdf - 7-day quick start + case studies
- License.txt
- Cover.png / Thumbnail.png

## How to Use

1. Read START_HERE.pdf
2. Follow Guide Module 1 for quick win
3. Use Prompt Library daily
4. Track with Checklist

## Support

Email for questions. This is digital product, no refunds unless faulty.

## License

Personal use only. No resale or redistribution.

---

Created by Digital Factory © 2026
Brand: ${idea.brand_name}
Price Recommendation: $${idea.price_point}
`;
}

function generateLicense() {
  return `DIGITAL PRODUCT LICENSE - PERSONAL USE
© 2026 Digital Factory

You are granted a non-exclusive, non-transferable license to use this product for personal or business use.

YOU MAY:
- Use for your own business/clients
- Print copies for personal use
- Use prompts and templates in your work

YOU MAY NOT:
- Resell, redistribute, share
- Claim as your own
- Upload to file-sharing sites
- Use for training AI models without permission

Violation = DMCA.

No warranty. Digital product, all sales final unless defective.

Support: support@yourdomain.com
`;
}

function generateStartHere(idea) {
  return `# START HERE - ${idea.brand_name} 🎉

Welcome to ${idea.brand_name}!

You just got the system that helps ${idea.avatar} achieve: ${idea.dream_outcome}

### ⚡ Your 15-Min Quick Start:

1. **Read this file (2 min)** - you are doing it!
2. **Open Bonus_Checklist.pdf (3 min)** - See 30-day roadmap overview
3. **Pick ONE quick win from Guide p.5 (10 min)** - Implement today

### 📦 What's Inside:

✅ User_Guide.pdf - Your main playbook (${idea.core_modules.length} modules)
✅ Prompt_Library.pdf - 60+ AI prompts (copy-paste)
✅ Bonus_Checklist.pdf - Daily tracker
✅ Resources.pdf - Tools & templates
✅ Bonus.pdf - 7-day crash course + 3 case studies
✅ License.txt

### 🎯 Expected Outcome: ${idea.dream_outcome}

Timeline: 7 days to first win, 30 days to full outcome if you follow checklist.

### 🚀 Pro Tip:
Don't binge-read. Implement Module 1 today, get quick win, then continue.

Let's build!

- Team ${idea.brand_name}

P.S. This solves: ${idea.pain}
`;
}
