// Vision analysis for ticket attachments (roadmap item 6).
//
// Residents upload a photo of a leak / a broken hinge / a vendor's
// signed contract. Without this module the model never sees those —
// the agent operates purely on the typed description and is blind to
// what the picture shows. With it, the agent gets a short caption +
// structured signals it can branch on ("water_damage, urgency_high").
//
// Architecture choices:
//  - Analyze ONCE per attachment. Cache the result on the row. Repeat
//    agent runs on the same ticket just read the cached fields.
//  - Image-only for now. PDFs need extraction (Claude's vision will
//    take pages as images but we'd need to upload each page separately
//    via a different endpoint). Park PDFs for a follow-up.
//  - JSON output with a strict shape so the prompt can use signals
//    deterministically. We sanitize on the way in.

import db from '../db';
import { chatWithImage, OpenRouterError } from './openrouter';

// Failure kinds where retrying later WILL work — the problem is the AI
// service (no credits, throttled, server blip, timed out, key missing),
// not the image. These must never be cached as "analyzed", or the
// attachment is silently skipped forever once the outage clears.
const TRANSIENT_VISION_ERROR_KINDS = new Set(['credits', 'rate_limit', 'server', 'timeout', 'auth']);

interface AttachmentRow {
  id: number;
  ticket_id: number;
  url: string;
  filename: string | null;
  content_type: string | null;
  ai_description: string | null;
  ai_signals: string | null;
  ai_analyzed_at: string | null;
  ai_analysis_error: string | null;
}

const VISION_SYS = `You are CondoOS Attachment Analyzer. You see photos that condo residents upload when reporting a building problem. Your job is to extract ONE short factual caption + a small set of structured signals the operations agent can branch on. NEVER speculate beyond what is visible. If you can't see anything useful, say so.

Output ONLY compact JSON, no markdown:
{
  "description": "1-2 short sentences in the user's locale describing what is visible.",
  "signals": ["snake_case_tag", "..."]
}

Valid signal tags (mix and match as evidence supports):
  water_damage, water_visible, mold_visible, leak_active, leak_dried
  electrical_burn, exposed_wiring, damaged_fixture
  structural_crack, paint_peel, ceiling_damage
  broken_glass, broken_lock, broken_hinge, broken_door
  pest_visible, debris
  no_visible_problem, photo_too_dark, photo_blurred
  is_invoice, is_contract, is_quote, is_receipt
  urgency_high (e.g. active flooding, exposed live wires, smoke)
  urgency_low (cosmetic only)

Rules:
- 1-6 signals total. Don't speculate — only what's visible.
- "urgency_high" needs an actual hazard, not a guess.
- For documents (invoices/contracts/quotes), still set description to the visible content; signals include the document tag plus any visible total amount or vendor name in the description.`;

interface VisionResult {
  description: string;
  signals: string[];
}

const ALLOWED_SIGNALS = new Set([
  'water_damage', 'water_visible', 'mold_visible', 'leak_active', 'leak_dried',
  'electrical_burn', 'exposed_wiring', 'damaged_fixture',
  'structural_crack', 'paint_peel', 'ceiling_damage',
  'broken_glass', 'broken_lock', 'broken_hinge', 'broken_door',
  'pest_visible', 'debris',
  'no_visible_problem', 'photo_too_dark', 'photo_blurred',
  'is_invoice', 'is_contract', 'is_quote', 'is_receipt',
  'urgency_high', 'urgency_low',
]);

function parseVisionJson(raw: string): VisionResult | null {
  let txt = raw.trim();
  if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(txt);
    const description = String(parsed?.description || '').slice(0, 400).trim();
    const signalsRaw = Array.isArray(parsed?.signals) ? parsed.signals : [];
    const signals = signalsRaw
      .map((s: any) => String(s || '').toLowerCase().trim())
      .filter((s: string) => ALLOWED_SIGNALS.has(s))
      .slice(0, 6);
    if (!description && signals.length === 0) return null;
    return { description, signals };
  } catch {
    return null;
  }
}

function isImageContentType(ct: string | null | undefined): boolean {
  if (!ct) return false;
  return /^image\/(png|jpe?g|webp|gif|heic|heif)/i.test(ct);
}

// Analyze one attachment. Returns the cached result on subsequent calls.
// Idempotent + safe to retry — we only call the model when ai_analyzed_at
// is null. PERMANENT failures (bad image, unparseable response) are cached
// so we don't burn budget retrying a broken URL forever. TRANSIENT failures
// (out of credits, rate-limited, server blip) are NOT cached — the row
// stays retryable so it self-heals once the AI service recovers.
export async function analyzeAttachment(attachmentId: number, locale = 'pt-BR'): Promise<VisionResult | null> {
  const row = db.prepare(
    `SELECT id, ticket_id, url, filename, content_type,
            ai_description, ai_signals, ai_analyzed_at, ai_analysis_error
     FROM ticket_attachments WHERE id = ?`
  ).get(attachmentId) as AttachmentRow | undefined;
  if (!row) return null;

  // Already analyzed (success or hard failure) → return cached.
  if (row.ai_analyzed_at) {
    if (row.ai_description || row.ai_signals) {
      let signals: string[] = [];
      try { signals = row.ai_signals ? JSON.parse(row.ai_signals) : []; } catch { signals = []; }
      return { description: row.ai_description || '', signals };
    }
    return null;
  }

  // Not an image → cache that fact and skip the call.
  if (!isImageContentType(row.content_type)) {
    db.prepare(
      `UPDATE ticket_attachments
       SET ai_analyzed_at = CURRENT_TIMESTAMP, ai_analysis_error = 'unsupported_content_type'
       WHERE id = ?`
    ).run(attachmentId);
    return null;
  }

  try {
    const userPrompt = `Locale: ${locale}\nReturn the JSON object only. Describe what is visible and list any matching signal tags.`;
    const text = await chatWithImage(VISION_SYS, userPrompt, [{ url: row.url, detail: 'low' }], { maxTokens: 400 });
    const parsed = parseVisionJson(text);
    if (!parsed) {
      db.prepare(
        `UPDATE ticket_attachments
         SET ai_analyzed_at = CURRENT_TIMESTAMP, ai_analysis_error = 'unparseable_response'
         WHERE id = ?`
      ).run(attachmentId);
      return null;
    }
    db.prepare(
      `UPDATE ticket_attachments
       SET ai_description = ?, ai_signals = ?, ai_analyzed_at = CURRENT_TIMESTAMP, ai_analysis_error = NULL
       WHERE id = ?`
    ).run(parsed.description, JSON.stringify(parsed.signals), attachmentId);
    return parsed;
  } catch (err) {
    // Transient AI-service failure → leave ai_analyzed_at NULL so the next
    // run retries. Record a breadcrumb in ai_analysis_error only.
    if (err instanceof OpenRouterError && TRANSIENT_VISION_ERROR_KINDS.has(err.kind)) {
      db.prepare(
        `UPDATE ticket_attachments SET ai_analysis_error = ? WHERE id = ?`
      ).run(`transient:${err.kind}`, attachmentId);
      return null;
    }
    // Permanent failure (broken URL, image the provider rejected, etc.) →
    // cache it so we don't keep paying to retry a genuinely bad attachment.
    const code = (err as Error)?.message || 'vision_failed';
    db.prepare(
      `UPDATE ticket_attachments
       SET ai_analyzed_at = CURRENT_TIMESTAMP, ai_analysis_error = ?
       WHERE id = ?`
    ).run(code.slice(0, 120), attachmentId);
    return null;
  }
}

// Convenience: analyze every un-analyzed attachment on a ticket, return
// the resulting list. Used by the runner before agent invocation.
export async function analyzeTicketAttachments(ticketId: number, locale = 'pt-BR'): Promise<Array<{ id: number; description: string; signals: string[] }>> {
  const rows = db.prepare(
    `SELECT id FROM ticket_attachments WHERE ticket_id = ?`
  ).all(ticketId) as Array<{ id: number }>;
  const out: Array<{ id: number; description: string; signals: string[] }> = [];
  for (const r of rows) {
    const result = await analyzeAttachment(r.id, locale);
    if (result) out.push({ id: r.id, ...result });
  }
  return out;
}

// Read cached analysis without doing any new model calls. Used in the
// agent prompt-context building when we just want what's already there.
export function getCachedAttachmentAnalysis(ticketId: number): Array<{ id: number; description: string; signals: string[] }> {
  const rows = db.prepare(
    `SELECT id, ai_description, ai_signals
     FROM ticket_attachments
     WHERE ticket_id = ? AND ai_description IS NOT NULL`
  ).all(ticketId) as Array<{ id: number; ai_description: string | null; ai_signals: string | null }>;
  return rows.map((r) => {
    let signals: string[] = [];
    try { signals = r.ai_signals ? JSON.parse(r.ai_signals) : []; } catch { signals = []; }
    return { id: r.id, description: r.ai_description || '', signals };
  });
}
