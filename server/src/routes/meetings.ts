import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

const router = Router();

function getScopedMeeting(id: number, condoId: number) {
  return db.prepare(
    `SELECT * FROM meetings WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId) as any;
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT * FROM meetings WHERE condominium_id = ? ORDER BY scheduled_for DESC`
  ).all(condoId);
  return ok(res, rows);
});

router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const m = getScopedMeeting(id, condoId);
  if (!m) return fail(res, 'not_found', 404);
  const actions = db.prepare(
    `SELECT * FROM action_items WHERE meeting_id=? ORDER BY created_at ASC`
  ).all(id);
  return ok(res, { ...m, action_items: actions });
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const { title, scheduled_for, agenda } = req.body || {};
  if (!title || !scheduled_for) return fail(res, 'missing_fields');
  const row = db.prepare(
    `INSERT INTO meetings (condominium_id, title, scheduled_for, agenda) VALUES (?, ?, ?, ?)`
  ).run(condoId, title, scheduled_for, agenda || null);
  return ok(res, { id: row.lastInsertRowid });
});

router.patch('/:id/notes', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!getScopedMeeting(id, condoId)) return fail(res, 'not_found', 404);
  const { raw_notes } = req.body || {};
  db.prepare(`UPDATE meetings SET raw_notes=?, ai_summary=NULL WHERE id=?`).run(raw_notes || '', id);
  return ok(res, { id });
});

router.post('/:id/complete', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!getScopedMeeting(id, condoId)) return fail(res, 'not_found', 404);
  db.prepare(`UPDATE meetings SET status='completed' WHERE id=?`).run(id);
  return ok(res, { id, status: 'completed' });
});

router.post('/:id/action-items', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!getScopedMeeting(id, condoId)) return fail(res, 'not_found', 404);
  const { description, owner_label, owner_id, due_date } = req.body || {};
  if (!description) return fail(res, 'missing_description');
  const row = db.prepare(
    `INSERT INTO action_items (meeting_id, description, owner_label, owner_id, due_date) VALUES (?, ?, ?, ?, ?)`
  ).run(id, description, owner_label || null, owner_id || null, due_date || null);
  return ok(res, { id: row.lastInsertRowid });
});

router.post('/action-items/:id/toggle', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const row = db.prepare(
    `SELECT ai.status, m.condominium_id
     FROM action_items ai
     JOIN meetings m ON m.id = ai.meeting_id
     WHERE ai.id = ?`
  ).get(id) as any;
  if (!row || row.condominium_id !== condoId) return fail(res, 'not_found', 404);
  const next = row.status === 'open' ? 'done' : 'open';
  db.prepare(`UPDATE action_items SET status=? WHERE id=?`).run(next, id);
  return ok(res, { id, status: next });
});

export default router;
