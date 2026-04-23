import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

const router = Router();

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT s.*, usr.first_name, usr.last_name, usr.unit_number,
            c.label AS cluster_label
     FROM suggestions s
     JOIN users usr ON usr.id = s.author_id
     LEFT JOIN suggestion_clusters c ON c.id = s.cluster_id
     WHERE s.condominium_id = ?
     ORDER BY s.created_at DESC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

router.post('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const { body } = req.body || {};
  if (!body || !body.trim()) return fail(res, 'empty_body');
  const row = db.prepare(
    `INSERT INTO suggestions (condominium_id, author_id, body) VALUES (?, ?, ?)`
  ).run(u.condominium_id, u.id, body.trim());
  return ok(res, { id: row.lastInsertRowid });
});

router.get('/clusters', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const clusters = db.prepare(
    `SELECT * FROM suggestion_clusters WHERE condominium_id = ? ORDER BY created_at DESC`
  ).all(u.condominium_id) as any[];
  const withMembers = clusters.map((c) => ({
    ...c,
    members: db.prepare(
      `SELECT s.*, usr.first_name, usr.last_name, usr.unit_number
       FROM suggestions s JOIN users usr ON usr.id = s.author_id
       WHERE s.cluster_id = ? ORDER BY s.created_at DESC`
    ).all(c.id),
  }));
  return ok(res, withMembers);
});

router.post('/:id/dismiss', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE suggestions SET status='dismissed' WHERE id=?`).run(id);
  return ok(res, { id, status: 'dismissed' });
});

export default router;
