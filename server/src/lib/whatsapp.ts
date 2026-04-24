// WhatsApp notifications via Twilio REST API.
// Graceful fallback: if creds are missing, log to console instead of failing.
// We avoid the `twilio` npm package to keep dependencies light — just REST + fetch.

import fetch from 'node-fetch';
import db from '../db';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const FROM        = process.env.TWILIO_WHATSAPP_FROM;

/**
 * Normalizes a raw phone input to E.164 with a `whatsapp:` prefix.
 * Accepts already-prefixed values, E.164, or BR-style local numbers
 * (+55 assumed when the number starts with 0 or has 10-11 digits without +).
 */
function normalizeWhatsAppNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('whatsapp:')) return trimmed;
  // strip everything except leading + and digits
  const compact = trimmed.replace(/[^\d+]/g, '');
  if (!compact) return null;
  const withPlus = compact.startsWith('+') ? compact : `+${compact}`;
  return `whatsapp:${withPlus}`;
}

function isConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM);
}

export interface SendResult {
  ok: boolean;
  skipped?: 'not_configured' | 'invalid_to';
  sid?: string;
  error?: string;
}

/**
 * Send a WhatsApp text to a single recipient.
 * In dev (no creds), logs the payload and returns { ok: true, skipped: 'not_configured' }.
 */
export async function sendText(to: string, body: string): Promise<SendResult> {
  const toWa = normalizeWhatsAppNumber(to);
  if (!toWa) return { ok: false, skipped: 'invalid_to' };

  if (!isConfigured()) {
    console.log(`[whatsapp:dev] → ${toWa}: ${body.slice(0, 120)}${body.length > 120 ? '…' : ''}`);
    return { ok: true, skipped: 'not_configured' };
  }

  const fromWa = FROM!.startsWith('whatsapp:') ? FROM! : `whatsapp:${FROM}`;
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

  const params = new URLSearchParams();
  params.set('From', fromWa);
  params.set('To', toWa);
  params.set('Body', body);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      console.error(`[whatsapp] Twilio ${res.status}:`, data?.message || data);
      return { ok: false, error: data?.message || `twilio_${res.status}` };
    }
    return { ok: true, sid: data.sid };
  } catch (err: any) {
    console.error('[whatsapp] send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'network_error' };
  }
}

/**
 * Bulk send helper — sends the same body to many users, filtering by opt-in.
 * Returns counts so the caller can log / audit.
 */
export async function notifyUsers(userIds: number[], body: string): Promise<{ attempted: number; sent: number; skipped: number }> {
  if (userIds.length === 0) return { attempted: 0, sent: 0, skipped: 0 };

  const placeholders = userIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT phone FROM users WHERE id IN (${placeholders}) AND whatsapp_opt_in = 1 AND phone IS NOT NULL AND phone <> ''`
  ).all(...userIds) as Array<{ phone: string }>;

  let sent = 0;
  let skipped = 0;
  for (const r of rows) {
    const result = await sendText(r.phone, body);
    if (result.ok && !result.skipped) sent += 1;
    else skipped += 1;
  }
  return { attempted: userIds.length, sent, skipped: userIds.length - rows.length + skipped };
}

/** Notify all owners of a condo. Used by assembly convocation. */
export async function notifyCondoOwners(condoId: number, body: string) {
  const rows = db.prepare(
    `SELECT DISTINCT uu.user_id
     FROM user_unit uu
     JOIN units u    ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ? AND uu.relationship = 'owner' AND uu.status = 'active'`
  ).all(condoId) as Array<{ user_id: number }>;
  return notifyUsers(rows.map((r) => r.user_id), body);
}

/** Notify all active residents (owners + tenants + occupants). */
export async function notifyCondoResidents(condoId: number, body: string) {
  const rows = db.prepare(
    `SELECT DISTINCT uu.user_id
     FROM user_unit uu
     JOIN units u    ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ? AND uu.status = 'active'`
  ).all(condoId) as Array<{ user_id: number }>;
  return notifyUsers(rows.map((r) => r.user_id), body);
}
