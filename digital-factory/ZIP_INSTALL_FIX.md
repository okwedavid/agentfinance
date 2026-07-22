# Fix for ZIP Download + npm install Error (Windows)

## Your Error Explained

```
npm error ... canvas ... Cannot open include file: 'cairo.h'
node-pre-gyp ERR! 404 canvas-v2.11.2-node-v127-win32-unknown-x64.tar.gz
EPERM: operation not permitted, rmdir ...\node_modules\socks-proxy-agent\node_modules
```

**Causes:**

1. **Double-nested path:** `C:\Users\DELL\Desktop\agentfinance\agentfinance\digital-factory\` = agentfinance inside agentfinance + >260 chars Windows limit → EPERM.

2. **`canvas` needs GTK/Cairo** not installed. No prebuilt for Node 22.13.1 (node-v127) → tries compile fails `cairo.h`.

3. **Old puppeteer@22 deprecated**.

## Fix — Lightweight v2.1 (No canvas)

We removed canvas and made puppeteer optional. Factory now works with SVG+HTML.

### Step 1: Move to Short Path

Don't use Desktop\agentfinance\agentfinance...

```powershell
mkdir C:\factory
xcopy C:\Users\DELL\Desktop\agentfinance\agentfinance\digital-factory C:\factory /E /I
cd C:\factory
```

Or extract ZIP directly to `C:\factory`.

### Step 2: Close Locking Apps

Close VS Code, n8n, kill node.exe.

### Step 3: Run Fix Script (Admin PowerShell)

```powershell
cd C:\factory
.\scripts\fix-windows-install.bat
```

Does:

- Deletes node_modules (handles EPERM)
- Enables LongPaths in Registry
- `npm install --no-optional` (skips canvas/puppeteer native)
- Tests `node src/demo/generateDemoProduct.js`

### Or Manual:

```powershell
cd C:\factory
rmdir /s /q node_modules
del package-lock.json
npm install --no-optional --legacy-peer-deps
```

Now package.json v2.1 has only lightweight deps: groq-sdk, archiver, marked, dotenv, slugify, zod. No canvas.

### Step 4: Test No Key

```powershell
node src/demo/generateDemoProduct.js
dir Products\ai-freelancer-client-os\Customer\
```

### Step 5: Real Test

```powershell
copy .env.example .env
notepad .env
# GROQ_API_KEY=gsk_... from https://console.groq.com/keys
npm run factory:single
```

Works without puppeteer — creates Cover.svg (premium) + Cover.html viewer + placeholder Cover.png. Gumroad/Etsy accept SVG. n8n HTML to PDF node creates real PDFs in production.

Optional real PNG locally:

```powershell
npm install puppeteer@24.15.0 --no-save
```

But optional.

## For Git Clone (Future)

```powershell
cd C:\
git clone https://github.com/okwedavid/agentfinance.git --branch arena/019f7204-agentfinance --depth 1
cd agentfinance\digital-factory
npm install --no-optional
```

ZIP double nesting avoid by extracting to short path.

## Still Fails?

1. Delete `C:\Users\DELL\Desktop\agentfinance\` (backup)
2. Extract to `C:\factory` only
3. Run PowerShell as Admin
4. `cd C:\factory && npm install --no-optional`

Then see TESTING_GUIDE.md.
