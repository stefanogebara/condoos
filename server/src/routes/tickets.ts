import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { audit } from '../lib/audit';
import { canAssignTicketToUser, markTicketAgentFailed } from '../lib/tickets';
import { categoryMatches } from '../lib/category-aliases';
import { buildVendorPortalUrl } from '../lib/vendor-tokens';
import { evaluateAgentAutoDispatch, isSafetyCriticalUrgent } from '../lib/agent-auto-dispatch';
import { runAdminAgent } from '../ai/admin-agent-runner';
import { notifyUsers } from '../lib/whatsapp';
import { assertFileReadyForUse, attachFileToTarget, fileDownloadPath } from '../lib/files';

const router = Router();

// Phase 3 — severity fast-track. When the report combines high/urgent priority
// with a safety-critical category, override the verification_threshold down to
// 1 so a single neighbour can confirm a gas leak / fire / elevator entrapment
// without waiting for the 3-confirms default. Anything in this set also gets
// the agent fired without further admin confirmation.
const SAFETY_CRITICAL_CATEGORIES = new Set([
  'elevator',
  'fire_safety',
  'gas',
  'gas_leak',
  'water',
  'water_damage',
  'security',
]);

function isFastTrackCategory(category: string, priority: string): boolean {
  return SAFETY_CRITICAL_CATEGORIES.has(category) && (priority === 'urgent' || priority === 'high');
}

// Incident Loop Phase 1 — when `verification_threshold > 0` the ticket is
// "community-visible": every member of the condo can read it and vote
// confirm/deny. Hitting the threshold flips remediation_status to 'verified'
// which is the trigger an admin uses to dispatch the AI agent (Phase 2 will
// fire this automatically). Default 0 preserves the legacy private-ticket
// behaviour for any caller that doesn't opt in.
const ticketCreateSchema = z.object({
  unit_id: z.number().int().positive().optional(),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(4_000),
  category: z.string().min(1).max(60).default('maintenance'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  verification_threshold: z.number().int().min(0).max(50).optional().default(0),
});

const verifyVoteSchema = z.object({
  vote: z.enum(['confirm', 'deny']),
  comment: z.string().max(500).optional(),
});

const dispatchSchema = z.object({
  service_contact_id: z.number().int().positive().optional(),
  channel: z.enum(['whatsapp', 'email', 'manual']).optional(),
  message: z.string().min(1).max(4_000).optional(),
});

const markRespondedSchema = z.object({
  response_summary: z.string().min(1).max(2_000),
});

const resolveSchema = z.object({
  // Short note from the admin describing what was done. We use it as the
  // body for the auto-generated announcement so the rest of the condo sees
  // closure on the problem they reported.
  resolution: z.string().min(1).max(2_000),
  // Announce the resolution to the whole condo? Default true for community
  // tickets, false for private ones — the route falls back if absent.
  announce: z.boolean().optional(),
});

const workOrderStatusSchema = z.enum(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']);

const nullableHttpsUrlSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().url().max(1_000).refine(
    (u) => u.startsWith('https://'),
    { message: 'must_be_https_url' },
  ).nullable().optional(),
);

const workOrderCreateSchema = z.object({
  service_contact_id: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(160).optional(),
  scope: z.string().max(4_000).nullable().optional(),
  status: workOrderStatusSchema.optional().default('scheduled'),
  estimated_amount_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  approved_amount_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  scheduled_for: z.string().max(80).nullable().optional(),
  invoice_url: nullableHttpsUrlSchema,
  photo_url: nullableHttpsUrlSchema,
  completion_note: z.string().max(2_000).nullable().optional(),
});

const workOrderUpdateSchema = workOrderCreateSchema.partial();

// Phase 2 — fire-and-forget agent invocation triggered the moment a ticket
// flips to remediation_status='verified'. We can't block the verify HTTP
// response on a 5-15s LLM call, so the agent runs in the background and
// updates the ticket row when it lands. Failures are escalated into the same
// admin-attention state used for missing vendors, so no verified ticket sits
// silently without a plan.
// How long to wait before sending an auto-dispatched message. The admin
// gets a "scheduled in 5 min — cancel" banner. Urgent + safety-critical
// tickets skip this entirely (send_after = null, worker fires on next
// tick) because every minute matters for elevator entrapment / gas leak /
// fire alarm scenarios.
const AUTO_DISPATCH_VETO_SECONDS = 300;

function shouldSkipVetoWindow(priority: string, category: string): boolean {
  return isSafetyCriticalUrgent(priority, category);
}

export function dispatchAgentInBackground(
  ticketId: number,
  condoId: number,
  locale: string | undefined,
  // Audit-trail completeness — when the agent run is triggered by a
  // verification, we know who triggered it. Threading the id lets the
  // agent_runs row attribute the run to the verifier instead of leaving
  // admin_user_id null on the auto-dispatch path.
  triggeredByUserId?: number,
): void {
  void (async () => {
    try {
      const ticket = db.prepare(
        `SELECT title, description, priority, category FROM tickets WHERE id = ? AND condominium_id = ?`
      ).get(ticketId, condoId) as { title: string; description: string; priority: string; category: string } | undefined;
      if (!ticket) return;

      const result = await runAdminAgent({
        condoId,
        locale: locale || '',
        task: `${ticket.title}\n\n${ticket.description}`,
        mode: ticket.priority === 'urgent' ? 'repair' : 'general',
        ticketId,
        adminUserId: triggeredByUserId,
      });

      // If the model can't find any matching vendor in the condo's saved
      // service network, mark the ticket as needing admin attention rather
      // than leaving it stuck in agent_dispatched. The blocked_reason gives
      // the UI banner a stable code to render.
      const networkHits = Array.isArray(result.plan?.existing_network_fit)
        ? result.plan.existing_network_fit.length
        : 0;
      const categoryRows = db.prepare(
        `SELECT category FROM service_contacts WHERE condominium_id = ? AND active = 1`
      ).all(condoId) as Array<{ category: string }>;
      const categoryMatch = categoryRows.some((row) => categoryMatches(ticket.category, row.category));
      const blocked = networkHits === 0 && !categoryMatch;

      db.prepare(
        `UPDATE tickets
         SET agent_plan = ?,
             agent_run_at = CURRENT_TIMESTAMP,
             remediation_status = CASE
               WHEN ? = 1 THEN 'blocked_needs_admin'
               WHEN remediation_status IN ('open','verified') THEN 'agent_dispatched'
               ELSE remediation_status
             END,
             blocked_reason = CASE WHEN ? = 1 THEN 'no_vendor_in_category' ELSE blocked_reason END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(JSON.stringify(result.plan), blocked ? 1 : 0, blocked ? 1 : 0, ticketId);

      // === Auto-dispatch with veto window ===
      // Gating conditions (ALL must hold) so we don't auto-send the wrong
      // thing the wrong way to the wrong vendor. The bar is intentionally
      // high — when in doubt, leave it as 'agent_dispatched' and let the
      // admin click the existing dispatch button.
      //
      //   1. Plan named a vendor in our network (existing_network_fit[0]).
      //   2. That vendor has a whatsapp number we can actually reach.
      //   3. Vendor's category matches (or is alias-compatible with) the
      //      ticket's category — guards against the model picking the
      //      wrong saved vendor.
      //   4. Not blocked from the categoryMatch check above.
      //   5. No existing dispatch on this ticket yet — re-runs of the
      //      agent (vendor-add auto-rewire) shouldn't double-dispatch.
      if (blocked) return;
      const topFit = result.plan?.existing_network_fit?.[0];
      if (!topFit?.company_name) return;
      const vendor = db.prepare(
        `SELECT id, company_name, category, whatsapp, email, contact_name
         FROM service_contacts
         WHERE condominium_id = ? AND active = 1 AND company_name = ?`
      ).get(condoId, topFit.company_name) as
        | { id: number; company_name: string; category: string; whatsapp: string | null; email: string | null; contact_name: string | null }
        | undefined;
      if (!vendor || !vendor.whatsapp) return;

      const existingDispatch = db.prepare(
        `SELECT id FROM ticket_dispatches WHERE ticket_id = ? AND status NOT IN ('cancelled','failed') LIMIT 1`
      ).get(ticketId);
      if (existingDispatch) return;

      // Hard auto-dispatch gate. Model confidence alone is not enough:
      // non-urgent tickets require server-visible evidence from building
      // memory AND reliable vendor cost history. Urgent safety incidents
      // can bypass that evidence gate, but still require category-compatible
      // saved vendors so we do not message the wrong provider.
      const gate = evaluateAgentAutoDispatch({
        ticketPriority: ticket.priority,
        ticketCategory: ticket.category,
        vendorCategory: vendor.category,
        plan: result.plan,
        topFit,
      });
      if (!gate.allowed) {
        console.log(`[tickets:${ticketId}] auto-dispatch held: ${gate.reason}`);
        return;
      }

      // Pick the outreach message: prefer the model's WhatsApp-native
      // one-liner (the new prompt enforces this shape); fall back to a
      // short default if it's missing or unusually long.
      const rawOutreach = String(result.plan?.vendor_search_plan?.outreach_message || '').trim();
      const baseMessage = (rawOutreach && rawOutreach.length <= 600 ? rawOutreach :
        `Oi, ${vendor.contact_name || ''}! ${ticket.title}. Pode atender hoje?`).slice(0, 3_500);

      const skipVeto = shouldSkipVetoWindow(ticket.priority, ticket.category);
      const sendAfter = skipVeto
        ? null  // worker fires immediately on next tick
        : new Date(Date.now() + AUTO_DISPATCH_VETO_SECONDS * 1000).toISOString().replace('T', ' ').slice(0, 19);

      // Create the dispatch row FIRST so we have an id to sign the
      // vendor portal token against. message_body is the base text;
      // we update it with the appended link once the token is built.
      const dispatch = db.prepare(
        `INSERT INTO ticket_dispatches
           (ticket_id, service_contact_id, channel, outbox_id, message_body, status, scheduled_send_after)
         VALUES (?, ?, 'whatsapp', NULL, ?, 'queued', ?)`
      ).run(ticketId, vendor.id, baseMessage, sendAfter);
      const dispatchId = Number(dispatch.lastInsertRowid);

      // Build the magic-link URL + the final message body the vendor
      // will receive. The link lets them respond directly via a tiny
      // server-rendered form (no admin transcription needed). Falls
      // back to base message if token signing fails for some reason.
      let finalMessage = baseMessage;
      try {
        const portalUrl = buildVendorPortalUrl(dispatchId);
        finalMessage = `${baseMessage}\n\nResponder: ${portalUrl}`.slice(0, 4_000);
      } catch (err) {
        console.warn(`[tickets:${ticketId}] vendor link sign failed:`, (err as Error)?.message || err);
      }

      const provider = process.env.WHATSAPP_PROVIDER || 'twilio';
      // Outbox row — when sendAfter is set, the worker only picks this up
      // once next_attempt_at <= now, giving the veto window time to elapse.
      const outbox = db.prepare(
        `INSERT INTO notification_outbox (channel, provider, phone, body, status, next_attempt_at)
         VALUES ('whatsapp', ?, ?, ?, 'pending', ?)`
      ).run(provider, vendor.whatsapp, finalMessage, sendAfter || new Date().toISOString().replace('T', ' ').slice(0, 19));
      const outboxId = Number(outbox.lastInsertRowid);

      // Backfill dispatch with the outbox link + the final message body.
      db.prepare(
        `UPDATE ticket_dispatches SET outbox_id = ?, message_body = ? WHERE id = ?`
      ).run(outboxId, finalMessage, dispatchId);

      db.prepare(
        `UPDATE tickets
         SET remediation_status = 'awaiting_vendor', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(ticketId);
      // Stamp last_used_at so the next agent run weights this vendor higher.
      db.prepare(`UPDATE service_contacts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(vendor.id);

      console.log(`[tickets:${ticketId}] auto-dispatched to ${vendor.company_name} ${skipVeto ? '(no veto — urgent safety)' : `(veto window ${AUTO_DISPATCH_VETO_SECONDS}s)`}, dispatch #${dispatchId}`);
    } catch (err) {
      markTicketAgentFailed(ticketId);
      console.warn(`[tickets:${ticketId}] background agent failed:`, (err as Error)?.message || err);
    }
  })();
}

const ticketUpdateSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().min(1).max(4_000).optional(),
  category: z.string().min(1).max(60).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  assigned_to_user_id: z.number().int().positive().nullable().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(4_000),
  internal: z.boolean().optional().default(false),
});

const attachmentSchema = z.object({
  // Audit M1 — block file:/javascript:/internal-IP URLs from being stored as
  // ticket attachment URLs. Same rationale as receipt_url and contract_url.
  url: z.string().url().max(1_000).refine(
    (u) => u.startsWith('https://'),
    { message: 'must_be_https_url' },
  ).optional().nullable(),
  file_id: z.number().int().positive().optional().nullable(),
  filename: z.string().max(240).optional(),
  content_type: z.string().max(120).optional(),
}).refine((body) => !!body.file_id || !!body.url, {
  message: 'attachment_required',
  path: ['url'],
});

function unitInCondo(unitId: number, condoId: number): boolean {
  return !!db.prepare(
    `SELECT 1
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE u.id = ? AND b.condominium_id = ?`
  ).get(unitId, condoId);
}

function getScopedTicket(id: number, condoId: number) {
  return db.prepare(
    `SELECT * FROM tickets WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId) as any;
}

function getTicketWorkOrder(ticketId: number) {
  return db.prepare(
    `SELECT wo.*,
            sc.company_name AS vendor_name,
            sc.category AS vendor_category,
            sc.contact_name AS vendor_contact
     FROM ticket_work_orders wo
     LEFT JOIN service_contacts sc ON sc.id = wo.service_contact_id
     WHERE wo.ticket_id = ?`
  ).get(ticketId) as any;
}

function ensureVendorInCondo(serviceContactId: number | null | undefined, condoId: number): boolean {
  if (!serviceContactId) return true;
  return !!db.prepare(
    `SELECT 1 FROM service_contacts WHERE id = ? AND condominium_id = ? AND active = 1`
  ).get(serviceContactId, condoId);
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function sqlNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function syncTicketFromWorkOrder(ticketId: number, status: z.infer<typeof workOrderStatusSchema>) {
  if (status === 'completed') {
    db.prepare(
      `UPDATE tickets
       SET status = 'resolved',
           remediation_status = 'resolved',
           resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(ticketId);
    return;
  }
  const next = status === 'in_progress'
    ? { status: 'in_progress', remediation: 'work_in_progress' }
    : status === 'scheduled'
      ? { status: 'waiting', remediation: 'work_ordered' }
      : status === 'draft'
        ? { status: 'waiting', remediation: 'vendor_engaged' }
        : null;
  if (!next) return;
  db.prepare(
    `UPDATE tickets
     SET status = ?,
         remediation_status = CASE WHEN remediation_status = 'resolved' THEN remediation_status ELSE ? END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(next.status, next.remediation, ticketId);
}

function canSeeTicket(req: AuthedRequest, ticket: any): boolean {
  if (req.user!.role === 'board_admin') return true;
  if (ticket.reporter_id === req.user!.id) return true;
  // Community-visible tickets: anyone in the condo (already enforced via
  // condominium_id in the query) can read & verify them.
  return Number(ticket.verification_threshold) > 0;
}

// Admin inbox summary — counts the tickets that want the admin's attention,
// broken down by reason. Cheap aggregate query; the sidebar polls this every
// 30s to drive the "Chamados" badge without re-fetching the full list.
// Public to any board_admin in the condo; private/empty for residents (a
// resident hitting this gets zeros).
router.get('/summary', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  if (req.user!.role !== 'board_admin') {
    return ok(res, { needs_admin: 0, blocked_no_vendor: 0, blocked_no_response: 0, verified_ready: 0, awaiting_verification: 0 });
  }
  const row = db.prepare(
    `SELECT
       SUM(CASE WHEN remediation_status = 'blocked_needs_admin' THEN 1 ELSE 0 END)                          AS needs_admin,
       SUM(CASE WHEN remediation_status = 'blocked_needs_admin' AND blocked_reason = 'no_vendor_in_category' THEN 1 ELSE 0 END) AS blocked_no_vendor,
       SUM(CASE WHEN remediation_status = 'blocked_needs_admin' AND blocked_reason = 'vendor_no_response'    THEN 1 ELSE 0 END) AS blocked_no_response,
       SUM(CASE WHEN remediation_status IN ('verified','agent_dispatched') THEN 1 ELSE 0 END)                AS verified_ready,
       SUM(CASE WHEN verification_threshold > 0 AND remediation_status = 'open' THEN 1 ELSE 0 END)           AS awaiting_verification
     FROM tickets
     WHERE condominium_id = ?`
  ).get(condoId) as any;
  return ok(res, {
    needs_admin:           Number(row?.needs_admin || 0),
    blocked_no_vendor:     Number(row?.blocked_no_vendor || 0),
    blocked_no_response:   Number(row?.blocked_no_response || 0),
    verified_ready:        Number(row?.verified_ready || 0),
    awaiting_verification: Number(row?.awaiting_verification || 0),
  });
});

// Recent auto-actions feed — surfaces what the agent has been doing on
// the admin's behalf since the last visit. Powers the "Agente em ação"
// strip on /board overview so the auto-dispatch path doesn't stay
// invisible behind the tickets page. Returns the 5 most-recent events
// across (verified, agent_dispatched, awaiting_vendor → vendor_engaged,
// blocked, resolved) for the active condo. Residents get an empty list.
router.get('/recent-auto-actions', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  if (req.user!.role !== 'board_admin') return ok(res, []);
  // We synthesise the event type from whichever timestamp is most recent
  // on the ticket. updated_at is the master clock; pairing with the
  // matching state field tells us which step fired last. Cap at 5 — this
  // is a glance widget, not a log viewer.
  const rows = db.prepare(
    `SELECT id, title, priority, remediation_status, blocked_reason,
            verified_at, agent_run_at, resolved_at, updated_at
     FROM tickets
     WHERE condominium_id = ?
       AND (agent_run_at IS NOT NULL OR resolved_at IS NOT NULL OR verified_at IS NOT NULL)
     ORDER BY updated_at DESC
     LIMIT 5`
  ).all(condoId) as Array<{
    id: number; title: string; priority: string;
    remediation_status: string; blocked_reason: string | null;
    verified_at: string | null; agent_run_at: string | null;
    resolved_at: string | null; updated_at: string;
  }>;
  return ok(res, rows);
});

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const clauses = ['t.condominium_id = ?'];
  const params: any[] = [condoId];
  if (req.user!.role !== 'board_admin') {
    // Residents see their own tickets PLUS every community-visible ticket
    // in the condo. Admins see everything.
    clauses.push('(t.reporter_id = ? OR t.verification_threshold > 0)');
    params.push(req.user!.id);
  }
  if (status) {
    clauses.push('t.status = ?');
    params.push(status);
  }
  // Audit follow-up — the previous payload only exposed `unit_number` joined
  // off `t.unit_id` (the unit the TICKET is about). Community reports rarely
  // set unit_id, so the resident byline rendered without any unit info. Add
  // `reporter_unit_number` joined off the reporter's primary active
  // user_unit row so the UI can show "Maya · 704 · 10/05/2026" reliably.
  const rows = db.prepare(
    `SELECT t.*, u.number AS unit_number, r.first_name AS reporter_first, r.last_name AS reporter_last,
            ru.number AS reporter_unit_number,
            a.first_name AS assignee_first, a.last_name AS assignee_last,
            wo.id AS work_order_id,
            wo.status AS work_order_status,
            wo.scheduled_for AS work_order_scheduled_for,
            wo.estimated_amount_cents AS work_order_estimated_amount_cents,
            wosc.company_name AS work_order_vendor_name
     FROM tickets t
     LEFT JOIN units u ON u.id = t.unit_id
     JOIN users r ON r.id = t.reporter_id
     LEFT JOIN user_unit ruu ON ruu.user_id = r.id AND ruu.status = 'active' AND ruu.primary_contact = 1
     LEFT JOIN units ru ON ru.id = ruu.unit_id
     LEFT JOIN users a ON a.id = t.assigned_to_user_id
     LEFT JOIN ticket_work_orders wo ON wo.ticket_id = t.id
     LEFT JOIN service_contacts wosc ON wosc.id = wo.service_contact_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
       t.updated_at DESC`
  ).all(...params) as any[];
  // Privacy gate: on community-visible tickets, a non-admin viewer used
  // to see the reporter's unit number — turning the community list into
  // a "who lives where" map. Strip unit + last_name from the reporter
  // byline unless the caller is the reporter themselves or an admin.
  const isAdmin = req.user!.role === 'board_admin';
  const callerId = req.user!.id;
  const safeRows = isAdmin ? rows : rows.map((r) => {
    const isOwn = r.reporter_id === callerId;
    if (isOwn || !r.community_visible) return r;
    return { ...r, reporter_last: null, reporter_unit_number: null };
  });
  return ok(res, safeRows);
});

router.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = ticketCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;
  if (body.unit_id && !unitInCondo(body.unit_id, condoId)) return fail(res, 'unit_not_in_condo', 400);
  if (req.user!.role !== 'board_admin' && body.unit_id) {
    const ownsUnit = !!db.prepare(
      `SELECT 1 FROM user_unit WHERE user_id = ? AND unit_id = ? AND status = 'active'`
    ).get(req.user!.id, body.unit_id);
    if (!ownsUnit) return fail(res, 'forbidden', 403);
  }

  // Phase 3 — severity fast-track. Urgent/high reports about elevator
  // entrapment, gas/water/fire emergencies, security door — pull the
  // verification_threshold down to 1 so one neighbour can confirm before
  // the agent fires. Otherwise: respect the caller's choice, defaulting
  // to the previous 0 / threshold passed by the client.
  const fastTrack = isFastTrackCategory(body.category, body.priority);
  const effectiveThreshold = fastTrack
    ? Math.max(1, Math.min(body.verification_threshold || 1, 1))
    : body.verification_threshold;

  // Round 3 follow-up — POST was non-idempotent. A double-click or a
  // network retry from the resident report form created duplicate tickets
  // (Playwright walks left ~10 "Lights in lobby" rows in prod). Dedupe
  // within a 60s window on (condo, reporter, title) using SQLite's own
  // datetime() so the comparison is timezone-format-safe — same pattern
  // used by POST /api/finance/expenses.
  const recent = db.prepare(
    `SELECT id FROM tickets
     WHERE condominium_id = ?
       AND reporter_id = ?
       AND title = ?
       AND datetime(created_at) >= datetime('now', '-60 seconds')
     LIMIT 1`
  ).get(condoId, req.user!.id, body.title) as { id: number } | undefined;
  if (recent) {
    audit(req, {
      action: 'ticket.create_deduped',
      target_type: 'ticket',
      target_id: recent.id,
      condominium_id: condoId,
      metadata: { title: body.title },
    });
    return ok(res, { id: recent.id, fast_track: fastTrack, verification_threshold: effectiveThreshold, deduped: true }, 200);
  }

  const result = db.prepare(
    `INSERT INTO tickets (condominium_id, unit_id, reporter_id, title, description, category, priority, verification_threshold)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(condoId, body.unit_id || null, req.user!.id, body.title, body.description, body.category, body.priority, effectiveThreshold);
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'ticket.create',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: {
      unit_id: body.unit_id || null,
      priority: body.priority,
      verification_threshold: effectiveThreshold,
      fast_track: fastTrack,
    },
  });

  // Phase 3 — when a community ticket lands, push a notification to every
  // other resident in the condo who opted in to WhatsApp. Phase 1+2 left
  // residents to come find the report on /app/tickets; this closes the
  // discovery loop. Skipped for private tickets and skipped when the
  // reporter is alone in the condo. notifyUsers does its own opt-in /
  // missing-phone filtering and runs the outbox synchronously after queue.
  if (effectiveThreshold > 0) {
    const peers = db.prepare(
      `SELECT DISTINCT uu.user_id
       FROM user_unit uu
       JOIN units un ON un.id = uu.unit_id
       JOIN buildings b ON b.id = un.building_id
       WHERE b.condominium_id = ? AND uu.status = 'active' AND uu.user_id <> ?`
    ).all(condoId, req.user!.id) as Array<{ user_id: number }>;
    const ids = peers.map((p) => p.user_id);
    if (ids.length > 0) {
      const msg = fastTrack
        ? `⚠️ URGENTE — ${body.title}. Confirma se você também notou. (ID #${id})`
        : `Novo problema reportado por vizinho: ${body.title}. Confirma se você também notou? (ID #${id})`;
      void notifyUsers(ids, msg).catch((err) => {
        console.warn(`[tickets:${id}] fanout failed:`, (err as Error)?.message || err);
      });
    }
  }

  return ok(res, { id, fast_track: fastTrack, verification_threshold: effectiveThreshold }, 201);
});

// Resident (or admin) records a confirm/deny vote on a community-visible
// ticket. Re-voting overwrites the previous vote (UNIQUE constraint on
// ticket_id + user_id). When confirm_count reaches verification_threshold
// the ticket flips to remediation_status='verified' and stamps verified_at.
// Admins implicitly verify with one vote regardless of threshold. On the
// verification flip we fire the AI agent in the background (Phase 2 —
// previously this required a manual "Generate plan" click from the admin).
router.post('/:id/verify', requireAuth, (req: AuthedRequest, res) => {
  const parsed = verifyVoteSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (ticket.verification_threshold <= 0) return fail(res, 'not_community_ticket', 400);
  if (ticket.remediation_status !== 'open') return fail(res, 'already_resolved', 409);
  const locale = typeof req.body?.locale === 'string' ? req.body.locale : '';

  const { vote, comment } = parsed.data;
  db.prepare(
    `INSERT INTO ticket_verifications (ticket_id, user_id, vote, comment) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticket_id, user_id) DO UPDATE SET vote = excluded.vote, comment = excluded.comment, created_at = CURRENT_TIMESTAMP`
  ).run(id, req.user!.id, vote, comment || null);

  // Recount from the source of truth so we never drift from the verifications table.
  const tally = db.prepare(
    `SELECT
       SUM(CASE WHEN vote = 'confirm' THEN 1 ELSE 0 END) AS confirms,
       SUM(CASE WHEN vote = 'deny'    THEN 1 ELSE 0 END) AS denies
     FROM ticket_verifications WHERE ticket_id = ?`
  ).get(id) as { confirms: number | null; denies: number | null };
  const confirms = tally.confirms || 0;
  const denies = tally.denies || 0;

  // Verification flip rules:
  //   - Admin vote=confirm → instant verify
  //   - confirms >= threshold → verify
  //   - denies > confirms by ≥3 → status stays open but admin should review
  //     (Phase 2 will move this to 'disputed').
  const isAdmin = req.user!.role === 'board_admin';
  let verified = false;
  if (vote === 'confirm' && (isAdmin || confirms >= ticket.verification_threshold)) {
    db.prepare(
      `UPDATE tickets
       SET verification_count = ?, denial_count = ?,
           verified_at = CURRENT_TIMESTAMP,
           verified_by_user_id = ?,
           remediation_status = 'verified',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(confirms, denies, isAdmin ? req.user!.id : null, id);
    verified = true;
  } else {
    db.prepare(
      `UPDATE tickets
       SET verification_count = ?, denial_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(confirms, denies, id);
  }

  audit(req, {
    action: 'ticket.verify',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: { vote, confirms, denies, threshold: ticket.verification_threshold, verified, by_admin: isAdmin },
  });
  // Phase 2 — kick off the AI agent the moment verification lands. The
  // background helper updates the ticket row when the model returns; we
  // don't block the HTTP response on the LLM call.
  if (verified) dispatchAgentInBackground(id, condoId, locale, req.user!.id);
  return ok(res, { id, verified, confirms, denies, threshold: ticket.verification_threshold });
});

// Dispatch the AI-drafted (or admin-edited) outreach message to a vendor.
// Picks a service_contact from the agent's existing_network_fit suggestions
// if none is specified, falls back to category match. Queues the message in
// notification_outbox (whatsapp/email) and records the attempt in
// ticket_dispatches for audit / response tracking. Channel='manual' lets
// the admin record an offline contact (phone call, in person) by hand.
router.post('/:id/dispatch', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = dispatchSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);

  let agentPlan: any = null;
  if (ticket.agent_plan) {
    try { agentPlan = JSON.parse(ticket.agent_plan); } catch { /* fall through */ }
  }

  // Pick vendor: explicit id wins, then top-of-network-fit by company name,
  // then any active service_contact in the ticket's category.
  let vendor: any = null;
  if (parsed.data.service_contact_id) {
    vendor = db.prepare(
      `SELECT * FROM service_contacts WHERE id = ? AND condominium_id = ? AND active = 1`
    ).get(parsed.data.service_contact_id, condoId);
  } else if (agentPlan?.existing_network_fit?.[0]?.company_name) {
    vendor = db.prepare(
      `SELECT * FROM service_contacts WHERE condominium_id = ? AND active = 1 AND company_name = ? LIMIT 1`
    ).get(condoId, agentPlan.existing_network_fit[0].company_name);
    if (vendor && !categoryMatches(ticket.category, vendor.category)) vendor = null;
  }
  if (!vendor) {
    const candidates = db.prepare(
      `SELECT * FROM service_contacts WHERE condominium_id = ? AND active = 1
       ORDER BY preferred DESC, emergency_available DESC, last_used_at DESC NULLS LAST`
    ).all(condoId) as any[];
    vendor = candidates.find((candidate) => categoryMatches(ticket.category, candidate.category));
  }
  if (!vendor) {
    // No vendor available — surface the block so the UI can prompt the
    // admin to add one (or pick manual mode).
    db.prepare(
      `UPDATE tickets SET remediation_status='blocked_needs_admin', blocked_reason='no_vendor_in_category', updated_at=CURRENT_TIMESTAMP WHERE id = ?`
    ).run(id);
    return fail(res, 'no_vendor_available', 400);
  }

  // Resolve channel preference: explicit > whatsapp if vendor.whatsapp >
  // email if vendor.email > manual.
  const channel = parsed.data.channel
    || (vendor.whatsapp ? 'whatsapp' : vendor.email ? 'email' : 'manual');
  const message = (parsed.data.message
    || agentPlan?.vendor_search_plan?.outreach_message
    || `Olá ${vendor.contact_name || vendor.company_name}, somos do condomínio. Precisamos de ajuda com: ${ticket.title}. Pode nos atender?`
  ).slice(0, 4_000);

  // Queue the actual delivery for whatsapp/email channels. Manual rows go
  // straight to ticket_dispatches as a record-of-action; no outbox row.
  let outboxId: number | null = null;
  if (channel === 'whatsapp' && vendor.whatsapp) {
    const out = db.prepare(
      `INSERT INTO notification_outbox (channel, provider, phone, body, status, next_attempt_at)
       VALUES ('whatsapp', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
    ).run(process.env.WHATSAPP_PROVIDER || 'twilio', vendor.whatsapp, message);
    outboxId = Number(out.lastInsertRowid);
  } else if (channel === 'email' && vendor.email) {
    const out = db.prepare(
      `INSERT INTO notification_outbox (channel, provider, email, body, status, next_attempt_at)
       VALUES ('email', ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
    ).run(process.env.EMAIL_PROVIDER || 'resend', vendor.email, message);
    outboxId = Number(out.lastInsertRowid);
  }

  const dispatch = db.prepare(
    `INSERT INTO ticket_dispatches
       (ticket_id, service_contact_id, channel, outbox_id, message_body, status, dispatched_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, vendor.id, channel, outboxId, message, outboxId ? 'queued' : 'sent', req.user!.id);

  db.prepare(
    `UPDATE tickets
     SET remediation_status = CASE WHEN remediation_status IN ('blocked_needs_admin','resolved') THEN remediation_status ELSE 'awaiting_vendor' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);
  // Stamp service_contact.last_used_at so the next agent run ranks it
  // higher in the "recently engaged" tiebreak.
  db.prepare(`UPDATE service_contacts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(vendor.id);

  audit(req, {
    action: 'ticket.dispatch',
    target_type: 'ticket_dispatch',
    target_id: Number(dispatch.lastInsertRowid),
    condominium_id: condoId,
    metadata: { ticket_id: id, service_contact_id: vendor.id, channel, outbox_id: outboxId },
  });
  return ok(res, {
    id: Number(dispatch.lastInsertRowid),
    vendor: { id: vendor.id, company_name: vendor.company_name },
    channel,
    outbox_id: outboxId,
  }, 201);
});

// Phase 3 — admin closes the loop. Marks the ticket as resolved on both
// status fields, stamps resolved_at, and (by default for community
// tickets) auto-posts an announcement so every resident in the condo sees
// the fix landed without having to go check /app/tickets. The announcement
// reuses the existing announcements table + its WhatsApp fanout, so
// residents who opted into notifications get a push for the resolution.
router.post('/:id/resolve', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (ticket.status === 'closed' || ticket.remediation_status === 'resolved') {
    return fail(res, 'already_resolved', 409);
  }

  const announce = parsed.data.announce ?? (ticket.verification_threshold > 0);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tickets
       SET status = 'resolved',
           remediation_status = 'resolved',
           resolved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);

    let announcementId: number | null = null;
    if (announce) {
      const announcementTitle = `Resolvido: ${ticket.title}`.slice(0, 200);
      const announcementBody = parsed.data.resolution.slice(0, 8_000);
      // announcements.source CHECK accepts ('manual','ai_meeting','ai_decision').
      // The resolution announcement is authored by the admin who clicked
      // resolve (they typed the text), so 'manual' is the honest value here.
      // A 'ticket_resolution' source would need a CHECK widen migration —
      // worth doing if we add more system-authored announcement flows.
      const result = db.prepare(
        `INSERT INTO announcements (condominium_id, author_id, title, body, pinned, source)
         VALUES (?, ?, ?, ?, 0, 'manual')`
      ).run(condoId, req.user!.id, announcementTitle, announcementBody);
      announcementId = Number(result.lastInsertRowid);
    }
    return { announcementId };
  });
  const txResult = tx();

  audit(req, {
    action: 'ticket.resolve',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: { announced: !!txResult.announcementId, announcement_id: txResult.announcementId },
  });

  // Fan out to the condo so residents see the closure. Same notification
  // path as ticket creation — opted-in WhatsApp + skipping users without
  // phone or opt-in. Best-effort: failures don't roll back the resolve.
  if (txResult.announcementId) {
    const peers = db.prepare(
      `SELECT DISTINCT uu.user_id
       FROM user_unit uu
       JOIN units un ON un.id = uu.unit_id
       JOIN buildings b ON b.id = un.building_id
       WHERE b.condominium_id = ? AND uu.status = 'active'`
    ).all(condoId) as Array<{ user_id: number }>;
    const ids = peers.map((p) => p.user_id);
    if (ids.length > 0) {
      const msg = `✅ Resolvido: ${ticket.title}\n\n${parsed.data.resolution.slice(0, 300)}`;
      void notifyUsers(ids, msg).catch((err) => {
        console.warn(`[tickets:${id}] resolution fanout failed:`, (err as Error)?.message || err);
      });
    }
  }

  return ok(res, { id, resolved_at: new Date().toISOString(), announcement_id: txResult.announcementId });
});

// Cancel a scheduled dispatch before its veto window elapses. Closes the
// auto-dispatch loop honestly: admin sees the "will send in 5min — cancel"
// banner, clicks cancel, both the dispatch row AND the outbox row flip
// to cancelled/skipped before the worker tries to send. After the window
// elapses, the outbox row is locked from cancellation (it's either being
// sent or already sent — calling cancel returns window_elapsed).
router.post('/:id/dispatches/:dispatchId/cancel', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const dispatchId = Number(req.params.dispatchId);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);

  const dispatch = db.prepare(
    `SELECT id, ticket_id, status, scheduled_send_after, outbox_id
     FROM ticket_dispatches WHERE id = ? AND ticket_id = ?`
  ).get(dispatchId, id) as
    | { id: number; ticket_id: number; status: string; scheduled_send_after: string | null; outbox_id: number | null }
    | undefined;
  if (!dispatch) return fail(res, 'dispatch_not_found', 404);
  // Only scheduled dispatches can be cancelled, and only while their
  // window is still in the future. A dispatch that already 'sent' or
  // landed in 'responded' is past the point of no return.
  if (dispatch.status !== 'queued') return fail(res, 'not_cancellable', 409);
  if (!dispatch.scheduled_send_after) return fail(res, 'no_veto_window', 409);
  const sendAfterMs = Date.parse((dispatch.scheduled_send_after || '').replace(' ', 'T') + 'Z');
  if (!Number.isFinite(sendAfterMs) || sendAfterMs <= Date.now()) {
    return fail(res, 'window_elapsed', 409);
  }

  const reason = String(req.body?.reason || 'admin_cancelled').slice(0, 120);

  // Atomic flip on both rows so the worker can never race in and send
  // mid-cancel. The outbox row goes to 'skipped' (not 'cancelled') so
  // it matches the existing status vocabulary for "didn't send because
  // we chose not to."
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE ticket_dispatches
       SET status = 'cancelled',
           cancellation_reason = ?,
           cancelled_by_user_id = ?,
           cancelled_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'`
    ).run(reason, req.user!.id, dispatchId);
    if (dispatch.outbox_id) {
      db.prepare(
        `UPDATE notification_outbox
         SET status = 'skipped', last_error = 'admin_cancelled'
         WHERE id = ? AND status = 'pending'`
      ).run(dispatch.outbox_id);
    }
    // Move the ticket back to agent_dispatched so the admin gets the
    // existing "plan ready" state back. They can re-dispatch manually
    // with the existing button.
    db.prepare(
      `UPDATE tickets
       SET remediation_status = 'agent_dispatched', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND remediation_status = 'awaiting_vendor'`
    ).run(id);
  });
  tx();

  // Pull the agent's confidence on this ticket so the audit log captures
  // the miscalibration signal: if the admin cancels a 'high' confidence
  // auto-dispatch, the agent was overconfident on this kind of case.
  // Aggregating across rows gives us a calibration metric over time.
  let agentConfidenceTier: string | null = null;
  let agentConfidenceScore: number | null = null;
  try {
    const planRow = db.prepare(`SELECT agent_plan FROM tickets WHERE id = ?`).get(id) as { agent_plan: string | null } | undefined;
    if (planRow?.agent_plan) {
      const parsed = JSON.parse(planRow.agent_plan);
      agentConfidenceTier = parsed?.confidence?.tier ?? null;
      agentConfidenceScore = typeof parsed?.confidence?.score === 'number' ? parsed.confidence.score : null;
    }
  } catch { /* malformed plan — leave nulls */ }

  audit(req, {
    action: 'ticket.dispatch_cancelled',
    target_type: 'ticket_dispatch',
    target_id: dispatchId,
    condominium_id: condoId,
    metadata: {
      ticket_id: id,
      reason,
      // Calibration signal — these get aggregated by GET /admin-agent/
      // calibration to compute per-tier override rates.
      agent_confidence_tier: agentConfidenceTier,
      agent_confidence_score: agentConfidenceScore,
    },
  });
  return ok(res, { id: dispatchId, status: 'cancelled' });
});

// Admin records that the vendor replied — closes the awaiting_vendor loop
// and flips the ticket to vendor_engaged. A short summary captures what
// the vendor said so the next admin action has context.
router.post('/:id/dispatches/:dispatchId/responded', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = markRespondedSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const dispatchId = Number(req.params.dispatchId);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);

  const updated = db.prepare(
    `UPDATE ticket_dispatches
     SET status = 'responded', responded_at = CURRENT_TIMESTAMP, response_summary = ?
     WHERE id = ? AND ticket_id = ?`
  ).run(parsed.data.response_summary, dispatchId, id);
  if (updated.changes === 0) return fail(res, 'dispatch_not_found', 404);

  db.prepare(
    `UPDATE tickets
     SET remediation_status = CASE WHEN remediation_status IN ('resolved','blocked_needs_admin') THEN remediation_status ELSE 'vendor_engaged' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);

  audit(req, {
    action: 'ticket.dispatch_responded',
    target_type: 'ticket_dispatch',
    target_id: dispatchId,
    condominium_id: condoId,
    metadata: { ticket_id: id },
  });
  return ok(res, { id: dispatchId, status: 'responded' });
});

// Admin manually fires the operations AI agent against this ticket. Pulls
// the condo's service_contacts so the agent can match the issue against the
// existing network and surface an outreach plan. Stores the result on the
// ticket so the admin can review it without re-running the model (and the
// next phase can auto-act on it).
router.post('/:id/run-agent', requireAuth, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (ticket.remediation_status === 'resolved') return fail(res, 'already_resolved', 409);

  const localeRaw = typeof req.body?.locale === 'string' ? req.body.locale : '';
  const result = await runAdminAgent({
    condoId,
    locale: localeRaw,
    task: `${ticket.title}\n\n${ticket.description}`,
    mode: ticket.priority === 'urgent' ? 'repair' : 'general',
    ticketId: id,
  });

  db.prepare(
    `UPDATE tickets
     SET agent_plan = ?,
         agent_run_at = CURRENT_TIMESTAMP,
         remediation_status = CASE
           WHEN remediation_status IN ('open','verified') THEN 'agent_dispatched'
           ELSE remediation_status
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(JSON.stringify(result.plan), id);

  audit(req, {
    action: 'ticket.run_agent',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: { fallback: result.fallback, options: result.plan?.options?.length || 0 },
  });
  return ok(res, { id, plan: result.plan, fallback: result.fallback });
}));

router.post('/:id/work-order', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = workOrderCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (!ensureVendorInCondo(parsed.data.service_contact_id, condoId)) {
    return fail(res, 'vendor_not_in_condo', 400);
  }

  const existing = db.prepare(`SELECT id FROM ticket_work_orders WHERE ticket_id = ?`).get(id) as { id: number } | undefined;
  if (existing) {
    const body = parsed.data;
    const sets: string[] = [];
    const vals: any[] = [];
    const has = (key: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, key);
    if (has('service_contact_id')) { sets.push('service_contact_id = ?'); vals.push(body.service_contact_id || null); }
    if (has('title') && body.title) { sets.push('title = ?'); vals.push(body.title.trim()); }
    if (has('scope')) { sets.push('scope = ?'); vals.push(blankToNull(body.scope)); }
    if (has('status') && body.status) {
      sets.push('status = ?'); vals.push(body.status);
      if (body.status === 'in_progress') sets.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)');
      if (body.status === 'completed') sets.push('completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)');
    }
    if (has('estimated_amount_cents')) { sets.push('estimated_amount_cents = ?'); vals.push(body.estimated_amount_cents ?? null); }
    if (has('approved_amount_cents')) { sets.push('approved_amount_cents = ?'); vals.push(body.approved_amount_cents ?? null); }
    if (has('scheduled_for')) { sets.push('scheduled_for = ?'); vals.push(blankToNull(body.scheduled_for)); }
    if (has('invoice_url')) { sets.push('invoice_url = ?'); vals.push(blankToNull(body.invoice_url)); }
    if (has('photo_url')) { sets.push('photo_url = ?'); vals.push(blankToNull(body.photo_url)); }
    if (has('completion_note')) { sets.push('completion_note = ?'); vals.push(blankToNull(body.completion_note)); }
    sets.push('updated_by_user_id = ?', 'updated_at = CURRENT_TIMESTAMP');
    vals.push(req.user!.id, existing.id);
    db.prepare(`UPDATE ticket_work_orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    if (body.status) syncTicketFromWorkOrder(id, body.status);
    audit(req, {
      action: 'ticket.work_order_update',
      target_type: 'ticket_work_order',
      target_id: existing.id,
      condominium_id: condoId,
      metadata: { ticket_id: id, status: body.status || null },
    });
    return ok(res, getTicketWorkOrder(id));
  }

  const body = parsed.data;
  const now = sqlNow();
  const status = body.status || 'scheduled';
  const result = db.prepare(
    `INSERT INTO ticket_work_orders (
       ticket_id, service_contact_id, title, scope, status,
       estimated_amount_cents, approved_amount_cents, scheduled_for,
       started_at, completed_at, invoice_url, photo_url, completion_note,
       created_by_user_id, updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    body.service_contact_id || null,
    (body.title?.trim() || `Ordem de serviço: ${ticket.title}`).slice(0, 160),
    blankToNull(body.scope),
    status,
    body.estimated_amount_cents ?? null,
    body.approved_amount_cents ?? null,
    blankToNull(body.scheduled_for),
    status === 'in_progress' ? now : null,
    status === 'completed' ? now : null,
    blankToNull(body.invoice_url),
    blankToNull(body.photo_url),
    blankToNull(body.completion_note),
    req.user!.id,
    req.user!.id,
  );
  syncTicketFromWorkOrder(id, status);
  audit(req, {
    action: 'ticket.work_order_create',
    target_type: 'ticket_work_order',
    target_id: Number(result.lastInsertRowid),
    condominium_id: condoId,
    metadata: { ticket_id: id, service_contact_id: body.service_contact_id || null, status },
  });
  return ok(res, getTicketWorkOrder(id), 201);
});

router.patch('/:id/work-order/:workOrderId', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = workOrderUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const workOrderId = Number(req.params.workOrderId);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (!ensureVendorInCondo(parsed.data.service_contact_id, condoId)) {
    return fail(res, 'vendor_not_in_condo', 400);
  }
  const existing = db.prepare(
    `SELECT id FROM ticket_work_orders WHERE id = ? AND ticket_id = ?`
  ).get(workOrderId, id) as { id: number } | undefined;
  if (!existing) return fail(res, 'work_order_not_found', 404);

  const body = parsed.data;
  const sets: string[] = [];
  const vals: any[] = [];
  const has = (key: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, key);
  if (has('service_contact_id')) { sets.push('service_contact_id = ?'); vals.push(body.service_contact_id || null); }
  if (has('title') && body.title) { sets.push('title = ?'); vals.push(body.title.trim()); }
  if (has('scope')) { sets.push('scope = ?'); vals.push(blankToNull(body.scope)); }
  if (has('status') && body.status) {
    sets.push('status = ?'); vals.push(body.status);
    if (body.status === 'in_progress') sets.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)');
    if (body.status === 'completed') sets.push('completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)');
  }
  if (has('estimated_amount_cents')) { sets.push('estimated_amount_cents = ?'); vals.push(body.estimated_amount_cents ?? null); }
  if (has('approved_amount_cents')) { sets.push('approved_amount_cents = ?'); vals.push(body.approved_amount_cents ?? null); }
  if (has('scheduled_for')) { sets.push('scheduled_for = ?'); vals.push(blankToNull(body.scheduled_for)); }
  if (has('invoice_url')) { sets.push('invoice_url = ?'); vals.push(blankToNull(body.invoice_url)); }
  if (has('photo_url')) { sets.push('photo_url = ?'); vals.push(blankToNull(body.photo_url)); }
  if (has('completion_note')) { sets.push('completion_note = ?'); vals.push(blankToNull(body.completion_note)); }
  if (sets.length === 0) return fail(res, 'nothing_to_update', 400);
  sets.push('updated_by_user_id = ?', 'updated_at = CURRENT_TIMESTAMP');
  vals.push(req.user!.id, workOrderId);
  db.prepare(`UPDATE ticket_work_orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  if (body.status) syncTicketFromWorkOrder(id, body.status);
  audit(req, {
    action: 'ticket.work_order_update',
    target_type: 'ticket_work_order',
    target_id: workOrderId,
    condominium_id: condoId,
    metadata: { ticket_id: id, status: body.status || null },
  });
  return ok(res, getTicketWorkOrder(id));
});

router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (!canSeeTicket(req, ticket)) return fail(res, 'forbidden', 403);

  // Reporter byline enrichment — matches the join used by GET /. Surfaces
  // the reporter's primary active unit so the detail page can render the
  // same `Name · Unit · Date` byline as the list view.
  const reporter = db.prepare(
    `SELECT r.first_name AS reporter_first, r.last_name AS reporter_last,
            ru.number AS reporter_unit_number
     FROM users r
     LEFT JOIN user_unit ruu ON ruu.user_id = r.id AND ruu.status = 'active' AND ruu.primary_contact = 1
     LEFT JOIN units ru ON ru.id = ruu.unit_id
     WHERE r.id = ?`
  ).get(ticket.reporter_id) as { reporter_first: string; reporter_last: string; reporter_unit_number: string | null } | undefined;
  if (reporter) Object.assign(ticket, reporter);

  // Privacy gate (mirrors GET /): redact reporter's unit + last name on
  // community-visible tickets when viewed by a non-admin who isn't the
  // reporter. Same map-of-the-condo risk as the list view.
  const viewerIsAdmin = req.user!.role === 'board_admin';
  const viewerIsReporter = ticket.reporter_id === req.user!.id;
  if (!viewerIsAdmin && !viewerIsReporter && (ticket as any).community_visible) {
    (ticket as any).reporter_last = null;
    (ticket as any).reporter_unit_number = null;
  }

  const comments = db.prepare(
    `SELECT c.*, u.first_name, u.last_name
     FROM ticket_comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.ticket_id = ?
       AND (? = 1 OR c.internal = 0)
     ORDER BY c.created_at ASC`
  ).all(id, req.user!.role === 'board_admin' ? 1 : 0);
  const attachments = db.prepare(
    `SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC`
  ).all(id);
  // Verifications: only include if the ticket is community-visible.
  // Privacy gate: a verifier who voted "deny" on a contested community
  // ticket shouldn't be publicly named + located. Non-admin viewers see
  // first names only and no unit numbers; admins get the full row.
  const verifications = ticket.verification_threshold > 0
    ? (db.prepare(
        `SELECT v.id, v.vote, v.comment, v.created_at, v.user_id,
                u.first_name, u.last_name, u.unit_number
         FROM ticket_verifications v
         JOIN users u ON u.id = v.user_id
         WHERE v.ticket_id = ?
         ORDER BY v.created_at ASC`
      ).all(id) as any[]).map((v) => {
        if (viewerIsAdmin || v.user_id === req.user!.id) return v;
        return { ...v, last_name: null, unit_number: null };
      })
    : [];
  // The viewer's own vote (if any) — handy so the UI can pre-select the
  // confirm/deny pill without a separate fetch.
  const myVoteRow = ticket.verification_threshold > 0
    ? db.prepare(`SELECT vote FROM ticket_verifications WHERE ticket_id = ? AND user_id = ?`).get(id, req.user!.id) as { vote: string } | undefined
    : undefined;
  // agent_plan is stored as JSON text; parse on the way out so the client
  // doesn't have to. Failures (corrupt JSON) silently return null rather
  // than 500-ing the ticket detail page.
  let agent_plan: any = null;
  if (ticket.agent_plan) {
    try { agent_plan = JSON.parse(ticket.agent_plan); } catch { agent_plan = null; }
  }
  // Vendor outreach trail (Phase 2). Only meaningful for community tickets
  // but harmless on private ones — empty array.
  const dispatchRows = db.prepare(
    `SELECT d.id, d.channel, d.status, d.message_body, d.created_at, d.responded_at, d.response_summary,
            d.scheduled_send_after, d.cancellation_reason,
            sc.company_name AS vendor_name, sc.contact_name AS vendor_contact, sc.category AS vendor_category,
            o.status AS outbox_status, o.sent_at AS outbox_sent_at, o.last_error AS outbox_error
     FROM ticket_dispatches d
     LEFT JOIN service_contacts sc ON sc.id = d.service_contact_id
     LEFT JOIN notification_outbox o ON o.id = d.outbox_id
     WHERE d.ticket_id = ?
     ORDER BY d.created_at DESC`
  ).all(id) as any[];
  // Pilot-readiness item 3 — the resident timeline only needs status,
  // timestamps, and the vendor company name. Stripping outreach message
  // body, vendor contact name, outbox errors, and the channel keeps the
  // resident view from leaking how the admin actually contacted the vendor.
  // Admins still get the full record.
  const isAdminViewer = req.user!.role === 'board_admin';
  const dispatches = isAdminViewer
    ? dispatchRows
    : dispatchRows.map((d) => ({
        id: d.id,
        status: d.status,
        created_at: d.created_at,
        responded_at: d.responded_at,
        vendor_name: d.vendor_name,
      }));
  const workOrder = getTicketWorkOrder(id);
  return ok(res, {
    ...ticket,
    agent_plan,
    comments,
    attachments,
    verifications,
    dispatches,
    work_order: workOrder || null,
    my_vote: myVoteRow?.vote || null,
  });
});

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = ticketUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  const fields = parsed.data;
  if (fields.assigned_to_user_id !== undefined && fields.assigned_to_user_id !== null) {
    if (!canAssignTicketToUser(fields.assigned_to_user_id, condoId)) {
      return fail(res, 'assignee_not_in_condo', 400);
    }
  }
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    vals.push(value);
  }
  if (fields.status === 'resolved') sets.push('resolved_at = CURRENT_TIMESTAMP');
  if (fields.status === 'closed') sets.push('closed_at = CURRENT_TIMESTAMP');
  if (sets.length === 0) return fail(res, 'nothing_to_update', 400);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  audit(req, {
    action: 'ticket.update',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: { fields: Object.keys(fields) },
  });
  return ok(res, { id });
});

router.post('/:id/comments', requireAuth, (req: AuthedRequest, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (!canSeeTicket(req, ticket)) return fail(res, 'forbidden', 403);
  if (parsed.data.internal && req.user!.role !== 'board_admin') return fail(res, 'forbidden', 403);

  const result = db.prepare(
    `INSERT INTO ticket_comments (ticket_id, author_id, body, internal) VALUES (?, ?, ?, ?)`
  ).run(id, req.user!.id, parsed.data.body, parsed.data.internal ? 1 : 0);
  db.prepare(`UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  audit(req, {
    action: 'ticket.comment',
    target_type: 'ticket_comment',
    target_id: Number(result.lastInsertRowid),
    condominium_id: condoId,
    metadata: { ticket_id: id, internal: parsed.data.internal },
  });
  return ok(res, { id: Number(result.lastInsertRowid) }, 201);
});

router.post('/:id/attachments', requireAuth, (req: AuthedRequest, res) => {
  const parsed = attachmentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (!canSeeTicket(req, ticket)) return fail(res, 'forbidden', 403);

  const file = parsed.data.file_id
    ? assertFileReadyForUse({ fileId: parsed.data.file_id, condoId, purpose: 'ticket_attachment' })
    : null;
  if (parsed.data.file_id && !file) return fail(res, 'invalid_file', 400);
  const url = file ? fileDownloadPath(file.id) : parsed.data.url!;
  const filename = parsed.data.filename || file?.original_filename || null;
  const contentType = parsed.data.content_type || file?.content_type || null;

  const result = db.prepare(
    `INSERT INTO ticket_attachments (ticket_id, uploaded_by_user_id, url, file_id, filename, content_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.user!.id, url, file?.id || null, filename, contentType);
  const attachmentId = Number(result.lastInsertRowid);
  if (file) attachFileToTarget(file.id, 'ticket_attachment', attachmentId);
  db.prepare(`UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  audit(req, {
    action: 'ticket.attachment_create',
    target_type: 'ticket_attachment',
    target_id: attachmentId,
    condominium_id: condoId,
    metadata: { ticket_id: id },
  });
  return ok(res, { id: attachmentId }, 201);
});

router.delete('/:id/attachments/:attachmentId', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  db.prepare(`DELETE FROM ticket_attachments WHERE id = ? AND ticket_id = ?`).run(attachmentId, id);
  audit(req, {
    action: 'ticket.attachment_delete',
    target_type: 'ticket_attachment',
    target_id: attachmentId,
    condominium_id: condoId,
    metadata: { ticket_id: id },
  });
  return ok(res, { id: attachmentId, deleted: true });
});

export default router;
