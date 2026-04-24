// OpenRouter client with graceful degradation.
// Returns sensible canned output if API key is missing/errors so demo never hangs.
import fetch from 'node-fetch';

// Two-tier model strategy for cost + quality:
//   - MODEL:       Claude 3.5 Haiku for user-facing copy (drafts, summaries, announcements, ata).
//   - CHEAP_MODEL: DeepSeek V3 (~3x cheaper than Haiku) for pure structured tasks
//                  (classification, clustering) where tone doesn't matter.
// Callers opt into the cheap tier via `{ tier: 'cheap' }` in AIOpts.
const MODEL       = process.env.OPENROUTER_MODEL       || 'anthropic/claude-3.5-haiku';
const CHEAP_MODEL = process.env.OPENROUTER_CHEAP_MODEL || 'deepseek/deepseek-chat';
const API_KEY     = process.env.OPENROUTER_API_KEY || '';
const URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIOpts {
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** 'cheap' routes to DeepSeek-V3 for 3x cost savings. Default 'quality' uses Haiku. */
  tier?: 'quality' | 'cheap';
  /** Explicit model override — takes precedence over tier. */
  model?: string;
}

export async function chat(messages: AIMessage[], opts: AIOpts = {}): Promise<string> {
  if (!API_KEY) {
    console.warn('[ai] OPENROUTER_API_KEY not set - using fallback');
    throw new Error('NO_API_KEY');
  }
  const model = opts.model ?? (opts.tier === 'cheap' ? CHEAP_MODEL : MODEL);
  const body: any = {
    model,
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

/**
 * Escapes literal control characters (\n, \r, \t) that appear inside JSON
 * string literals. Claude (and other models) sometimes emits raw newlines
 * inside multi-paragraph string fields like `resident_announcement.body`,
 * producing technically-invalid JSON that JSON.parse rejects with "Bad
 * control character in string literal".
 *
 * We walk the string with a tiny state machine so we only escape control
 * chars that are actually inside a "..." string, not structural whitespace.
 */
function escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { out += ch; escape = false; continue; }
    if (ch === '\\') { out += ch; escape = true; continue; }
    if (ch === '"') { out += ch; inString = !inString; continue; }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

export function parseJsonLoose<T = any>(text: string): T | null {
  // Strip markdown code fences if the model wraps JSON in them.
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // 1. Raw parse (hits the happy path for well-formed responses)
  try { return JSON.parse(cleaned) as T; } catch {}
  // 2. Sanitize control chars inside strings, try again
  try { return JSON.parse(escapeControlCharsInStrings(cleaned)) as T; } catch {}
  // 3. Try the first {...} block, also sanitized
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(escapeControlCharsInStrings(match[0])) as T; } catch {}
  }
  return null;
}
