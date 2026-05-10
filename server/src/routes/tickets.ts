import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { audit } from '../lib/audit';
import { canAssignTicketToUser } from '../lib/tickets';
import { runAdminAgent } from '../ai/admin-agent-runner';

const router = Router();

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
  ),
  filename: z.string().max(240).optional(),
  content_type: z.string().max(120).optional(),
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

function canSeeTicket(req: AuthedRequest, ticket: any): boolean {
  if (req.user!.role === 'board_admin') return true;
  if (ticket.reporter_id === req.user!.id) return true;
  // Community-visible tickets: anyone in the condo (already enforced via
  // condominium_id in the query) can read & verify them.
  return Number(ticket.verification_threshold) > 0;
}

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
  const rows = db.prepare(
    `SELECT t.*, u.number AS unit_number, r.first_name AS reporter_first, r.last_name AS reporter_last,
            a.first_name AS assignee_first, a.last_name AS assignee_last
     FROM tickets t
     LEFT JOIN units u ON u.id = t.unit_id
     JOIN users r ON r.id = t.reporter_id
     LEFT JOIN users a ON a.id = t.assigned_to_user_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY
       CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
       t.updated_at DESC`
  ).all(...params);
  return ok(res, rows);
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

  const result = db.prepare(
    `INSERT INTO tickets (condominium_id, unit_id, reporter_id, title, description, category, priority, verification_threshold)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(condoId, body.unit_id || null, req.user!.id, body.title, body.description, body.category, body.priority, body.verification_threshold);
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'ticket.create',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: {
      unit_id: body.unit_id || null,
      priority: body.priority,
      verification_threshold: body.verification_threshold,
    },
  });
  return ok(res, { id }, 201);
});

// Resident (or admin) records a confirm/deny vote on a community-visible
// ticket. Re-voting overwrites the previous vote (UNIQUE constraint on
// ticket_id + user_id). When confirm_count reaches verification_threshold
// the ticket flips to remediation_status='verified' and stamps verified_at.
// Admins implicitly verify with one vote regardless of threshold.
router.post('/:id/verify', requireAuth, (req: AuthedRequest, res) => {
  const parsed = verifyVoteSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (ticket.verification_threshold <= 0) return fail(res, 'not_community_ticket', 400);
  if (ticket.remediation_status !== 'open') return fail(res, 'already_resolved', 409);

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
  return ok(res, { id, verified, confirms, denies, threshold: ticket.verification_threshold });
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

router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  if (!canSeeTicket(req, ticket)) return fail(res, 'forbidden', 403);

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
  // Verifications: only include if the ticket is community-visible. Each row
  // exposes the voter's display name + unit so residents can see who else
  // confirmed the report. Comment text is kept short by the schema cap.
  const verifications = ticket.verification_threshold > 0
    ? db.prepare(
        `SELECT v.id, v.vote, v.comment, v.created_at,
                u.first_name, u.last_name, u.unit_number
         FROM ticket_verifications v
         JOIN users u ON u.id = v.user_id
         WHERE v.ticket_id = ?
         ORDER BY v.created_at ASC`
      ).all(id)
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
  return ok(res, {
    ...ticket,
    agent_plan,
    comments,
    attachments,
    verifications,
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

  const result = db.prepare(
    `INSERT INTO ticket_attachments (ticket_id, uploaded_by_user_id, url, filename, content_type)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, req.user!.id, parsed.data.url, parsed.data.filename || null, parsed.data.content_type || null);
  db.prepare(`UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  audit(req, {
    action: 'ticket.attachment_create',
    target_type: 'ticket_attachment',
    target_id: Number(result.lastInsertRowid),
    condominium_id: condoId,
    metadata: { ticket_id: id },
  });
  return ok(res, { id: Number(result.lastInsertRowid) }, 201);
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
