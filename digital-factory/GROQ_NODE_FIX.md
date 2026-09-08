# Fix 404 GET /openai/v1/chat/completions

Method must be POST, Credential Type must be Header Auth (Authorization Bearer), not Groq credential.

In n8n node Groq Idea Generation:
- Method: POST (you have GET)
- URL: https://api.groq.com/openai/v1/chat/completions
- Authentication: Predefined Credential Type
- Credential Type: Header Auth
- Credential: Groq Auth (Header Auth with Bearer gsk_...)
- Send Body: ON, Body Content Type JSON

Do NOT use Credential Type = Groq. That's for AI nodes.

Fixed workflows pushed - re-import via Workflows overview → Import from File.
