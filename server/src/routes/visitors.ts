import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireActiveMembership, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

// Audit M5 — replace the hand-rolled `if (!visitor_name)` check, which let
// `{ name: [1,2,3], unit: null }` slip through with a generic
// missing_visitor_name error, with a typed schema. Now `visitor_name` must be
// a non-empty string and unknown fields are stripped.
const createVisitorSchema = z.object({
  visitor_name: z.string().min(1).max(140),
  visitor_type: z.enum(['guest', 'delivery', 'service', 'rideshare']).default('guest'),
  expected_at: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  pre_approve: z.boolean().optional(),
  expected_guests: z.coerce.number().int().min(0).max(500).optional().default(0),
  guest_list: z.string().max(4000).optional().nullable(),
  recurring_days: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional().default([]),
  recurring_until: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional().nullable(),
});

router.get('/', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
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

router.post('/', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const u = req.user!;
  const parsed = createVisitorSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const {
    visitor_name, visitor_type, expected_at, notes, pre_approve,
    expected_guests, guest_list, recurring_days, recurring_until,
  } = parsed.data;
  const cleanGuestList = guest_list
    ? guest_list.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n').slice(0, 4000)
    : null;
  const cleanRecurringDays = Array.from(new Set(recurring_days || [])).sort((a, b) => a - b);
  const isRecurring = cleanRecurringDays.length > 0;

  // Pre-approval (#9 in the QA checklist): when the resident books a future
  // visit, the host is the one approving — so we set status='approved'
  // immediately and stamp decided_at. Ad-hoc walk-ups stay pending until the
  // resident (or an admin) approves; the concierge only notifies/calls.
  const status = pre_approve === true || isRecurring || cleanGuestList ? 'approved' : 'pending';
  const decidedAt = status === 'approved' ? new Date().toISOString() : null;

  const row = db.prepare(
    `INSERT INTO visitors (
       condominium_id, host_id, visitor_name, visitor_type, expected_at, notes,
       status, decided_at, expected_guests, guest_list, recurring_days, recurring_until
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    u.condominium_id, u.id,
    visitor_name, visitor_type,
    expected_at || null, notes || null,
    status, decidedAt,
    expected_guests, cleanGuestList,
    isRecurring ? cleanRecurringDays.join(',') : null,
    recurring_until || null,
  );
  audit(req, {
    action: 'visitor.create',
    target_type: 'visitor',
    target_id: Number(row.lastInsertRowid),
    condominium_id: u.condominium_id,
    metadata: {
      visitor_type,
      pre_approve: pre_approve === true,
      expected_guests,
      has_guest_list: !!cleanGuestList,
      recurring_days: cleanRecurringDays,
    },
  });
  return ok(res, { id: row.lastInsertRowid, status });
});

// Does the caller share at least one active unit with the visitor host?
// Lets a partner / tenant on the same user_unit decide or confirm arrivals
// when the original host isn't reachable — the realistic family case.
function callerSharesUnitWithHost(hostId: number, callerId: number, condoId: number | null): boolean {
  if (!condoId) return false;
  if (hostId === callerId) return true;
  const row = db.prepare(
    `SELECT 1 AS hit
     FROM user_unit a
     JOIN user_unit b ON a.unit_id = b.unit_id
     JOIN units un ON un.id = a.unit_id
     JOIN buildings bld ON bld.id = un.building_id
     WHERE a.user_id = ? AND b.user_id = ?
       AND a.status = 'active' AND b.status = 'active'
       AND bld.condominium_id = ?
     LIMIT 1`
  ).get(hostId, callerId, condoId);
  return !!row;
}

router.post('/:id/decide', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  if (!['approved', 'denied'].includes(decision)) return fail(res, 'invalid_decision');
  const v = db.prepare(`SELECT id, host_id, condominium_id FROM visitors WHERE id=? AND condominium_id=?`).get(id, u.condominium_id) as
    | { id: number; host_id: number; condominium_id: number }
    | undefined;
  if (!v) return fail(res, 'not_found', 404);
  const canDecide = u.role === 'board_admin' || callerSharesUnitWithHost(v.host_id, u.id, u.condominium_id);
  if (!canDecide) return fail(res, 'forbidden', 403);
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

router.post('/:id/arrived', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  // Audit N3 — previously any resident in the condo could mark any visitor
  // (including someone else's pending visitor) as arrived. The intended gate
  // is "the resident hosting this visitor confirms the arrival OR a staff
  // member (concierge / board_admin) does it on their behalf". So either
  // the row's host_id matches the caller or the caller is staff.
  const u = req.user!;
  const id = Number(req.params.id);
  const v = db.prepare(
    `SELECT id, host_id FROM visitors WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as { id: number; host_id: number } | undefined;
  if (!v) return fail(res, 'not_found', 404);
  const isStaff = u.role === 'board_admin' || u.role === 'concierge';
  // Unit co-occupants (partner/tenant on the same active user_unit) can
  // confirm arrival when the host isn't reachable — same family unit.
  if (!isStaff && !callerSharesUnitWithHost(v.host_id, u.id, u.condominium_id)) {
    return fail(res, 'forbidden', 403);
  }
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
