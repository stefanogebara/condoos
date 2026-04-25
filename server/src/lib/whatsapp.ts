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

function notConfiguredResult(): SendResult {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: 'provider_not_configured' };
  }
  return { ok: true, skipped: 'not_configured' };
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
  if (!accountSid || !authToken || !from) return notConfiguredResult();

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
  if (!baseUrl) return notConfiguredResult();

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
 * In dev/test (no creds), logs the payload and returns a safe skip. In
 * production, missing provider config is retryable so outbox rows survive a
 * temporary secret/config rollout issue.
 */
export async function sendText(to: string, body: string): Promise<SendResult> {
  const toWa = normalizeWhatsAppNumber(to);
  if (!toWa) return { ok: false, skipped: 'invalid_to' };

  const provider = configuredProvider();
  if (provider === 'none') {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[whatsapp:dev] → ${toWa}: ${body.slice(0, 120)}${body.length > 120 ? '…' : ''}`);
    }
    return notConfiguredResult();
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

  const ids = Array.from(new Set(userIds));
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, phone, whatsapp_opt_in
     FROM users
     WHERE id IN (${placeholders})`
  ).all(...ids) as Array<{ id: number; phone: string | null; whatsapp_opt_in: number }>;

  const provider = configuredProvider();
  const insert = db.prepare(
    `INSERT INTO notification_outbox
       (channel, provider, user_id, phone, body, status, last_error, next_attempt_at)
     VALUES ('whatsapp', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const queuedIds: number[] = [];
  for (const id of ids) {
    const row = rowById.get(id);
    const canSend = !!row?.phone && row.whatsapp_opt_in === 1;
    const status = canSend ? 'pending' : 'skipped';
    const reason = row ? 'missing_phone_or_opt_in' : 'unknown_user';
    const out = insert.run(provider, row?.id || null, row?.phone || null, body, status, canSend ? null : reason);
    if (canSend) queuedIds.push(Number(out.lastInsertRowid));
  }

  await processWhatsAppOutbox({ ids: queuedIds });

  if (queuedIds.length === 0) return { attempted: userIds.length, sent: 0, skipped: userIds.length };
  const finalRows = db.prepare(
    `SELECT status, COUNT(*) AS count
     FROM notification_outbox
     WHERE id IN (${queuedIds.map(() => '?').join(',')})
     GROUP BY status`
  ).all(...queuedIds) as Array<{ status: string; count: number }>;
  const counts = Object.fromEntries(finalRows.map((r) => [r.status, r.count])) as Record<string, number | undefined>;
  const sent = counts.sent || 0;
  return {
    attempted: userIds.length,
    sent,
    skipped: userIds.length - queuedIds.length + queuedIds.length - sent,
  };
}

interface ProcessOutboxOptions {
  ids?: number[];
  limit?: number;
}

function retryAt(attempts: number): string | null {
  if (attempts >= 3) return null;
  const delayMs = Math.min(60 * 60_000, 2 ** Math.max(0, attempts - 1) * 60_000);
  return new Date(Date.now() + delayMs).toISOString().slice(0, 19).replace('T', ' ');
}

export async function processWhatsAppOutbox(options: ProcessOutboxOptions = {}): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  const ids = options.ids || [];
  const rows = ids.length > 0
    ? db.prepare(
        `SELECT * FROM notification_outbox
         WHERE channel='whatsapp'
           AND id IN (${ids.map(() => '?').join(',')})
           AND status IN ('pending','failed')
           AND attempts < max_attempts`
      ).all(...ids) as any[]
    : db.prepare(
        `SELECT * FROM notification_outbox
         WHERE channel='whatsapp'
           AND status IN ('pending','failed')
           AND attempts < max_attempts
           AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
         ORDER BY created_at ASC
         LIMIT ?`
      ).all(options.limit || 25) as any[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    db.prepare(
      `UPDATE notification_outbox
       SET status='sending', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(row.id);

    const nextAttempt = row.attempts + 1;
    const result = row.phone
      ? await sendText(row.phone, row.body)
      : { ok: false, skipped: 'invalid_to' as const };

    if (result.ok && !result.skipped) {
      sent += 1;
      db.prepare(
        `UPDATE notification_outbox
         SET status='sent', provider_message_id=?, last_error=NULL, sent_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`
      ).run(result.sid || null, row.id);
      continue;
    }

    if (result.skipped) {
      skipped += 1;
      db.prepare(
        `UPDATE notification_outbox
         SET status='skipped', last_error=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`
      ).run(result.skipped, row.id);
      continue;
    }

    if (result.error === 'provider_not_configured') {
      failed += 1;
      db.prepare(
        `UPDATE notification_outbox
         SET status='pending', attempts=?, last_error=?, next_attempt_at=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`
      ).run(row.attempts, result.error, retryAt(1), row.id);
      continue;
    }

    failed += 1;
    db.prepare(
      `UPDATE notification_outbox
       SET status='failed', last_error=?, next_attempt_at=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(result.error || 'send_failed', retryAt(nextAttempt), row.id);
  }

  return { processed: rows.length, sent, failed, skipped };
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
