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
// Claude 3.5 Haiku doesn't support vision (Anthropic removed image input
// from the haiku tier). For the vision path we route to claude-3-haiku
// (the older one DOES support images) which is the closest cost match.
// Override via env when a different vision model is preferred.
const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'anthropic/claude-3-haiku';
const API_KEY     = process.env.OPENROUTER_API_KEY || '';
const URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 20_000);

// ---------------------------------------------------------------------------
// Typed errors + credit circuit breaker
//
// Every caller used to get an opaque `Error("OpenRouter 402")`, so a hard
// account-level failure (out of credits) was indistinguishable from a
// transient 5xx — and every subsequent request kept hammering a dead
// account. We now classify the failure and, on a credits (402) error, open
// a short circuit breaker: further calls short-circuit to the caller's
// fallback instantly instead of round-tripping to a known-dead API. The
// breaker auto-resets after a cooldown, so it self-heals once credits return.
// ---------------------------------------------------------------------------

export type OpenRouterErrorKind =
  | 'credits'      // 402 — account out of credits (hard, account-level)
  | 'rate_limit'   // 429 — throttled (transient)
  | 'auth'         // 401/403 or missing key (config)
  | 'server'       // 5xx or network failure (transient)
  | 'timeout'      // request aborted on TIMEOUT_MS
  | 'unknown';

export class OpenRouterError extends Error {
  status: number;
  kind: OpenRouterErrorKind;
  constructor(status: number, kind: OpenRouterErrorKind, message?: string) {
    super(message || `OpenRouter ${status} (${kind})`);
    this.name = 'OpenRouterError';
    this.status = status;
    this.kind = kind;
  }
}

export function classifyStatus(status: number): OpenRouterErrorKind {
  if (status === 402) return 'credits';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'unknown';
}

const BREAKER_COOLDOWN_MS = Number(process.env.OPENROUTER_BREAKER_COOLDOWN_MS || 5 * 60_000);
let breakerOpenUntil = 0;

function breakerIsOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

function tripBreaker(reason: string): void {
  const wasOpen = breakerIsOpen();
  breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
  if (!wasOpen) {
    console.warn(`[ai] credit circuit breaker OPEN (~${Math.round(BREAKER_COOLDOWN_MS / 60_000)}min) — ${reason}`);
  }
}

// Called after any successful OpenRouter response. If the breaker had
// tripped earlier, a success means credits are back — clear it and log.
function noteSuccess(): void {
  if (breakerOpenUntil !== 0) {
    console.info('[ai] credit circuit breaker recovered — OpenRouter call succeeded');
    breakerOpenUntil = 0;
  }
}

/** Breaker state for the spend-visibility endpoint (Phase 1.6). */
export function aiBreakerState(): { open: boolean; openUntil: number | null } {
  return { open: breakerIsOpen(), openUntil: breakerOpenUntil || null };
}

// Shared !res.ok handler — classifies, logs, trips the breaker on credits,
// and throws a typed error every caller can branch on.
async function throwForResponse(res: Response, label: string): Promise<never> {
  const txt = await res.text().catch(() => '');
  const kind = classifyStatus(res.status);
  console.error(`[ai] OpenRouter ${label} error`, res.status, kind, txt.slice(0, 300));
  if (kind === 'credits') tripBreaker(`${res.status} on ${label}`);
  throw new OpenRouterError(res.status, kind, `OpenRouter ${res.status} ${label}`);
}

// Wraps the fetch so an AbortController timeout (or a raw network failure)
// becomes a typed OpenRouterError instead of a bare DOMException.
async function fetchOpenRouter(body: unknown, label: string): Promise<Response> {
  if (breakerIsOpen()) {
    throw new OpenRouterError(402, 'credits', `OpenRouter ${label} skipped — credit circuit breaker open`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(URL, {
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
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new OpenRouterError(0, 'timeout', `OpenRouter ${label} timed out after ${TIMEOUT_MS}ms`);
    }
    throw new OpenRouterError(0, 'server', `OpenRouter ${label} network error: ${(err as Error)?.message || err}`);
  } finally {
    clearTimeout(timeout);
  }
}

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
    throw new OpenRouterError(0, 'auth', 'NO_API_KEY');
  }
  const model = opts.model ?? (opts.tier === 'cheap' ? CHEAP_MODEL : MODEL);
  const body: any = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 800,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetchOpenRouter(body, 'chat');
  if (!res.ok) await throwForResponse(res, 'chat');

  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new OpenRouterError(502, 'server', 'OpenRouter empty response');
  noteSuccess();
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
    throw new OpenRouterError(0, 'auth', 'NO_API_KEY');
  }
  // Vision path uses VISION_MODEL by default — the regular MODEL (claude-
  // 3.5-haiku) doesn't support image input.
  const model = opts.model ?? VISION_MODEL;
  const content: any[] = [{ type: 'text', text: userPrompt }];
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: img.url, detail: img.detail || 'low' } });
  }
  const res = await fetchOpenRouter({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
    max_tokens: opts.maxTokens ?? 600,
    temperature: opts.temperature ?? 0.2,
    ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  }, 'vision');
  if (!res.ok) await throwForResponse(res, 'vision');

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new OpenRouterError(502, 'server', 'OpenRouter empty vision response');
  noteSuccess();
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
    throw new OpenRouterError(0, 'auth', 'NO_API_KEY');
  }
  const model = opts.model ?? (opts.tier === 'cheap' ? CHEAP_MODEL : MODEL);
  const maxIterations = opts.maxIterations ?? 6;
  const toolCalls: ChatWithToolsResult['toolCalls'] = [];
  // Conversation grows each iteration — clone the initial messages so
  // callers don't see their array mutated, then append assistant + tool
  // responses as we go.
  const messages: any[] = initialMessages.map((m) => ({ role: m.role, content: m.content }));

  for (let iter = 0; iter < maxIterations; iter++) {
    const res = await fetchOpenRouter({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 2_000,
      temperature: opts.temperature ?? 0.3,
      tools,
      tool_choice: 'auto',
    }, 'tool-use');
    if (!res.ok) await throwForResponse(res, 'tool-use');

    const data: any = await res.json();
    const choice = data?.choices?.[0];
    if (!choice) throw new OpenRouterError(502, 'server', 'OpenRouter empty response');
    noteSuccess();

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
