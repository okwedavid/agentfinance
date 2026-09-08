import Groq from 'groq-sdk';
import { CONFIG } from './config.js';

let groq = null;
function getClient() {
  if (!CONFIG.groq.apiKey) throw new Error('GROQ_API_KEY missing. Set in .env');
  if (!groq) groq = new Groq({ apiKey: CONFIG.groq.apiKey });
  return groq;
}

export async function groqJSON({ system, user, model, temperature = 0.7, maxTokens = 4096 }) {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: model || CONFIG.groq.model,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  const content = completion.choices[0]?.message?.content;
  try {
    return JSON.parse(content);
  } catch (e) {
    // fallback extract JSON block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Groq did not return valid JSON: ${content.slice(0,500)}`);
  }
}

export async function groqText({ system, user, model, temperature = 0.7, maxTokens = 4096 }) {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: model || CONFIG.groq.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  return completion.choices[0]?.message?.content;
}
