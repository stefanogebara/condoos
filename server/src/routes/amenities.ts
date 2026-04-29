import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

type AmenityInput = {
  name?: unknown;
  description?: unknown;
  icon?: unknown;
  capacity?: unknown;
  open_hour?: unknown;
  close_hour?: unknown;
  slot_minutes?: unknown;
  booking_window_days?: unknown;
  active?: unknown;
  admin_notes?: unknown;
};

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanAmenityInput(input: AmenityInput, existing?: any) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : existing?.name;
  if (!name) return { error: 'name_required' as const };

  const description = typeof input.description === 'string'
    ? input.description.trim().slice(0, 280)
    : existing?.description || '';
  const icon = typeof input.icon === 'string'
    ? input.icon.trim().slice(0, 40)
    : existing?.icon || 'Waves';
  const capacity = intInRange(input.capacity, existing?.capacity ?? 1, 1, 500);
  const open_hour = intInRange(input.open_hour, existing?.open_hour ?? 8, 0, 23);
  const close_hour = intInRange(input.close_hour, existing?.close_hour ?? 22, 1, 24);
  const rawSlot = intInRange(input.slot_minutes, existing?.slot_minutes ?? 60, 15, 240);
  const slot_minutes = Math.max(15, Math.round(rawSlot / 15) * 15);
  const booking_window_days = intInRange(input.booking_window_days, existing?.booking_window_days ?? 14, 1, 365);
  const active = input.active === undefined ? (existing?.active ?? 1) : input.active ? 1 : 0;
  const admin_notes = typeof input.admin_notes === 'string'
    ? input.admin_notes.trim().slice(0, 600)
    : existing?.admin_notes || null;

  if (close_hour <= open_hour) return { error: 'close_hour_must_be_after_open_hour' as const };
  if (slot_minutes > (close_hour - open_hour) * 60) return { error: 'slot_longer_than_open_hours' as const };

  return {
    data: { name, description, icon, capacity, open_hour, close_hour, slot_minutes, booking_window_days, active, admin_notes },
  };
}

function reservationPeople(row: { expected_guests?: number | null }): number {
  return 1 + Math.max(0, Number(row.expected_guests || 0));
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const includeInactive = req.user!.role === 'board_admin' && req.query.include_inactive === '1';
  const rows = db.prepare(
    `SELECT * FROM amenities
     WHERE condominium_id = ? AND (? = 1 OR active = 1)
     ORDER BY active DESC, name`
  ).all(req.user!.condominium_id, includeInactive ? 1 : 0);
  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const cleaned = cleanAmenityInput(req.body || {});
  if ('error' in cleaned) return fail(res, String(cleaned.error), 400);
  const a = cleaned.data;
  const row = db.prepare(
    `INSERT INTO amenities (
       condominium_id, name, description, icon, capacity, open_hour, close_hour,
       slot_minutes, booking_window_days, active, admin_notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.user!.condominium_id,
    a.name, a.description, a.icon, a.capacity, a.open_hour, a.close_hour,
    a.slot_minutes, a.booking_window_days, a.active, a.admin_notes,
  );
  audit(req, {
    action: 'amenity.create',
    target_type: 'amenity',
    target_id: Number(row.lastInsertRowid),
    condominium_id: req.user!.condominium_id,
    metadata: { name: a.name, capacity: a.capacity, slot_minutes: a.slot_minutes },
  });
  return ok(res, { id: row.lastInsertRowid, ...a });
});

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    `SELECT * FROM amenities WHERE id = ? AND condominium_id = ?`
  ).get(id, req.user!.condominium_id) as any;
  if (!existing) return fail(res, 'not_found', 404);
  const cleaned = cleanAmenityInput(req.body || {}, existing);
  if ('error' in cleaned) return fail(res, String(cleaned.error), 400);
  const a = cleaned.data;
  db.prepare(
    `UPDATE amenities
     SET name = ?, description = ?, icon = ?, capacity = ?, open_hour = ?, close_hour = ?,
         slot_minutes = ?, booking_window_days = ?, active = ?, admin_notes = ?
     WHERE id = ?`
  ).run(
    a.name, a.description, a.icon, a.capacity, a.open_hour, a.close_hour,
    a.slot_minutes, a.booking_window_days, a.active, a.admin_notes,
    id,
  );
  audit(req, {
    action: 'amenity.update',
    target_type: 'amenity',
    target_id: id,
    condominium_id: req.user!.condominium_id,
    metadata: { name: a.name, capacity: a.capacity, slot_minutes: a.slot_minutes, active: !!a.active },
  });
  return ok(res, { id, ...a });
});

router.delete('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(
    `SELECT * FROM amenities WHERE id = ? AND condominium_id = ?`
  ).get(id, req.user!.condominium_id) as any;
  if (!existing) return fail(res, 'not_found', 404);
  db.prepare(`UPDATE amenities SET active = 0 WHERE id = ?`).run(id);
  audit(req, {
    action: 'amenity.deactivate',
    target_type: 'amenity',
    target_id: id,
    condominium_id: req.user!.condominium_id,
    metadata: { name: existing.name },
  });
  return ok(res, { id, active: 0 });
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

router.get('/:id/slots', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 'invalid_date', 400);

  const amenity = db.prepare(
    `SELECT * FROM amenities WHERE id = ? AND condominium_id = ? AND active = 1`
  ).get(id, req.user!.condominium_id) as any;
  if (!amenity) return fail(res, 'not_found', 404);

  const dayStart = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) return fail(res, 'invalid_date', 400);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDay = new Date(today);
  maxDay.setDate(maxDay.getDate() + amenity.booking_window_days);
  if (dayStart < today || dayStart > maxDay) {
    return ok(res, { amenity_id: id, date, slots: [] });
  }

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const reservations = db.prepare(
    `SELECT starts_at, ends_at, expected_guests
     FROM amenity_reservations
     WHERE amenity_id = ?
       AND status = 'confirmed'
       AND starts_at < ?
       AND ends_at > ?`
  ).all(id, dayEnd.toISOString(), dayStart.toISOString()) as Array<{ starts_at: string; ends_at: string; expected_guests: number }>;

  const slots: Array<{ starts_at: string; ends_at: string; reserved_people: number; available_spots: number; available: boolean }> = [];
  for (let minute = amenity.open_hour * 60; minute + amenity.slot_minutes <= amenity.close_hour * 60; minute += amenity.slot_minutes) {
    const starts = new Date(dayStart);
    starts.setMinutes(minute);
    const ends = new Date(starts);
    ends.setMinutes(ends.getMinutes() + amenity.slot_minutes);
    const reserved_people = reservations.reduce((sum, r) => {
      const rStart = new Date(r.starts_at);
      const rEnd = new Date(r.ends_at);
      return rStart < ends && rEnd > starts ? sum + reservationPeople(r) : sum;
    }, 0);
    const available_spots = Math.max(0, amenity.capacity - reserved_people);
    slots.push({
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      reserved_people,
      available_spots,
      available: available_spots > 0 && starts > new Date(),
    });
  }

  return ok(res, { amenity_id: id, date, slots });
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
    `SELECT id, capacity, open_hour, close_hour, slot_minutes, active FROM amenities WHERE id = ? AND condominium_id = ?`
  ).get(amenity_id, u.condominium_id) as { id: number; capacity: number; open_hour: number; close_hour: number; slot_minutes: number; active: number } | undefined;
  if (!amenity) return fail(res, 'amenity_not_in_condo', 400);
  if (!amenity.active) return fail(res, 'amenity_inactive', 400);

  const sameLocalDay = starts.toDateString() === ends.toDateString();
  const startHour = starts.getHours() + starts.getMinutes() / 60;
  const endHour = ends.getHours() + ends.getMinutes() / 60;
  if (!sameLocalDay || startHour < amenity.open_hour || endHour > amenity.close_hour) {
    return fail(res, 'outside_open_hours', 400);
  }
  const minutes = Math.round((ends.getTime() - starts.getTime()) / 60_000);
  if (minutes !== amenity.slot_minutes) return fail(res, 'invalid_slot_duration', 400);

  const guests = Math.max(0, Math.min(500, parseInt(expected_guests as any) || 0));
  const requestedPeople = 1 + guests;
  if (requestedPeople > Math.max(1, amenity.capacity || 1)) {
    return fail(res, 'over_capacity', 400);
  }

  const overlapping = db.prepare(
    `SELECT COALESCE(SUM(1 + COALESCE(expected_guests, 0)), 0) AS people
     FROM amenity_reservations
     WHERE amenity_id = ?
       AND status = 'confirmed'
       AND starts_at < ?
       AND ends_at > ?`
  ).get(amenity.id, ends.toISOString(), starts.toISOString()) as { people: number };
  if ((overlapping.people || 0) + requestedPeople > Math.max(1, amenity.capacity || 1)) {
    return fail(res, 'amenity_conflict', 409);
  }

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
