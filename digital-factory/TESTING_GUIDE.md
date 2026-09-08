# How to Test It, Unify It, and Connect to n8n (Windows 11)

## 1. Do you need to "unify" and does that mean pushing to GitHub?

**Short answer:**

- **Unify ≠ Push to GitHub**
- **Push to GitHub = backup your code + sync across devices**
- **Unify = we already did it** - Node factory, n8n workflows, AgentFinance backend, and frontend all use SAME logic and SAME folder structure `C:/DigitalFactory`

**Our unified architecture:**

```
You write ONE idea
   |
   +-- Node.js factory (src/factory.js)  -> writes to C:/DigitalFactory/Products/<slug>/
   |       |
   |       +-- Groq llama-3.3-70b direct call
   |
   +-- n8n Master Workflow (01-master) -> calls same Groq via HTTP Request nodes
   |       |
   |       +-- also writes to SAME C:/DigitalFactory/Products/<slug>/ folder
   |
   +-- AgentFinance Backend (POST /api/factory/generate)
           |
           +-- same Groq logic (factoryService.js)
           +-- also saves to database DigitalProduct table
           +-- writes same file structure if you want
           +-- Frontend /factory page shows products

All 3 are unified. You pick which to run.
```

**GitHub push:** Already done - branch `arena/019f7204-agentfinance` is on GitHub. That's just version control. n8n is LOCAL, it doesn't pull from GitHub automatically. You manually import workflow JSON files from `digital-factory/n8n-workflows/*.json` into your local n8n http://localhost:5678.

## 2. How to Test on Windows 11 - 3 Levels

### Level 0: No Groq Key Needed - Demo Structure Test (30 sec)

This proves folders work without any API.

```powershell
cd C:\path\to\agentfinance\digital-factory

# install deps (need Node 20+)
npm install

# generate demo product (no API)
node src/demo/generateDemoProduct.js

# check output
dir C:\DigitalFactory\Products\ai-freelancer-client-os\Customer\
dir C:\DigitalFactory\Products\ai-freelancer-client-os\Publishing\
type C:\DigitalFactory\Products\ai-freelancer-client-os\Publishing\gumroad.md
```

You should see 8 files in Customer/ and 14 in Publishing/.

If this works, your Windows paths are correct.

### Level 1: Real Test with Groq Free API (Single Product - 60 sec)

```powershell
copy .env.example .env
notepad .env
```

Put:

```
GROQ_API_KEY=gsk_your_key_from_https://console.groq.com/keys
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_FAST_MODEL=llama-3.1-8b-instant
FACTORY_ROOT=C:/DigitalFactory
PRODUCTS_DIR=C:/DigitalFactory/Products
PUBLISHED_DIR=C:/DigitalFactory/Published
CATALOG_DIR=C:/DigitalFactory/catalog
```

Then:

```powershell
# test 1 product
npm run factory:single

# or
node src/factory.js --single
```

Watch logs:

```
Idea: FreelancerFlow AI™ - ...
Eval: Overall 8.2 APPROVED
📝 Generating content...
📢 Generating publishing assets...
📦 ZIP created: C:/DigitalFactory/Published/...
✅ COMPLETED
```

Then open:

```
C:\DigitalFactory\Products\YOUR_SLUG\Customer\User_Guide.md
C:\DigitalFactory\Products\YOUR_SLUG\Publishing\gumroad.md
```

If `User_Guide.md` is 2500+ words tactical (not generic toolkit) and `gumroad.md` is 400-600 words sales copy, it works!

### Level 2: Batch Test (10 Products)

```powershell
node src/factory.js --batch 3
```

Should create 3 products, update `C:\DigitalFactory\catalog\approved_products.csv`

### Level 3: Backend API Test (AgentFinance Integration)

```powershell
# In one powershell
cd C:\path\to\agentfinance\backend
npm install
# set env in backend/.env : GROQ_API_KEY, DATABASE_URL, JWT_SECRET
npx prisma db push
npm run dev
# server at http://localhost:4000

# In second powershell - test API
curl -X POST http://localhost:4000/api/factory/generate -H "Content-Type: application/json" -d "{\"batch\":1}"

# Or check products
curl http://localhost:4000/api/factory/products
```

### Level 4: n8n Connection Test (Real Automation)

```powershell
# install n8n global if not
npm install -g n8n

# start n8n
n8n start
# open http://localhost:5678 -> create account
```

**In n8n UI:**

1. Top right -> Import from File -> `digital-factory/n8n-workflows/01-master-factory.json`
2. Repeat for 02 to 08 files (all in same folder)
3. Left menu -> Credentials -> Create New -> Header Auth:
   - Name: `Groq Auth`
   - Header Name: `Authorization`
   - Value: `Bearer gsk_...` (your key)
   - Save - Note its ID (n8n shows)
   - Edit each HTTP Request node -> Credential -> select Groq Auth

4. Open workflow `01 - DIGITAL FACTORY MASTER`

5. Click **Execute Workflow** button top right

**What happens:**

- Master calls 02 Idea Generator (HTTP to Groq)
- Then 03 Evaluator (score)
- IF Approved (overall >=7) → 04 Content Factory 5 parallel Groq calls
- → 05 HTML-PDF (writes to C:/DigitalFactory/Products/<slug>/Customer/*.html + *.pdf via Read/Write File nodes)
- → 06 Publishing Assets (writes 13 files to Publishing/)
- → 07 Packager & Cover (SVG cover -> PNG, README, ZIP to Published/)
- → 08 Ecommerce Publishers (checks if Gumroad/Shopify env exists, if yes creates product)

**Check n8n execution log:** If green check all nodes, success.

**Check files:** Same `C:\DigitalFactory\Products\...` as Node test - because both write same place! That's unified.

## 3. How GitHub Push Fits

```
Your Windows PC
  |
  |-- agentfinance git repo (branch arena/019f7204-agentfinance)
  |      |
  |      +-- digital-factory/ folder = your factory code
  |      +-- n8n-workflows/*.json = n8n definitions
  |      |
  |      +-- git push origin arena/019f7204-agentfinance --> GitHub (backup, what we did)
  |
  |-- C:/DigitalFactory/ = actual generated products (NOT in git, too big)
  |
  +-- n8n local app at http://localhost:5678
         |
         +-- imports JSON from agentfinance/digital-factory/n8n-workflows/
         +-- writes products to C:/DigitalFactory/
```

**You don't need to push to test n8n.** Push only to backup or sync to another PC.

To get code on another Windows PC:

```powershell
git clone https://github.com/okwedavid/agentfinance.git
git checkout arena/019f7204-agentfinance
cd agentfinance\digital-factory
npm install
```

## 4. How to Know It Works End-to-End

Checklist:

- [ ] Demo test creates `Products/ai-freelancer-client-os/` with Customer/ + Publishing/
- [ ] Groq single test creates new slug with 8.2 score, PDFs, covers, ZIP
- [ ] `C:\DigitalFactory\catalog\approved_products.csv` has 2 lines (demo + new)
- [ ] n8n master workflow executes green, creates new product folder without running node script (proves n8n independent)
- [ ] `Publishing/gumroad.md` reads like real sales page (not generic)
- [ ] Frontend http://localhost:3000/factory shows products (if backend running)
- [ ] You can manually paste `Publishing/gumroad.md` into Gumroad new product and upload `Published/<slug>.zip` and it sells (test publish)

If 5/6 pass, factory ready.

## 5. Troubleshooting Windows

**Puppeteer fails `Failed to launch browser`**
- Install Edge, or in n8n rely on HTML to PDF node (we provide fallback). Node factory will still create HTML, PDFs placeholder - n8n will create real PDFs.

**Canvas fails**
- Cover falls back to dummy jpg + real SVG. Open Cover.svg in browser - it should show premium gradient.

**Groq 429 Rate Limit**
- Free tier 30 req/min. Add Wait node 3 sec in n8n between Groq nodes. Or reduce batch from 3 to 1.

**n8n file path error `ENOENT`**
- Use forward slashes `C:/DigitalFactory/Products/...` not `C:\` in n8n Write File nodes. Our templates use forward slashes already.

**Groq key not working**
- Test: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer gsk_..."`

## 6. What to Do After Test

1. Test demo → success
2. Add Groq key → test single → success → open gumroad.md, see quality
3. Test n8n master executes → success
4. Generate 3 more real → review, keep best 2 (score >=7.5)
5. Manually publish 1 to Gumroad (paste gumroad.md + ZIP) to validate sells
6. Then enable Schedule Trigger daily 9am batch 3 + auto publishers (set Gumroad token in env)
7. After 5 sales → create bundle ZIP merging 5 Customer/ folders → sell $59 bundle
8. Month 2 → membership $12/mo

That's end-to-end achieving goal.
