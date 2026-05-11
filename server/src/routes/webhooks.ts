// Inbound webhooks — public endpoints that vendor reply services call into.
// No auth middleware (the providers don't carry our JWT); instead each handler
// verifies the provider's signature or shared secret before mutating state.
//
// Currently handles WhatsApp inbound (Twilio + WAHA). Email inbound would
// belong here too once we wire Postmark/SendGrid Inbound Parse — kept the
// router shape generic so it's a single new POST handler away.

import { Router, type Request, type Response } from 'express';
import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import db from '../db';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

// Twilio sends form-encoded bodies (application/x-www-form-urlencoded);
// the global express.json() doesn't parse them. Mount urlencoded() on this
// router only so we don't touch how every other route parses its payload.
router.use(express.urlencoded({ extended: false }));

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

// Public base URL the webhook is mounted at — Twilio's signature is computed
// against the full URL it called, so we need to reconstruct it from our side.
// Set WEBHOOK_BASE_URL=https://condoos-api.fly.dev in Fly secrets.
function reconstructUrl(req: Request, path: string): string {
  const base = env('WEBHOOK_BASE_URL') || `${req.protocol}://${req.get('host') || ''}`;
  return `${base.replace(/\/+$/, '')}${path}`;
}

// Twilio's signing algo: HMAC-SHA1 of (URL + sorted-params-concatenated)
// keyed on the auth token; the result is the X-Twilio-Signature header
// (base64). Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
function verifyTwilioSignature(req: Request, fullUrl: string): boolean {
  const authToken = env('TWILIO_AUTH_TOKEN');
  if (!authToken) return false;
  const provided = req.get('x-twilio-signature') || '';
  if (!provided) return false;

  const params = req.body as Record<string, string>;
  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const k of sortedKeys) data += k + (params[k] ?? '');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// WAHA doesn't sign requests by default. Gate the endpoint with a shared
// secret in a header so a public URL isn't immediately abusable. Set
// WAHA_WEBHOOK_SECRET in env; reject all requests without a matching header.
function verifyWahaSecret(req: Request): boolean {
  const expected = env('WAHA_WEBHOOK_SECRET');
  if (!expected || expected.length < 16) return false;
  const provided = req.get('x-waha-webhook-secret') || '';
  if (!provided) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Phone normalization for matching inbound senders against
// service_contacts.whatsapp. Mirrors lib/whatsapp.ts's normalizeDigits
// but lives here too so this file doesn't have a runtime dep on whatsapp.ts.
function normalizeDigits(raw: string): string | null {
  const withoutPrefix = raw.trim().replace(/^whatsapp:/, '').replace(/@c\.us$/, '');
  const digits = withoutPrefix.replace(/\D/g, '');
  if (!digits) return null;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) return `55${digits}`;
  return digits;
}

interface MatchResult {
  dispatch_id: number;
  ticket_id: number;
  condominium_id: number;
  vendor_id: number;
  vendor_name: string;
}

// Find the most recent in-flight dispatch whose vendor's whatsapp number
// (normalized to digits) matches the inbound sender. Restrict to dispatches
// that are still queued/sent (not already responded or cancelled) so a late
// reply doesn't clobber a more recent dispatch to the same vendor.
function findOpenDispatchByVendorPhone(fromDigits: string): MatchResult | null {
  const rows = db.prepare(
    `SELECT d.id AS dispatch_id, d.ticket_id, t.condominium_id, sc.id AS vendor_id, sc.company_name AS vendor_name, sc.whatsapp
     FROM ticket_dispatches d
     JOIN service_contacts sc ON sc.id = d.service_contact_id
     JOIN tickets t ON t.id = d.ticket_id
     WHERE d.status IN ('queued', 'sent')
       AND d.channel = 'whatsapp'
     ORDER BY d.created_at DESC
     LIMIT 100`
  ).all() as Array<{ dispatch_id: number; ticket_id: number; condominium_id: number; vendor_id: number; vendor_name: string; whatsapp: string | null }>;
  for (const row of rows) {
    if (!row.whatsapp) continue;
    const vendorDigits = normalizeDigits(row.whatsapp);
    if (!vendorDigits) continue;
    // Match either direction — incoming may be a sub-/super-string of stored
    // (e.g., 11-digit vs 13-digit with country code) depending on the
    // provider. Prefer exact + length-tolerant variants.
    if (vendorDigits === fromDigits) return row;
    if (vendorDigits.endsWith(fromDigits) || fromDigits.endsWith(vendorDigits)) return row;
  }
  return null;
}

function applyResponse(match: MatchResult, body: string): void {
  const summary = body.trim().slice(0, 2_000);
  db.prepare(
    `UPDATE ticket_dispatches
     SET status = 'responded',
         responded_at = CURRENT_TIMESTAMP,
         response_summary = ?
     WHERE id = ?`
  ).run(summary, match.dispatch_id);
  db.prepare(
    `UPDATE tickets
     SET remediation_status = CASE WHEN remediation_status IN ('resolved','blocked_needs_admin') THEN remediation_status ELSE 'vendor_engaged' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(match.ticket_id);
}

// POST /api/webhooks/whatsapp-inbound — Twilio + WAHA both POST here.
// Twilio sends `From=whatsapp:+5511...`, `Body=...`; WAHA sends JSON, but
// when WAHA is the provider its hook is mounted at a separate path below.
router.post('/whatsapp-inbound', (req: Request, res: Response) => {
  const fullUrl = reconstructUrl(req, '/api/webhooks/whatsapp-inbound');
  const valid = verifyTwilioSignature(req, fullUrl);
  if (!valid) {
    // Don't reveal whether the signature header was missing vs wrong —
    // both look the same to the caller. Use a stable error code.
    return fail(res, 'invalid_signature', 401);
  }

  const from: string = (req.body?.From || '').toString();
  const bodyText: string = (req.body?.Body || '').toString();
  const fromDigits = normalizeDigits(from);
  if (!fromDigits) return fail(res, 'invalid_from', 400);

  const match = findOpenDispatchByVendorPhone(fromDigits);
  if (!match) {
    // Log so we can debug. The reply is intentionally ok (200) so Twilio
    // does not retry — there's nothing to mutate, but we don't want a
    // failure storm on stray inbound chats from random numbers.
    console.warn(`[webhook:whatsapp] unmatched inbound from ${fromDigits.slice(0, 4)}…: "${bodyText.slice(0, 80)}"`);
    return ok(res, { matched: false });
  }

  applyResponse(match, bodyText);
  audit(req as any, {
    action: 'ticket.dispatch_responded',
    target_type: 'ticket_dispatch',
    target_id: match.dispatch_id,
    condominium_id: match.condominium_id,
    metadata: { ticket_id: match.ticket_id, source: 'webhook_whatsapp', vendor_id: match.vendor_id, vendor_name: match.vendor_name },
  });
  return ok(res, { matched: true, dispatch_id: match.dispatch_id, ticket_id: match.ticket_id });
});

// POST /api/webhooks/waha-inbound — separate path because WAHA wraps the
// message in `{event, payload}` JSON and uses a shared-secret header rather
// than a signature. The express.json() at the app level parses this body.
router.post('/waha-inbound', express.json(), (req: Request, res: Response) => {
  if (!verifyWahaSecret(req)) return fail(res, 'invalid_signature', 401);
  const event = req.body?.event;
  // Only act on inbound message events; ignore status/ack/etc.
  if (event !== 'message' && event !== 'message.any') return ok(res, { matched: false, ignored: event || 'unknown' });
  const payload = req.body?.payload || {};
  const fromDigits = normalizeDigits(String(payload.from || ''));
  const bodyText = String(payload.body || '');
  if (!fromDigits) return fail(res, 'invalid_from', 400);

  const match = findOpenDispatchByVendorPhone(fromDigits);
  if (!match) {
    console.warn(`[webhook:waha] unmatched inbound from ${fromDigits.slice(0, 4)}…: "${bodyText.slice(0, 80)}"`);
    return ok(res, { matched: false });
  }
  applyResponse(match, bodyText);
  audit(req as any, {
    action: 'ticket.dispatch_responded',
    target_type: 'ticket_dispatch',
    target_id: match.dispatch_id,
    condominium_id: match.condominium_id,
    metadata: { ticket_id: match.ticket_id, source: 'webhook_waha', vendor_id: match.vendor_id, vendor_name: match.vendor_name },
  });
  return ok(res, { matched: true, dispatch_id: match.dispatch_id, ticket_id: match.ticket_id });
});

export default router;
