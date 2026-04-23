// OpenRouter client with graceful degradation.
// Returns sensible canned output if API key is missing/errors so demo never hangs.
import fetch from 'node-fetch';

const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-haiku';
const API_KEY = process.env.OPENROUTER_API_KEY || '';
const URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIOpts {
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export async function chat(messages: AIMessage[], opts: AIOpts = {}): Promise<string> {
  if (!API_KEY) {
    console.warn('[ai] OPENROUTER_API_KEY not set - using fallback');
    throw new Error('NO_API_KEY');
  }
  const body: any = {
    model: MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://condoos.dev',
      'X-Title': 'CondoOS',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('[ai] OpenRouter error', res.status, txt.slice(0, 300));
    throw new Error(`OpenRouter ${res.status}`);
  }
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter empty response');
  return String(content);
}

export function parseJsonLoose<T = any>(text: string): T | null {
  // Strip markdown code fences if the model wraps JSON in them.
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try { return JSON.parse(cleaned) as T; } catch {}
  // Find first {...} block.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]) as T; } catch {}
  }
  return null;
}
