import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

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
  const { amenity_id, starts_at, ends_at, expected_guests, guest_list, notes } = req.body || {};
  if (!amenity_id || !starts_at || !ends_at) return fail(res, 'missing_fields');
  const starts = new Date(starts_at);
  const ends = new Date(ends_at);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    return fail(res, 'invalid_time', 400);
  }
  if (ends <= starts) return fail(res, 'ends_must_be_after_starts', 400);

  // Amenity must belong to the user's condo.
  const amenity = db.prepare(
    `SELECT id, capacity, open_hour, close_hour FROM amenities WHERE id = ? AND condominium_id = ?`
  ).get(amenity_id, u.condominium_id) as { id: number; capacity: number; open_hour: number; close_hour: number } | undefined;
  if (!amenity) return fail(res, 'amenity_not_in_condo', 400);

  const sameLocalDay = starts.toDateString() === ends.toDateString();
  const startHour = starts.getHours() + starts.getMinutes() / 60;
  const endHour = ends.getHours() + ends.getMinutes() / 60;
  if (!sameLocalDay || startHour < amenity.open_hour || endHour > amenity.close_hour) {
    return fail(res, 'outside_open_hours', 400);
  }

  const overlapping = db.prepare(
    `SELECT COUNT(*) AS n
     FROM amenity_reservations
     WHERE amenity_id = ?
       AND status = 'confirmed'
       AND starts_at < ?
       AND ends_at > ?`
  ).get(amenity.id, ends.toISOString(), starts.toISOString()) as { n: number };
  if (overlapping.n >= Math.max(1, amenity.capacity || 1)) {
    return fail(res, 'amenity_conflict', 409);
  }

  const guests = Math.max(0, Math.min(500, parseInt(expected_guests as any) || 0));
  const guestListText = typeof guest_list === 'string' ? guest_list.slice(0, 4000) : null;
  const notesText = typeof notes === 'string' ? notes.slice(0, 600) : null;

  const row = db.prepare(
    `INSERT INTO amenity_reservations (amenity_id, user_id, starts_at, ends_at, expected_guests, guest_list, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    amenity.id, u.id,
    starts.toISOString(), ends.toISOString(),
    guests, guestListText, notesText,
  );
  audit(req, {
    action: 'amenity.reservation_create',
    target_type: 'amenity_reservation',
    target_id: Number(row.lastInsertRowid),
    condominium_id: u.condominium_id,
    metadata: { amenity_id: amenity.id, starts_at: starts.toISOString(), ends_at: ends.toISOString(), expected_guests: guests, has_guest_list: !!guestListText },
  });
  return ok(res, { id: row.lastInsertRowid, expected_guests: guests });
});

router.delete('/reservations/:id', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const row = db.prepare(
    `SELECT r.*, a.condominium_id FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id WHERE r.id = ?`
  ).get(id) as any;
  if (!row || row.condominium_id !== u.condominium_id) return fail(res, 'not_found', 404);
  if (u.role !== 'board_admin' && row.user_id !== u.id) return fail(res, 'forbidden', 403);
  db.prepare(`UPDATE amenity_reservations SET status='cancelled' WHERE id = ?`).run(id);
  audit(req, {
    action: 'amenity.reservation_cancel',
    target_type: 'amenity_reservation',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { amenity_id: row.amenity_id },
  });
  return ok(res, { id, status: 'cancelled' });
});

export default router;
