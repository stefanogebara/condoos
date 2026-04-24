// WhatsApp notifications via Twilio REST API.
// Graceful fallback: if creds are missing, log to console instead of failing.
// We avoid the `twilio` npm package to keep dependencies light — just REST + fetch.

import fetch from 'node-fetch';
import db from '../db';

type WhatsAppProvider = 'twilio' | 'waha' | 'none';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function configuredProvider(): WhatsAppProvider {
  const explicit = env('WHATSAPP_PROVIDER')?.toLowerCase();
  if (explicit === 'twilio' || explicit === 'waha' || explicit === 'none') return explicit;
  if (env('WAHA_URL')) return 'waha';
  if (env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_WHATSAPP_FROM')) return 'twilio';
  return 'none';
}

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

function normalizeDigits(raw: string): string | null {
  const withoutPrefix = raw.trim().replace(/^whatsapp:/, '').replace(/@c\.us$/, '');
  const digits = withoutPrefix.replace(/\D/g, '');
  if (!digits) return null;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) return `55${digits}`;
  return digits;
}

/** Public diagnostic — safe to expose (returns only booleans + masked from-number). */
export function getWhatsAppStatus() {
  const provider = configuredProvider();
  const from = provider === 'twilio'
    ? env('TWILIO_WHATSAPP_FROM') || null
    : provider === 'waha'
      ? env('WAHA_SESSION') || 'default'
      : null;
  // Mask the middle of the phone number so we never leak full credentials.
  const maskedFrom = from && from.length >= 7
    ? `${from.slice(0, 6)}…${from.slice(-2)}`
    : from;
  return {
    configured: provider !== 'none',
    provider,
    from: maskedFrom,
  };
}

export interface SendResult {
  ok: boolean;
  skipped?: 'not_configured' | 'invalid_to';
  sid?: string;
  error?: string;
}

async function sendViaTwilio(toWa: string, body: string): Promise<SendResult> {
  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');
  const from = env('TWILIO_WHATSAPP_FROM');
  if (!accountSid || !authToken || !from) return { ok: true, skipped: 'not_configured' };

  const fromWa = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const params = new URLSearchParams();
  params.set('From', fromWa);
  params.set('To', toWa);
  params.set('Body', body);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
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
    console.error('[whatsapp] Twilio send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'network_error' };
  }
}

async function sendViaWaha(to: string, body: string): Promise<SendResult> {
  const baseUrl = env('WAHA_URL')?.replace(/\/+$/, '');
  if (!baseUrl) return { ok: true, skipped: 'not_configured' };

  const digits = normalizeDigits(to);
  if (!digits) return { ok: false, skipped: 'invalid_to' };

  const session = env('WAHA_SESSION') || 'default';
  const apiKey = env('WAHA_API_KEY') || env('WHATSAPP_API_KEY');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;

  try {
    const res = await fetch(`${baseUrl}/sendText`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session,
        chatId: `${digits}@c.us`,
        text: body,
      }),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      console.error(`[whatsapp] WAHA ${res.status}:`, data?.message || data);
      return { ok: false, error: data?.message || `waha_${res.status}` };
    }
    return { ok: true, sid: data?.id?._serialized || data?.id || data?.key?.id || undefined };
  } catch (err: any) {
    console.error('[whatsapp] WAHA send failed:', err?.message || err);
    return { ok: false, error: err?.message || 'network_error' };
  }
}

/**
 * Send a WhatsApp text to a single recipient.
 * In dev (no creds), logs the payload and returns { ok: true, skipped: 'not_configured' }.
 */
export async function sendText(to: string, body: string): Promise<SendResult> {
  const toWa = normalizeWhatsAppNumber(to);
  if (!toWa) return { ok: false, skipped: 'invalid_to' };

  const provider = configuredProvider();
  if (provider === 'none') {
    console.log(`[whatsapp:dev] → ${toWa}: ${body.slice(0, 120)}${body.length > 120 ? '…' : ''}`);
    return { ok: true, skipped: 'not_configured' };
  }
  if (provider === 'waha') return sendViaWaha(toWa, body);
  return sendViaTwilio(toWa, body);
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
