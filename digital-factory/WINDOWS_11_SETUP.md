# Windows 11 - Digital Factory End-to-End Setup (Local n8n + Groq Free)

This guide gets you from zero to shipping products to Gumroad/Etsy/Shopify.

## 1. Install Prereqs

- **Node.js 20+**: https://nodejs.org/ (LTS)
- **Git**: https://git-scm.com/
- **n8n**: `npm install -g n8n` in PowerShell Admin
- **Groq API key free**: https://console.groq.com/keys -> Create key -> copy `gsk_...`

Check:

```powershell
node -v
npm -v
n8n -v
```

## 2. Clone / Setup Factory

```powershell
cd C:\
git clone https://github.com/okwedavid/agentfinance.git
cd agentfinance\digital-factory
npm install
```

Create `.env`:

```powershell
copy .env.example .env
notepad .env
```

Put:

```
GROQ_API_KEY=gsk_your_key
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_FAST_MODEL=llama-3.1-8b-instant
FACTORY_ROOT=C:/DigitalFactory
PRODUCTS_DIR=C:/DigitalFactory/Products
PUBLISHED_DIR=C:/DigitalFactory/Published
CATALOG_DIR=C:/DigitalFactory/catalog
```

## 3. Create Factory folders

```powershell
mkdir C:\DigitalFactory
mkdir C:\DigitalFactory\Products
mkdir C:\DigitalFactory\Published
mkdir C:\DigitalFactory\catalog
mkdir C:\DigitalFactory\_quality_reports
```

Or run:

```powershell
.\scripts\setup-windows.bat
```

## 4. Test Without n8n (Node Only)

Generates product directly via Node:

```powershell
npm run factory:single
```

If you have no Groq key yet, demo:

```powershell
node src/demo/generateDemoProduct.js
```

Check `C:\DigitalFactory\Products\ai-freelancer-client-os\`:

- Customer/ has 8 md + dummy jpg
- Publishing/ has 14 marketing files
- That is the new structure!

## 5. Install n8n Local

```powershell
n8n start
```

Open http://localhost:5678

First time: create owner account.

## 6. Credentials in n8n

Go to Credentials -> New:

1. **Groq Auth** (Header Auth)
   - Name: Groq Auth
   - Header Name: Authorization
   - Value: Bearer gsk_...

2. **Gumroad** (optional)
   - Header Auth -> Bearer token from https://gumroad.com/settings/advanced

3. **Shopify** (optional)
   - Shopify API credential -> Store domain + Access Token (from Shopify Admin > Apps > Develop)

4. **Etsy** (optional)
   - Etsy OAuth via Etsy node - follow n8n prompt

5. **WooCommerce** (optional)
   - WooCommerce API -> URL + CK + CS

## 7. Import Workflows

In n8n UI:

- Workflows -> Import from File -> Select `C:\...\agentfinance\digital-factory\n8n-workflows\01-master-factory.json`
- Repeat for 02-08 jsons in same folder

Should see 8 workflows.

- Open `01 - DIGITAL FACTORY MASTER`
- It already chains 02..08 via Execute Workflow nodes.
- Ensure sub-workflow names match: they reference by name "02 - IDEA GENERATOR" etc. n8n matches by name, so keep names exact.

## 8. Configure Wait & Rate Limits (Important for Groq Free)

Groq free: 30 requests/min. If you hit 429, add Wait nodes.

In each Groq HTTP Request node:

- Settings -> Retry -> Enable, 2 retries, 5000ms between
- Between parallel branches: Add Wait 2 sec

## 9. Run Factory from n8n

Open master workflow -> Click **Execute Workflow**

Logs will show:

- Idea: FreelancerFlow AI™...
- Eval: 8.2 APPROVED
- Content Factory (5 parallel)
- HTML-PDF
- Publishing Assets
- Packager + Cover + ZIP
- Publishers

Check `C:\DigitalFactory\Products\<slug>\` - you should have full product.

## 10. Publish to Ecommerce

### Gumroad

- After workflow, `gumroad.md` contains description ready to paste.
- If you set GUMROAD_ACCESS_TOKEN env, 08 workflow auto-creates product draft.
- Otherwise manual: Gumroad dashboard -> New Product -> paste title, description, upload ZIP.

### Etsy

- Etsy node creates draft listing if OAuth connected.
- Then manually add digital file in Etsy dashboard (Etsy doesn't allow API file upload for new listings in some regions - upload ZIP manually).

### Shopify

- Shopify node creates product + variant price.
- Need to host ZIP: n8n cannot upload to Shopify Files via node automatically unless you add HTTP Request to `admin/api/2024-01/products/{id}/images.json` + file upload via Digital Downloads app.
- Simplest: Upload ZIP to S3 or Google Drive, add download link in product description + email via Shopify Flow.

See `ECOMMERCE_CONNECTORS.md` for each platform details.

## 11. Daily Automation

In master workflow:

- Schedule Trigger node set to daily 9am -> Set Batch 3.
- So every day 3 products auto-generated.

Enable workflow (toggle Active).

## 12. Quality Control (Your Week 1)

Don't auto-publish low score.

In IF Approved node, set min 7.5 for first week.

Manually review `Customer/User_Guide.md` - reject if generic.

## 13. Bundle & Membership

After you have 5 products:

- Use `src/utils/packager.js` bundle logic or n8n Merge node to ZIP 5 Customer folders.

- Create Gumroad bundle product: $59.

- For membership: Gumroad Membership feature or Payhip Memberships - use n8n to weekly email new product via email node.

## Troubleshooting Windows

- **Puppeteer fails**: `npm install puppeteer` needs Edge. If fails, factory fallback uses HTML only. n8n HTML to PDF node still works.
- **Canvas native module fails**: cover generation falls back to placeholder PNG + SVG. You can use HTML to Image node in n8n as alternative.
- **Groq 429**: Add 5 sec Wait nodes, reduce batch from 3 to 1.
- **n8n file path errors**: Use forward slashes `C:/DigitalFactory/Products/...` not backslash in n8n nodes, per template we provided.

## Next Steps for You

1. Run demo -> see structure
2. Add real Groq key -> generate 1 real product
3. Review publishing assets -> paste to Gumroad test product
4. If sells → enable auto daily batch + auto publish
5. After 5 sales → create bundle + membership

You're done! Factory ships products end-to-end.
