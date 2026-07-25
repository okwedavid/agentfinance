# n8n Workflow Import Reference — Step-by-Step Pathway

Your screenshot shows workflow "02 - IDEA GENERATOR" containing 14 nodes (both master + idea generator mixed). This is WRONG import.

You imported master workflow INTO idea generator canvas, merging them. n8n "Import from File" should create NEW workflow, not add nodes to existing.

## Correct Import Pathway (Windows 11 Local n8n)

### Step 0: Clean Wrong Workflows

1. Open n8n http://localhost:5678
2. Left side → Workflows
3. Delete all imported factory workflows that look messy (the one in your screenshot with 14 nodes mixed)
4. Start fresh.

### Step 1: Fix npm Path Error

Your npm error `ENOENT C:\factory\agentfinance\package.json` means WRONG folder.

**You are here:** `C:\factory\agentfinance\` — NO package.json

**Factory is here:**

- If cloned whole repo to `C:\factory\agentfinance` → `C:\factory\agentfinance\digital-factory\package.json`
- If extracted only digital-factory to `C:\factory` → `C:\factory\package.json`

**Correct:**

```powershell
# If cloned whole repo
cd C:\factory\agentfinance\digital-factory
npm install --omit=optional

# If extracted only digital-factory to C:\factory
cd C:\factory
npm install --omit=optional
```

NOT `npm install --no-optional --legacy-peer-deps` (old flag). New: `--omit=optional`.

If you run npm install in `C:\factory\agentfinance`, it looks for `package.json` → doesn't exist → ENOENT.

**Diagnostic script included:**

```powershell
cd C:\factory
.\scripts\diagnose-path.bat
```

### Step 2: Import 8 Workflows Correctly (Separate, Not Merged)

**DO NOT open a workflow and then Import File → adds nodes to current canvas (your bug).**

**DO:**

1. In n8n, go to Workflows overview (list, not editor).

2. Top right → Import from File → `00-ALL-IN-ONE-SIMPLE.json` FIRST (beginner single workflow) → creates NEW workflow.

3. Then Workflows overview → Import from File → `01-master-factory.json` → NEW workflow "01 - DIGITAL FACTORY MASTER"

4. Repeat:
   - `02-idea-generator.json` → ONLY 4 nodes, not 14
   - `03-evaluator.json`
   - `04-content-factory.json`
   - `05-html-pdf.json`
   - `06-publishing-assets.json`
   - `07-packager-cover.json`
   - `08-ecommerce-publishers.json`

After, 9 workflows total, each <12 nodes.

### Step 3: Credentials

1. Credentials → New → Header Auth
   - Name: `Groq Auth`
   - Header: `Authorization`
   - Value: `Bearer gsk_...` from https://console.groq.com/keys
2. Open each workflow → each Groq HTTP node → Credential → Select Groq Auth

For 00-ALL-IN-ONE-SIMPLE, set in ~7 nodes.

### Step 4: Set File Paths

Create folders:

```powershell
mkdir C:\DigitalFactory
mkdir C:\DigitalFactory\Products
mkdir C:\DigitalFactory\Published
mkdir C:\DigitalFactory\catalog
```

Nodes use `C:/DigitalFactory/...` forward slashes.

### Step 5: Execute

Beginner: Open `00 - ALL-IN-ONE SIMPLE FACTORY` → Execute Workflow → green nodes → check `C:\DigitalFactory\Products\`

Advanced: Open `01 - DIGITAL FACTORY MASTER` → Execute Workflow → calls sub-workflows by name.

If error `Workflow with name 02 - IDEA GENERATOR not found`, rename exactly: `02 - IDEA GENERATOR`, `03 - EVALUATOR`, etc.

### Troubleshooting

- Nodes not connected (14 nodes mixed) → delete, re-import via overview not editor
- Red dots → missing Groq Auth or workflow name mismatch
- ENOENT package.json → cd into digital-factory
- EPERM → close VS Code, move to C:\factory short path, run fix-windows-install.bat

## Summary Pathway

1. Fix path → cd digital-factory → npm install --omit=optional
2. Delete messy workflows → Workflows overview → Import from File → create new → import 00 + 01-08 separately → 9 workflows
3. Set Groq Auth credential once
4. Create C:\DigitalFactory folders
5. Execute 00-ALL-IN-ONE-SIMPLE → check Products
