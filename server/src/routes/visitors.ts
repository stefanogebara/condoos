import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

const router = Router();

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = u.role === 'board_admin'
    ? db.prepare(
        `SELECT v.*, usr.first_name, usr.last_name, usr.unit_number
         FROM visitors v JOIN users usr ON usr.id = v.host_id
         WHERE v.condominium_id = ?
         ORDER BY v.created_at DESC`
      ).all(u.condominium_id)
    : db.prepare(
        `SELECT * FROM visitors WHERE host_id = ? ORDER BY created_at DESC`
      ).all(u.id);
  return ok(res, rows);
});

router.post('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const { visitor_name, visitor_type, expected_at, notes } = req.body || {};
  if (!visitor_name) return fail(res, 'missing_visitor_name');
  const row = db.prepare(
    `INSERT INTO visitors (condominium_id, host_id, visitor_name, visitor_type, expected_at, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(u.condominium_id, u.id, visitor_name, visitor_type || 'guest', expected_at || null, notes || null);
  return ok(res, { id: row.lastInsertRowid });
});

router.post('/:id/decide', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  if (!['approved', 'denied'].includes(decision)) return fail(res, 'invalid_decision');
  db.prepare(`UPDATE visitors SET status=?, decided_at=CURRENT_TIMESTAMP WHERE id=?`).run(decision, id);
  return ok(res, { id, status: decision });
});

router.post('/:id/arrived', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE visitors SET status='arrived' WHERE id=?`).run(id);
  return ok(res, { id, status: 'arrived' });
});

export default router;
