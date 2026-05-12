// Concierge ("porteiro") API.
//
// One read endpoint feeds the whole today-view: visitors expected today,
// packages waiting, and amenity reservations starting today (so the
// guard sees the party guest list when 30 people show up at 19h).
//
// Mutation endpoints reuse the existing visitor.arrived + package.pickup
// flows; the concierge gets the same RBAC as a board_admin for those.
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { notifyUsers } from '../lib/whatsapp';

const router = Router();

// Concierges and admins both see the queue. Residents do not.
const requireConciergeOrAdmin = requireRole('concierge', 'board_admin');

router.get('/today', requireAuth, requireConciergeOrAdmin, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);

  // Day-bracket: today 00:00 → tomorrow 00:00 in server TZ. Visitors with no
  // expected_at also surface (open-ended walk-in / delivery requests).
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const startISO = startOfDay.toISOString();
  const endISO = endOfDay.toISOString();

  const weekday = startOfDay.getDay();
  const visitorRows = db.prepare(
    `SELECT v.id, v.visitor_name, v.visitor_type, v.expected_at, v.status, v.notes,
            v.host_id, v.created_at, v.decided_at,
            v.expected_guests, v.guest_list, v.recurring_days, v.recurring_until,
            usr.first_name AS host_first, usr.last_name AS host_last, usr.unit_number
     FROM visitors v
     JOIN users usr ON usr.id = v.host_id
     WHERE v.condominium_id = ?
       AND v.status IN ('pending','approved','arrived')
       AND (
         v.expected_at IS NULL
         OR (v.expected_at >= ? AND v.expected_at < ?)
         OR v.recurring_days IS NOT NULL
       )
     ORDER BY
       CASE v.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
       v.expected_at ASC,
       v.created_at ASC`
  ).all(condoId, startISO, endISO) as any[];

  const visitors = visitorRows.filter((v) => {
    if (!v.recurring_days) return true;
    const days = String(v.recurring_days).split(',').map((d) => Number(d)).filter((d) => Number.isInteger(d));
    if (!days.includes(weekday)) return false;
    if (v.recurring_until) {
      const until = new Date(v.recurring_until);
      until.setHours(23, 59, 59, 999);
      if (until < startOfDay) return false;
    }
    return true;
  });

  const packages = db.prepare(
    `SELECT p.id, p.carrier, p.description, p.arrived_at, p.status,
            usr.first_name, usr.last_name, usr.unit_number
     FROM packages p
     JOIN users usr ON usr.id = p.recipient_id
     WHERE p.condominium_id = ?
       AND p.status = 'waiting'
     ORDER BY p.arrived_at ASC`
  ).all(condoId);

  const amenityParties = db.prepare(
    `SELECT r.id, r.starts_at, r.ends_at, r.expected_guests, r.guest_list, r.notes,
            a.name AS amenity_name, a.icon AS amenity_icon,
            usr.first_name, usr.last_name, usr.unit_number
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     JOIN users usr ON usr.id = r.user_id
     WHERE a.condominium_id = ?
       AND r.status = 'confirmed'
       AND r.starts_at >= ?
       AND r.starts_at < ?
     ORDER BY r.starts_at ASC`
  ).all(condoId, startISO, endISO);

  const visitorParties = visitors
    .filter((v) => v.guest_list || Number(v.expected_guests || 0) > 0)
    .map((v) => ({
      id: `visitor-${v.id}`,
      source: 'visitor',
      starts_at: v.expected_at,
      ends_at: null,
      expected_guests: v.expected_guests,
      guest_list: v.guest_list,
      notes: v.notes,
      amenity_name: v.visitor_name,
      amenity_icon: 'PartyPopper',
      first_name: v.host_first,
      last_name: v.host_last,
      unit_number: v.unit_number,
    }));

  return ok(res, { visitors, packages, parties: [...amenityParties, ...visitorParties], today: startISO });
});

const notifySchema = z.object({
  target_type: z.enum(['visitor', 'package']),
  target_id: z.coerce.number().int().positive(),
  message_type: z.enum(['visitor_arrived', 'package_arrived', 'food_delivery_arrived']).default('visitor_arrived'),
});

router.post('/notify', requireAuth, requireConciergeOrAdmin, async (req: AuthedRequest, res) => {
  const parsed = notifySchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const { target_type, target_id, message_type } = parsed.data;

  let userId: number | null = null;
  let body = '';
  if (target_type === 'visitor') {
    const row = db.prepare(
      `SELECT v.visitor_name, usr.id AS user_id, usr.unit_number
       FROM visitors v
       JOIN users usr ON usr.id = v.host_id
       WHERE v.id = ? AND v.condominium_id = ?`
    ).get(target_id, condoId) as { visitor_name: string; user_id: number; unit_number: string | null } | undefined;
    if (!row) return fail(res, 'not_found', 404);
    userId = row.user_id;
    body = `CondoOS: ${row.visitor_name} arrived at the front desk${row.unit_number ? ` for unit ${row.unit_number}` : ''}.`;
  } else {
    const row = db.prepare(
      `SELECT p.carrier, p.description, usr.id AS user_id, usr.unit_number
       FROM packages p
       JOIN users usr ON usr.id = p.recipient_id
       WHERE p.id = ? AND p.condominium_id = ?`
    ).get(target_id, condoId) as { carrier: string; description: string | null; user_id: number; unit_number: string | null } | undefined;
    if (!row) return fail(res, 'not_found', 404);
    userId = row.user_id;
    const label = message_type === 'food_delivery_arrived' ? 'food delivery' : `${row.carrier} package`;
    body = `CondoOS: your ${label} has arrived at the front desk${row.unit_number ? ` for unit ${row.unit_number}` : ''}.`;
  }

  const result = await notifyUsers([userId], body);
  audit(req, {
    action: 'concierge.notify_resident',
    target_type,
    target_id,
    condominium_id: condoId,
    metadata: { message_type, notified_user_id: userId, attempted: result.attempted, sent: result.sent, skipped: result.skipped },
  });
  return ok(res, { notified_user_id: userId, message_type });
});

// Concierge invites a new concierge user (admin-only — concierges shouldn't
// be able to spawn each other). Bare-bones: just creates the user with a
// known password the admin can rotate later.
//
// Audit M7 — minimum bumped from 6 → 12 chars. A 6-char admin-set password
// is materially weaker than the resident bcrypt baseline and "rotate later"
// rarely happens. A forced-rotation flow (must_change_password column +
// /change-password gate on first login) is a follow-up; bumping the floor
// removes the weakest passwords without that schema change.
const inviteSchema = z.object({
  email: z.string().email(),
  first_name: z.string().min(1).max(60),
  last_name: z.string().min(1).max(60).optional().default(''),
  password: z.string().min(12).max(120),
});

router.post('/invite', requireAuth, requireRole('board_admin'), async (req: AuthedRequest, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const data = parsed.data;

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(data.email);
  if (existing) return fail(res, 'email_taken', 409);

  // Hash the password — bcryptjs imported lazily to keep the route lean.
  const bcrypt = await import('bcryptjs');
  const pwHash = bcrypt.hashSync(data.password, 10);

  const result = db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role)
     VALUES (?, ?, ?, ?, ?, 'concierge')`
  ).run(condoId, data.email, pwHash, data.first_name, data.last_name || '');

  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'concierge.invite',
    target_type: 'user',
    target_id: id,
    condominium_id: condoId,
    metadata: { email: data.email },
  });
  return ok(res, { id, email: data.email, role: 'concierge' }, 201);
});

router.get('/staff', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT id, email, first_name, last_name, created_at
     FROM users
     WHERE condominium_id = ? AND role = 'concierge'
     ORDER BY created_at DESC`
  ).all(condoId);
  return ok(res, rows);
});

export default router;
