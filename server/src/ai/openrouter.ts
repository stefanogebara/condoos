// OpenRouter client with graceful degradation.
// Returns sensible canned output if API key is missing/errors so demo never hangs.
// Audit L-N2 — Node 20+ has built-in fetch; node-fetch dep removed.

// Two-tier model strategy for cost + quality:
//   - MODEL:       Claude 3.5 Haiku for user-facing copy (drafts, summaries, announcements, ata).
//   - CHEAP_MODEL: DeepSeek V3 (~3x cheaper than Haiku) for pure structured tasks
//                  (classification, clustering) where tone doesn't matter.
// Callers opt into the cheap tier via `{ tier: 'cheap' }` in AIOpts.
const MODEL       = process.env.OPENROUTER_MODEL       || 'anthropic/claude-3.5-haiku';
const CHEAP_MODEL = process.env.OPENROUTER_CHEAP_MODEL || 'deepseek/deepseek-chat';
const API_KEY     = process.env.OPENROUTER_API_KEY || '';
const URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 20_000);

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://condoos.dev',
        'X-Title': 'CondoOS',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

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

// Vision call — single-turn, single-image. OpenRouter follows OpenAI's
// content-array convention: text + image_url parts in one user message.
// Anthropic models accept https URLs directly (the provider fetches the
// bytes); same for Gemini. We use the same MODEL constant as the
// quality tier so vision quality matches general agent quality.
export interface VisionImage {
  url: string;
  detail?: 'low' | 'high';
}

export async function chatWithImage(
  systemPrompt: string,
  userPrompt: string,
  images: VisionImage[],
  opts: AIOpts = {},
): Promise<string> {
  if (!API_KEY) {
    console.warn('[ai] OPENROUTER_API_KEY not set - vision disabled');
    throw new Error('NO_API_KEY');
  }
  const model = opts.model ?? (opts.tier === 'cheap' ? CHEAP_MODEL : MODEL);
  const content: any[] = [{ type: 'text', text: userPrompt }];
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: img.url, detail: img.detail || 'low' } });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://condoos.dev',
        'X-Title': 'CondoOS',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        max_tokens: opts.maxTokens ?? 600,
        temperature: opts.temperature ?? 0.2,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const txt = await res.text();
    console.error('[ai] OpenRouter vision error', res.status, txt.slice(0, 300));
    throw new Error(`OpenRouter ${res.status}`);
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter empty vision response');
  return String(text);
}

// ReAct tool-use loop. OpenRouter speaks OpenAI's tool-calling protocol
// regardless of which model backs the request (Anthropic, DeepSeek, etc.),
// so we use that wire format here.
//
// Caller supplies:
//   - tools: schema descriptions the model sees
//   - toolHandler: (name, input) => arbitrary JSON, run server-side
//
// The loop:
//   1. Send messages + tools.
//   2. If response is plain text, return it.
//   3. If response contains tool_calls, run each via toolHandler,
//      append both the assistant's tool_calls message AND the tool
//      results to the conversation, then call the model again.
//   4. Cap at maxIterations to prevent runaway loops on misbehaving
//      models. Default 6 — enough for any reasonable agent task,
//      cheap enough that a stuck loop costs $0.10 not $10.
//
// Falls back to throwing on errors so callers can degrade to the
// existing single-shot path.

export interface AIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type AIToolHandler = (name: string, input: any) => Promise<any>;

export interface ChatWithToolsResult {
  text: string;
  toolCalls: Array<{ name: string; input: any; output: any }>;
  iterations: number;
}

export async function chatWithTools(
  initialMessages: AIMessage[],
  tools: AIToolSchema[],
  toolHandler: AIToolHandler,
  opts: AIOpts & { maxIterations?: number } = {},
): Promise<ChatWithToolsResult> {
  if (!API_KEY) {
    console.warn('[ai] OPENROUTER_API_KEY not set - tool-use disabled');
    throw new Error('NO_API_KEY');
  }
  const model = opts.model ?? (opts.tier === 'cheap' ? CHEAP_MODEL : MODEL);
  const maxIterations = opts.maxIterations ?? 6;
  const toolCalls: ChatWithToolsResult['toolCalls'] = [];
  // Conversation grows each iteration — clone the initial messages so
  // callers don't see their array mutated, then append assistant + tool
  // responses as we go.
  const messages: any[] = initialMessages.map((m) => ({ role: m.role, content: m.content }));

  for (let iter = 0; iter < maxIterations; iter++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://condoos.dev',
          'X-Title': 'CondoOS',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.maxTokens ?? 2_000,
          temperature: opts.temperature ?? 0.3,
          tools,
          tool_choice: 'auto',
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error('[ai] OpenRouter tool-use error', res.status, txt.slice(0, 300));
      throw new Error(`OpenRouter ${res.status}`);
    }
    const data: any = await res.json();
    const choice = data?.choices?.[0];
    if (!choice) throw new Error('OpenRouter empty response');

    const message = choice.message || {};
    const finishReason = choice.finish_reason;

    // If the model didn't request tools, we're done — return its text.
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0 || finishReason === 'stop') {
      return { text: String(message.content || ''), toolCalls, iterations: iter + 1 };
    }

    // Echo the assistant turn back into the conversation (required by
    // the protocol — the next request must include the tool_calls the
    // model just made so the tool_result rows it sends next have
    // matching ids).
    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: calls,
    });

    // Run each tool. We do these sequentially because most of our
    // handlers are cheap synchronous DB reads — Promise.all here would
    // burn a connection pool slot per call for negligible wall-time gain.
    for (const call of calls) {
      const name = call.function?.name || '';
      let input: any = {};
      try {
        input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        input = { _parse_error: 'invalid_json_arguments' };
      }
      let output: any;
      try {
        output = await toolHandler(name, input);
      } catch (err) {
        output = { error: (err as Error)?.message || 'tool_handler_failed' };
      }
      toolCalls.push({ name, input, output });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  // Out of iterations — return whatever assistant text we have plus a
  // marker so the caller knows the loop didn't converge cleanly.
  const last = messages[messages.length - 1];
  return {
    text: typeof last?.content === 'string' ? last.content : '',
    toolCalls,
    iterations: maxIterations,
  };
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
