# Fix: 'messages' value must be an array (400 Bad Request)

## Your Screenshot Error

```
Bad request - please check your parameters
'messages' : value must be an array
```

Screenshot shows:
- Name: messages
- Value: [{"role":"system",...},{"role":"user",...}}] with {{$json.niche_hint}} inside

**Cause:** n8n HTTP Request node was set to "Using Fields Below" with Field Name=messages, Value=string containing JSON array. But n8n sends it as string, Groq expects actual array.

**Example of wrong:**
```
Name: messages
Value: [{"role":"system","content":"..."}]  ← sent as STRING "[{"role"...}]" not array
```

Groq error: messages must be an array, not string.

## Fix Options

### Option 1: Use Fixed Workflows v2.3 (Recommended)

I just pushed v2.3 where all Groq nodes use **Specify Body: JSON** with **JSON/Raw** mode, not Fields Below.

```json
Method: POST
URL: https://api.groq.com/openai/v1/chat/completions
Authentication: Header Auth
Body: JSON/Raw
jsonBody: = {
  "model": "llama-3.3-70b-versatile",
  "temperature": 0.9,
  "response_format": {"type": "json_object"},
  "messages": [
    {"role": "system", "content": "You are..."},
    {"role": "user", "content": "Generate for niche: " + $json.niche_hint}
  ]
}
```

This sends messages as real array.

**Pull and re-import:**

```powershell
cd C:\factory\agentfinance
git pull origin arena/019f7204-agentfinance

# In n8n: Workflows overview → Delete old messy workflow → Import from File → 00-ALL-IN-ONE-SIMPLE.json (now v2.3)
# Set credentials: Header Auth → Name=Authorization, Value=Bearer gsk_...
# Method should show POST
# Body should show JSON/Raw mode, not Fields Below
```

### Option 2: Quick Fix in Your Existing Node (Without Re-import)

If you want to fix your current node in screenshot:

1. Click node **Groq Idea Generation**
2. Scroll down to **Body** section
3. Change **Specify Body** from `Using Fields Below` to `Using JSON`
4. Toggle to **JSON/Raw**
5. Paste this (adjust niche variable):

```json
={
  "model": "llama-3.3-70b-versatile",
  "temperature": 0.9,
  "response_format": {"type": "json_object"},
  "messages": [
    {"role": "system", "content": "You are premium digital product strategist. JSON only, brandable name with ™, outcome-driven not toolkit."},
    {"role": "user", "content": "Generate ONE premium product for niche: {{$json.niche_hint}}. Return JSON: slug, brand_name with ™, title outcome, outcome, tagline, avatar specific, pain, dream_outcome, core_modules[6-8], deliverables[], differentiation, price_point, price_reason, bundle_with[], keywords[10], est_demand, competition_level"}
  ]
}
```

But for Expression to work, use **Expression mode** for JSON/Raw:

Click `fx` icon next to JSON/Raw field → Switch to Expression → Paste:

```javascript
= {
  "model": "llama-3.3-70b-versatile",
  "temperature": 0.9,
  "response_format": {"type": "json_object"},
  "messages": [
    {"role": "system", "content": "You are premium digital product strategist. JSON only, brandable name with ™, outcome-driven not toolkit."},
    {"role": "user", "content": "Generate ONE premium product for niche: " + $json.niche_hint + ". Return JSON with: slug, brand_name with ™, title outcome, outcome, tagline, avatar specific, pain, dream_outcome, core_modules[6-8], deliverables[], differentiation, price_point, price_reason, bundle_with[], keywords[10], est_demand, competition_level"}
  ]
}
```

Notice `$json.niche_hint` concatenated with `+`, not `{{$json.niche_hint}}` inside string. In Expression mode you use JS.

6. Save, Execute step → should return JSON product.

### For All Nodes

Repeat for:

- Groq Evaluator: messages must be array, use JSON/Raw mode with `= { "model": "llama-3.1-8b-instant", ... "messages": [ {"role":"system", ...}, {"role":"user", "content": "Evaluate Title: " + $json.title + ... } ] }`
- Groq Guide, Groq Prompts, Groq Checklist, etc.

**All fixed in v2.3 workflows you can pull.**

### Verify

After fix, Execute step → OUTPUT should show 1 item with JSON containing `choices[0].message.content` that is your product idea JSON, not error.

Then Execute full workflow → creates files in `C:/DigitalFactory/Products/`.

### Why This Happened

We originally used "Using Fields Below" with messages field containing JSON array string. n8n sent it as string, Groq expects array. Fix is JSON/Raw mode with `= { ... messages: [ array ] }` expression.
