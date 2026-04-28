import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

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
  const { visitor_name, visitor_type, expected_at, notes, pre_approve } = req.body || {};
  if (!visitor_name) return fail(res, 'missing_visitor_name');

  // Pre-approval (#9 in the QA checklist): when the resident books a future
  // visit, the host is the one approving — so we set status='approved'
  // immediately and stamp decided_at. Porteiros / board admins still get the
  // /:id/decide endpoint for ad-hoc walk-ups that arrive without warning.
  const status = pre_approve === true ? 'approved' : 'pending';
  const decidedAt = pre_approve === true ? new Date().toISOString() : null;

  const row = db.prepare(
    `INSERT INTO visitors (condominium_id, host_id, visitor_name, visitor_type, expected_at, notes, status, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    u.condominium_id, u.id,
    visitor_name, visitor_type || 'guest',
    expected_at || null, notes || null,
    status, decidedAt,
  );
  audit(req, {
    action: 'visitor.create',
    target_type: 'visitor',
    target_id: Number(row.lastInsertRowid),
    condominium_id: u.condominium_id,
    metadata: { visitor_type: visitor_type || 'guest', pre_approve: pre_approve === true },
  });
  return ok(res, { id: row.lastInsertRowid, status });
});

router.post('/:id/decide', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  if (!['approved', 'denied'].includes(decision)) return fail(res, 'invalid_decision');
  const v = db.prepare(`SELECT id FROM visitors WHERE id=? AND condominium_id=?`).get(id, u.condominium_id);
  if (!v) return fail(res, 'not_found', 404);
  db.prepare(`UPDATE visitors SET status=?, decided_at=CURRENT_TIMESTAMP WHERE id=?`).run(decision, id);
  audit(req, {
    action: 'visitor.decide',
    target_type: 'visitor',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { decision },
  });
  return ok(res, { id, status: decision });
});

router.post('/:id/arrived', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const v = db.prepare(`SELECT id FROM visitors WHERE id=? AND condominium_id=?`).get(id, u.condominium_id);
  if (!v) return fail(res, 'not_found', 404);
  db.prepare(`UPDATE visitors SET status='arrived' WHERE id=?`).run(id);
  audit(req, {
    action: 'visitor.arrived',
    target_type: 'visitor',
    target_id: id,
    condominium_id: u.condominium_id,
  });
  return ok(res, { id, status: 'arrived' });
});

export default router;
