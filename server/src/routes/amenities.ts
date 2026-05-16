import { Router } from 'express';
import db from '../db';
import { requireAuth, requireActiveMembership, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { notifyUsers } from '../lib/whatsapp';

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

function shortWhen(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function boardAdminIds(condoId: number) {
  const rows = db.prepare(
    `SELECT id FROM users WHERE condominium_id = ? AND role = 'board_admin'`
  ).all(condoId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function queueWhatsAppReminder(userId: number, startsAt: Date, body: string) {
  const row = db.prepare(
    `SELECT phone, whatsapp_opt_in FROM users WHERE id = ?`
  ).get(userId) as { phone: string | null; whatsapp_opt_in: number } | undefined;
  const sendAt = new Date(startsAt.getTime() - 30 * 60_000);
  const nextAttemptAt = sendAt > new Date() ? sendAt.toISOString().slice(0, 19).replace('T', ' ') : null;
  const canSend = !!row?.phone && row.whatsapp_opt_in === 1;
  db.prepare(
    `INSERT INTO notification_outbox
       (channel, user_id, phone, body, status, last_error, next_attempt_at)
     VALUES ('whatsapp', ?, ?, ?, ?, ?, ?)`
  ).run(userId, row?.phone || null, body, canSend ? 'pending' : 'skipped', canSend ? null : 'missing_phone_or_opt_in', nextAttemptAt);
}

function weeklyBookingWindow(now = new Date()) {
  const openAt = new Date(now);
  openAt.setHours(12, 0, 0, 0);
  openAt.setDate(openAt.getDate() - openAt.getDay());
  if (now < openAt) openAt.setDate(openAt.getDate() - 7);
  const weekStart = new Date(openAt);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const nextOpenAt = new Date(openAt);
  nextOpenAt.setDate(nextOpenAt.getDate() + 7);
  return { openAt, weekStart, weekEnd, nextOpenAt };
}

function withinOpenReservationWeek(starts: Date) {
  const { weekStart, weekEnd } = weeklyBookingWindow();
  return starts >= weekStart && starts < weekEnd;
}

router.get('/', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const includeInactive = req.user!.role === 'board_admin' && req.query.include_inactive === '1';
  const rows = db.prepare(
    `SELECT * FROM amenities
     WHERE condominium_id = ? AND (? = 1 OR active = 1)
     ORDER BY active DESC, name`
  ).all(req.user!.condominium_id, includeInactive ? 1 : 0);
  return ok(res, rows);
});

router.post('/', requireAuth, requireActiveMembership, requireRole('board_admin'), (req: AuthedRequest, res) => {
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

router.patch('/:id', requireAuth, requireActiveMembership, requireRole('board_admin'), (req: AuthedRequest, res) => {
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

router.delete('/:id', requireAuth, requireActiveMembership, requireRole('board_admin'), (req: AuthedRequest, res) => {
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

router.get('/reservations', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT r.*, a.name AS amenity_name, a.icon AS amenity_icon,
            usr.first_name, usr.last_name, usr.unit_number
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     JOIN users usr ON usr.id = r.user_id
     WHERE a.condominium_id = ?
     ORDER BY r.starts_at ASC`
  ).all(u.condominium_id) as any[];
  // Privacy gate: residents used to see every neighbour's full name,
  // unit, party guest count, and free-text cancellation reason — a
  // public schedule that doubled as a social map. For non-owner
  // residents we now show first-name-only and strip the sensitive
  // fields; the owner of the reservation + staff see their own
  // full row.
  const isStaff = u.role === 'board_admin' || u.role === 'concierge';
  const safeRows = isStaff
    ? rows
    : rows.map((r) => {
      if (r.user_id === u.id) return r;
      return {
        ...r,
        last_name: null,
        unit_number: null,
        expected_guests: null,
        guest_list: null,
        cancel_reason: null,
        notes: null,
      };
    });
  return ok(res, safeRows);
});

router.get('/:id/slots', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
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
  const { openAt, weekStart, weekEnd, nextOpenAt } = weeklyBookingWindow();
  if (dayStart < today || dayStart < weekStart || dayStart >= weekEnd) {
    return ok(res, {
      amenity_id: id,
      date,
      booking_opens_at: openAt.toISOString(),
      booking_closes_at: weekEnd.toISOString(),
      next_booking_opens_at: nextOpenAt.toISOString(),
      slots: [],
    });
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

  return ok(res, {
    amenity_id: id,
    date,
    booking_opens_at: openAt.toISOString(),
    booking_closes_at: weekEnd.toISOString(),
    next_booking_opens_at: nextOpenAt.toISOString(),
    slots,
  });
});

router.post('/reservations', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const u = req.user!;
  const { amenity_id, starts_at, ends_at, expected_guests, guest_list, notes } = req.body || {};
  if (!amenity_id || !starts_at || !ends_at) return fail(res, 'missing_fields');
  const starts = new Date(starts_at);
  const ends = new Date(ends_at);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    return fail(res, 'invalid_time', 400);
  }
  if (ends <= starts) return fail(res, 'ends_must_be_after_starts', 400);
  if (!withinOpenReservationWeek(starts)) return fail(res, 'outside_booking_window', 400);

  // Amenity must belong to the user's condo.
  const amenity = db.prepare(
    `SELECT id, name, capacity, open_hour, close_hour, slot_minutes, active FROM amenities WHERE id = ? AND condominium_id = ?`
  ).get(amenity_id, u.condominium_id) as { id: number; name: string; capacity: number; open_hour: number; close_hour: number; slot_minutes: number; active: number } | undefined;
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
  void notifyUsers([u.id], `CondoOS: reservation confirmed for ${amenity.name} on ${shortWhen(starts.toISOString())}.`).catch((err) => {
    console.warn('[amenities/reservation_create] notify resident failed:', err?.message || err);
  });
  const admins = boardAdminIds(u.condominium_id!).filter((id) => id !== u.id);
  if (admins.length) {
    void notifyUsers(admins, `CondoOS: ${u.first_name} ${u.last_name} booked ${amenity.name} on ${shortWhen(starts.toISOString())}.`).catch((err) => {
      console.warn('[amenities/reservation_create] notify admins failed:', err?.message || err);
    });
  }
  queueWhatsAppReminder(u.id, starts, `CondoOS reminder: ${amenity.name} reservation starts soon at ${shortWhen(starts.toISOString())}.`);
  return ok(res, { id: row.lastInsertRowid, expected_guests: guests });
});

router.delete('/reservations/:id', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  const row = db.prepare(
    `SELECT r.*, a.condominium_id, a.name AS amenity_name, usr.first_name, usr.last_name
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     JOIN users usr ON usr.id = r.user_id
     WHERE r.id = ?`
  ).get(id) as any;
  if (!row || row.condominium_id !== u.condominium_id) return fail(res, 'not_found', 404);
  if (u.role !== 'board_admin' && row.user_id !== u.id) return fail(res, 'forbidden', 403);
  db.prepare(
    `UPDATE amenity_reservations
     SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP, cancelled_by_user_id=?, cancel_reason=?
     WHERE id = ?`
  ).run(u.id, reason || null, id);
  audit(req, {
    action: 'amenity.reservation_cancel',
    target_type: 'amenity_reservation',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { amenity_id: row.amenity_id, reason: reason || null },
  });
  const actor = u.role === 'board_admin' && u.id !== row.user_id ? 'Admin' : 'Resident';
  const message = `CondoOS: ${actor} cancelled ${row.amenity_name} reservation for ${shortWhen(row.starts_at)}${reason ? `. Reason: ${reason}` : '.'}`;
  void notifyUsers([row.user_id], message).catch((err) => {
    console.warn('[amenities/reservation_cancel] notify resident failed:', err?.message || err);
  });
  if (u.role !== 'board_admin') {
    const admins = boardAdminIds(u.condominium_id!).filter((adminId) => adminId !== u.id);
    if (admins.length) {
      void notifyUsers(admins, `${u.first_name} ${u.last_name} cancelled ${row.amenity_name} reservation for ${shortWhen(row.starts_at)}.`).catch((err) => {
        console.warn('[amenities/reservation_cancel] notify admins failed:', err?.message || err);
      });
    }
  }
  return ok(res, { id, status: 'cancelled', cancel_reason: reason || null });
});

export default router;
