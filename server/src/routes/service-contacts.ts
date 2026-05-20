import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, requireBoardCapability, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { normalizeServiceContact, serviceContactSchema } from '../lib/service-contacts';
import { listServiceContactsWithScorecards } from '../lib/vendor-scorecards';
import { ticketCategoriesForVendor } from '../lib/category-aliases';
import { dispatchAgentInBackground } from './tickets';
import { processWhatsAppOutbox, getWhatsAppHealth } from '../lib/whatsapp';

const router = Router();

const outreachSchema = z.object({
  message: z.string().min(1).max(4_000),
  channel: z.enum(['whatsapp', 'email']).optional(),
});

// Test-WhatsApp — the admin types a phone in the vendor form and clicks
// "Enviar teste" to verify (a) the WAHA session is live, (b) they have
// the right phone format, (c) the recipient is reachable, all without
// committing the contact yet. The message body is capped short and fixed
// to a recognisable test pattern so accidental clicks don't spam vendors.
const testWhatsAppSchema = z.object({
  phone: z.string().min(6).max(40),
  message: z.string().min(1).max(400).optional(),
});

// When a new vendor lands (or an existing one's category changes), look up
// every ticket in this condo that was stuck on remediation_status =
// 'blocked_needs_admin' / blocked_reason = 'no_vendor_in_category' and whose
// ticket category now matches the vendor's category (via the alias map).
// For each match: clear the block, flip the ticket back to 'verified' so
// the loop can re-trigger, and fire the AI agent in the background to
// refresh agent_plan against the new service network. Capped at 10 per
// vendor change so a single add can't fan out into a huge LLM bill.
function rewireBlockedTickets(
  condoId: number,
  vendorCategory: string,
  locale: string | undefined,
): { rewiredIds: number[] } {
  const ticketCats = ticketCategoriesForVendor(vendorCategory);
  if (ticketCats.length === 0) return { rewiredIds: [] };

  const placeholders = ticketCats.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id FROM tickets
     WHERE condominium_id = ?
       AND remediation_status = 'blocked_needs_admin'
       AND blocked_reason = 'no_vendor_in_category'
       AND category IN (${placeholders})
     ORDER BY
       CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
       created_at ASC
     LIMIT 10`
  ).all(condoId, ...ticketCats) as Array<{ id: number }>;
  if (rows.length === 0) return { rewiredIds: [] };

  const ids = rows.map((r) => r.id);
  // Unblock in one statement, then re-fire the agent per ticket. We reset
  // to 'verified' (not 'open') because the community already met the
  // confirmation threshold — we're just retrying the dispatch loop with a
  // bigger vendor pool.
  const inPlaceholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE tickets
     SET remediation_status = 'verified',
         blocked_reason = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${inPlaceholders})`
  ).run(...ids);
  for (const ticketId of ids) {
    dispatchAgentInBackground(ticketId, condoId, locale);
  }
  return { rewiredIds: ids };
}

// WhatsApp delivery health — live-session check (cached 60s). Surfaces
// which phone is doing the sending and whether the WAHA/Twilio session is
// actually reachable, so the admin doesn't trust a fake "Mensagem enviada"
// toast when the provider can't actually deliver. Cached so the UI can
// poll cheaply (every 30-60s) from a header pill.
router.get('/whatsapp/health', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), async (_req: AuthedRequest, res) => {
  const health = await getWhatsAppHealth();
  return ok(res, health);
});

// Test-message — send a tiny "this is a test" WhatsApp to an arbitrary
// phone so the admin can verify their WAHA session works AND that the
// number they're about to save is correctly formatted, BEFORE creating
// the vendor record. Body is fixed (override only allowed for translation)
// to prevent the endpoint becoming a generic "send WhatsApp to anyone"
// utility — that's a spam vector. Same outbox + immediate worker tick as
// real outreach; returns outbox_id for status polling.
router.post('/test-whatsapp', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), async (req: AuthedRequest, res) => {
  const parsed = testWhatsAppSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);

  // Normalise phone — strip non-digits, prepend + so providers parse it.
  const digits = parsed.data.phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 16) return fail(res, 'invalid_phone', 400);
  const phone = `+${digits}`;

  const message = (parsed.data.message || 'Mensagem de teste do CondoOS. Se você recebeu isto, a conexão WhatsApp está funcionando.').slice(0, 400);
  const provider = process.env.WHATSAPP_PROVIDER || 'twilio';

  const result = db.prepare(
    `INSERT INTO notification_outbox (channel, provider, phone, body, status, next_attempt_at)
     VALUES ('whatsapp', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
  ).run(provider, phone, message);
  const outboxId = Number(result.lastInsertRowid);

  audit(req, {
    action: 'whatsapp.test',
    target_type: 'notification_outbox',
    target_id: outboxId,
    condominium_id: condoId,
    metadata: { phone, message_preview: message.slice(0, 80) },
  });

  // Kick the worker right away so the admin sees a response fast.
  void processWhatsAppOutbox({ ids: [outboxId] }).catch((err) =>
    console.warn('[whatsapp.test] delivery failed:', err?.message || err)
  );

  return ok(res, { outbox_id: outboxId, phone, provider }, 201);
});

// Outbox row state — for polling a single send after firing it from the
// outreach modal. Returns the same fields the worker writes; UI polls
// every 2s after send to evolve "queued → sent / failed" honestly instead
// of fake-success on HTTP 201. Admin-scoped to its own condo's outbox
// rows (we don't expose other condos' rows).
router.get('/outbox/:id', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  // Outbox rows don't have a condominium_id column directly, so scope
  // via the service contact / user_id they were created for. We allow
  // any board_admin in the condo to read the status of any outbox row
  // whose recipient phone matches one of their active service_contacts
  // (this is the only path the admin's outreach modal creates rows).
  const row = db.prepare(
    `SELECT o.id, o.channel, o.provider, o.phone, o.status, o.sent_at,
            o.last_error, o.attempts, o.created_at
     FROM notification_outbox o
     WHERE o.id = ?
       AND (
         o.user_id IS NULL  -- outreach rows have no user; ticket-dispatch ones do
         OR EXISTS (
           SELECT 1 FROM user_unit uu
           JOIN units u ON u.id = uu.unit_id
           JOIN buildings b ON b.id = u.building_id
           WHERE uu.user_id = o.user_id AND b.condominium_id = ?
         )
       )`
  ).get(id, condoId) as any;
  if (!row) return fail(res, 'not_found', 404);
  return ok(res, row);
});

router.get('/', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  const rows = listServiceContactsWithScorecards(condoId, includeInactive);
  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), (req: AuthedRequest, res) => {
  const parsed = serviceContactSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = normalizeServiceContact(parsed.data);
  const result = db.prepare(
    `INSERT INTO service_contacts (
      condominium_id, category, company_name, contact_name, phone, whatsapp, email,
      website, address, service_scope, notes, contract_url, emergency_available,
      preferred, active, last_used_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    condoId,
    body.category,
    body.company_name,
    body.contact_name,
    body.phone,
    body.whatsapp,
    body.email,
    body.website,
    body.address,
    body.service_scope,
    body.notes,
    body.contract_url,
    body.emergency_available ? 1 : 0,
    body.preferred ? 1 : 0,
    body.active ? 1 : 0,
    body.last_used_at,
    req.user!.id,
  );
  const id = Number(result.lastInsertRowid);
  // Auto-adjust — new vendor may match tickets that were previously stuck
  // on no_vendor_in_category. Unblock them and re-fire the AI agent so the
  // plan can recommend this newcomer.
  const locale = typeof req.body?.locale === 'string' ? req.body.locale : '';
  const rewired = body.active
    ? rewireBlockedTickets(condoId, body.category, locale)
    : { rewiredIds: [] };
  audit(req, {
    action: 'service_contact.create',
    target_type: 'service_contact',
    target_id: id,
    condominium_id: condoId,
    metadata: {
      category: body.category,
      preferred: body.preferred,
      emergency_available: body.emergency_available,
      rewired_ticket_ids: rewired.rewiredIds,
    },
  });
  return ok(res, { id, rewired_ticket_ids: rewired.rewiredIds }, 201);
});

router.patch('/:id', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), (req: AuthedRequest, res) => {
  const parsed = serviceContactSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const existing = db.prepare(
    `SELECT id, category, active FROM service_contacts WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId) as { id: number; category: string; active: number } | undefined;
  if (!existing) return fail(res, 'not_found', 404);

  const body = normalizeServiceContact(parsed.data);
  db.prepare(
    `UPDATE service_contacts
     SET category = ?, company_name = ?, contact_name = ?, phone = ?, whatsapp = ?,
         email = ?, website = ?, address = ?, service_scope = ?, notes = ?,
         contract_url = ?, emergency_available = ?, preferred = ?, active = ?,
         last_used_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND condominium_id = ?`
  ).run(
    body.category,
    body.company_name,
    body.contact_name,
    body.phone,
    body.whatsapp,
    body.email,
    body.website,
    body.address,
    body.service_scope,
    body.notes,
    body.contract_url,
    body.emergency_available ? 1 : 0,
    body.preferred ? 1 : 0,
    body.active ? 1 : 0,
    body.last_used_at,
    id,
    condoId,
  );
  // Auto-adjust on category change or reactivation. A vendor moving from
  // 'cleaning' to 'plumbing', or coming back from inactive, can suddenly
  // serve previously-blocked tickets — same rewire path as POST.
  const categoryChanged = body.category !== existing.category;
  const becameActive = body.active && !existing.active;
  const locale = typeof req.body?.locale === 'string' ? req.body.locale : '';
  const rewired = (body.active && (categoryChanged || becameActive))
    ? rewireBlockedTickets(condoId, body.category, locale)
    : { rewiredIds: [] };
  audit(req, {
    action: 'service_contact.update',
    target_type: 'service_contact',
    target_id: id,
    condominium_id: condoId,
    metadata: {
      category: body.category,
      active: body.active,
      rewired_ticket_ids: rewired.rewiredIds,
    },
  });
  return ok(res, { id, rewired_ticket_ids: rewired.rewiredIds });
});

// Send a one-off outreach message to a saved vendor without going through
// the ticket-dispatch flow. Used by the admin AI agent workbench when the
// síndico has a non-ticket question (research, scheduling, general inquiry)
// and just wants to reach a known vendor with a pre-drafted message. The
// auto-dispatch path on tickets has its own /dispatch endpoint that also
// records a ticket_dispatch row; this one is intentionally lightweight —
// no ticket context, just an outbox row + audit entry + an immediate
// processWhatsAppOutbox tick so the message actually leaves.
router.post('/:id/outreach', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), async (req: AuthedRequest, res) => {
  const parsed = outreachSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);

  const vendor = db.prepare(
    `SELECT id, company_name, phone, whatsapp, email FROM service_contacts
     WHERE id = ? AND condominium_id = ? AND active = 1`
  ).get(id, condoId) as { id: number; company_name: string; phone: string | null; whatsapp: string | null; email: string | null } | undefined;
  if (!vendor) return fail(res, 'not_found', 404);

  // Channel resolution: explicit > whatsapp if vendor has it > email > 400.
  // The agent's outreach_message is generic, so WhatsApp wins for
  // immediacy when available.
  const channel = parsed.data.channel
    || (vendor.whatsapp ? 'whatsapp' : vendor.email ? 'email' : null);
  if (!channel) return fail(res, 'no_reachable_channel', 400);
  if (channel === 'whatsapp' && !vendor.whatsapp) return fail(res, 'vendor_has_no_whatsapp', 400);
  if (channel === 'email' && !vendor.email) return fail(res, 'vendor_has_no_email', 400);

  const message = parsed.data.message.slice(0, 4_000);
  const provider = channel === 'whatsapp'
    ? (process.env.WHATSAPP_PROVIDER || 'twilio')
    : (process.env.EMAIL_PROVIDER || 'resend');

  const result = channel === 'whatsapp'
    ? db.prepare(
        `INSERT INTO notification_outbox (channel, provider, phone, body, status, next_attempt_at)
         VALUES ('whatsapp', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
      ).run(provider, vendor.whatsapp, message)
    : db.prepare(
        `INSERT INTO notification_outbox (channel, provider, email, body, status, next_attempt_at)
         VALUES ('email', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
      ).run(provider, vendor.email, message);
  const outboxId = Number(result.lastInsertRowid);

  // Stamp last_used_at so future agent runs rank this vendor higher in the
  // "recently engaged" tiebreak. Same write the ticket /dispatch path does.
  db.prepare(`UPDATE service_contacts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(vendor.id);

  audit(req, {
    action: 'service_contact.outreach',
    target_type: 'service_contact',
    target_id: vendor.id,
    condominium_id: condoId,
    metadata: { channel, outbox_id: outboxId, message_preview: message.slice(0, 160) },
  });

  // Fire-and-forget delivery so the HTTP response doesn't block on Twilio /
  // Resend round-trips. processWhatsAppOutbox handles both channels despite
  // the name (covers email through the same outbox table).
  if (channel === 'whatsapp') {
    void processWhatsAppOutbox({ ids: [outboxId] }).catch((err) =>
      console.warn('[service-contact.outreach] delivery failed:', err?.message || err)
    );
  }

  return ok(res, {
    outbox_id: outboxId,
    channel,
    vendor: { id: vendor.id, company_name: vendor.company_name },
  }, 201);
});

router.delete('/:id', requireAuth, requireRole('board_admin'), requireBoardCapability('maintenance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const exists = db.prepare(
    `SELECT id FROM service_contacts WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId);
  if (!exists) return fail(res, 'not_found', 404);
  db.prepare(
    `UPDATE service_contacts SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND condominium_id = ?`
  ).run(id, condoId);
  audit(req, {
    action: 'service_contact.deactivate',
    target_type: 'service_contact',
    target_id: id,
    condominium_id: condoId,
  });
  return ok(res, { id });
});

export default router;
