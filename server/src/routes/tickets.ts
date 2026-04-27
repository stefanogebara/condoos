import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

const ticketCreateSchema = z.object({
  unit_id: z.number().int().positive().optional(),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(4_000),
  category: z.string().min(1).max(60).default('maintenance'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
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
  url: z.string().url().max(1_000),
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
  return ticket.reporter_id === req.user!.id;
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const clauses = ['t.condominium_id = ?'];
  const params: any[] = [condoId];
  if (req.user!.role !== 'board_admin') {
    clauses.push('t.reporter_id = ?');
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
    `INSERT INTO tickets (condominium_id, unit_id, reporter_id, title, description, category, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(condoId, body.unit_id || null, req.user!.id, body.title, body.description, body.category, body.priority);
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'ticket.create',
    target_type: 'ticket',
    target_id: id,
    condominium_id: condoId,
    metadata: { unit_id: body.unit_id || null, priority: body.priority },
  });
  return ok(res, { id }, 201);
});

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
  return ok(res, { ...ticket, comments, attachments });
});

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = ticketUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const ticket = getScopedTicket(id, condoId);
  if (!ticket) return fail(res, 'not_found', 404);
  const fields = parsed.data;
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
