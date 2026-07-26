# Fix: Header name must be a valid HTTP token ["Groq Auth"]

## Your Screenshot Problem

You have:

- **Name field:** `Groq Auth` ← WRONG
- **Value field:** `••••••••` (your API key)

Error:
```
Header name must be a valid HTTP token ["Groq Auth"]
```

**Why:** In Header Auth credential, the field labeled "Name" is NOT the credential's display name. It's the **HTTP header name**. HTTP header names cannot have spaces. "Groq Auth" has a space → invalid.

## Correct Setup

In n8n Header Auth credential modal (your screenshot):

- **Name:** `Authorization`  (exactly this, capital A)
- **Value:** `Bearer gsk_your_real_key_from_console.groq.com`

**NOT:**
- Name = Groq Auth (that's invalid, has space)
- Value = just gsk_... without Bearer (Groq expects Bearer prefix)

### Step-by-Step Correct

1. In n8n, go to **Credentials** → Click your `Groq Auth` credential to edit (the one in screenshot).

2. You will see two fields under Connection tab:
   - **Name**
   - **Value**

3. Set them to:

   ```
   Name: Authorization
   Value: Bearer gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   - Name must be `Authorization` (no spaces, capital A)
   - Value must start with `Bearer ` + space + your key

   Example:
   ```
   Name: Authorization
   Value: Bearer gsk_abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
   ```

4. At top of modal, there is credential display name (outside Connection tab) — THAT can be `Groq Auth` — but the field inside Connection → Name must be `Authorization`.

   Confusing UI:
   - Top title: "Header Auth account" → subtitle "Header Auth" → this is credential type
   - Inside form → **Name** = HTTP header name (must be Authorization)
   - Inside form → **Value** = HTTP header value (must be Bearer gsk_...)

   In your screenshot, you put credential display name into header name field.

5. Save.

6. Now go to workflow node **Groq Idea Generation** → Credential → should show `Header Auth account` with your saved credential that now has correct header name.

7. Parameters:
   - Method: POST (we fixed in v2.2)
   - URL: https://api.groq.com/openai/v1/chat/completions
   - Authentication: Header Auth
   - Credential: Groq Auth (now correct)
   - Send Body: ON

8. Click **Execute step** → Should now return JSON with slug, brand_name, etc., not 404 and not header token error.

### How Header Auth Works

When you set:
- Name = Authorization
- Value = Bearer gsk_...

n8n sends HTTP request:

```
GET or POST https://api.groq.com/openai/v1/chat/completions
Headers:
  Authorization: Bearer gsk_...
  Content-Type: application/json
```

Groq expects exactly that.

If you set Name = Groq Auth, n8n sends:

```
Headers:
  Groq Auth: gsk_...
```

Groq doesn't understand "Groq Auth" header → and n8n throws ERR_INVALID_HTTP_TOKEN because "Groq Auth" with space is invalid HTTP token.

### Quick Test via curl (to verify key works)

Test your key outside n8n:

```powershell
curl -X POST https://api.groq.com/openai/v1/chat/completions -H "Authorization: Bearer gsk_your_key" -H "Content-Type: application/json" -d "{\"model\":\"llama-3.1-8b-instant\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```

Should return JSON with choices.

If curl works but n8n fails, it's definitely credential Name field.

### Updated Workflows

Latest workflows in repo (`00-ALL-IN-ONE-SIMPLE.json` v2.2) now have:

```json
"nodeCredentialType": "httpHeaderAuth",
"credentials": {
  "httpHeaderAuth": {
    "id": "groq-api-key",
    "name": "Groq Auth"
  }
}
```

And method POST fixed.

Re-import via Workflows overview → Import from File after pulling latest.

### Final Checklist

- [ ] Header Auth credential → Name = Authorization (not Groq Auth)
- [ ] Value = Bearer gsk_... (with Bearer prefix + space)
- [ ] No spaces in Name field
- [ ] Method = POST in all Groq nodes
- [ ] URL = https://api.groq.com/openai/v1/chat/completions
- [ ] Credential Type = Header Auth (not Groq type)

After fix, Execute step should succeed.
