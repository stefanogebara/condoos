import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

const router = Router();

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT * FROM amenities WHERE condominium_id = ? ORDER BY name`
  ).all(req.user!.condominium_id);
  return ok(res, rows);
});

router.get('/reservations', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT r.*, a.name AS amenity_name, a.icon AS amenity_icon,
            usr.first_name, usr.last_name, usr.unit_number
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     JOIN users usr ON usr.id = r.user_id
     WHERE a.condominium_id = ?
     ORDER BY r.starts_at ASC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

router.post('/reservations', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const { amenity_id, starts_at, ends_at } = req.body || {};
  if (!amenity_id || !starts_at || !ends_at) return fail(res, 'missing_fields');
  const row = db.prepare(
    `INSERT INTO amenity_reservations (amenity_id, user_id, starts_at, ends_at)
     VALUES (?, ?, ?, ?)`
  ).run(amenity_id, u.id, starts_at, ends_at);
  return ok(res, { id: row.lastInsertRowid });
});

router.delete('/reservations/:id', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM amenity_reservations WHERE id = ?`).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (u.role !== 'board_admin' && row.user_id !== u.id) return fail(res, 'forbidden', 403);
  db.prepare(`UPDATE amenity_reservations SET status='cancelled' WHERE id = ?`).run(id);
  return ok(res, { id, status: 'cancelled' });
});

export default router;
