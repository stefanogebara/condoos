import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { normalizeServiceContact, serviceContactSchema } from '../lib/service-contacts';
import { ticketCategoriesForVendor } from '../lib/category-aliases';
import { dispatchAgentInBackground } from './tickets';
import { processWhatsAppOutbox } from '../lib/whatsapp';

const router = Router();

const outreachSchema = z.object({
  message: z.string().min(1).max(4_000),
  channel: z.enum(['whatsapp', 'email']).optional(),
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

router.get('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  // Pilot-readiness — compute vendor reputation from ticket_dispatches and
  // attach it to every row. The picker uses these stats to rank vendors
  // (vendors that never reply drift below ones that do), and the admin-agent
  // prompt includes them so the model can recommend based on track record
  // rather than just category match. Stats are computed in a single CTE so
  // we don't N+1 the dispatch table per vendor.
  //
  // Counts only the rows the worker actually attempted to deliver — manual
  // dispatches don't contribute to response_rate. avg_response_seconds is
  // computed from the responded rows only; null when none.
  const rows = db.prepare(
    `WITH stats AS (
       SELECT service_contact_id,
              SUM(CASE WHEN channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'responded' AND channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS responded,
              AVG(CASE WHEN status = 'responded' AND responded_at IS NOT NULL
                       THEN (strftime('%s', responded_at) - strftime('%s', created_at))
                       ELSE NULL END) AS avg_response_seconds,
              MAX(CASE WHEN status = 'responded' THEN responded_at ELSE NULL END) AS last_response_at
       FROM ticket_dispatches
       GROUP BY service_contact_id
     )
     SELECT sc.*,
            COALESCE(stats.sent, 0)        AS dispatches_total,
            COALESCE(stats.responded, 0)   AS dispatches_responded,
            stats.avg_response_seconds     AS avg_response_seconds,
            stats.last_response_at         AS last_response_at_dispatch
     FROM service_contacts sc
     LEFT JOIN stats ON stats.service_contact_id = sc.id
     WHERE sc.condominium_id = ?
       AND (? = 1 OR sc.active = 1)
     ORDER BY sc.preferred DESC, sc.emergency_available DESC, sc.category, sc.company_name`
  ).all(condoId, includeInactive ? 1 : 0) as any[];
  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
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

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
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
router.post('/:id/outreach', requireAuth, requireRole('board_admin'), async (req: AuthedRequest, res) => {
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

router.delete('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
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
