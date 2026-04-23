// /api/memberships — board admin pending-queue + member management.
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

const router = Router();

// GET /api/memberships/pending — all pending claims in admin's condo
router.get('/pending', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT uu.id, uu.relationship, uu.primary_contact, uu.created_at,
            usr.id AS user_id, usr.email, usr.first_name, usr.last_name, usr.avatar_url,
            un.id AS unit_id, un.number AS unit_number, un.floor,
            b.name AS building_name
     FROM user_unit uu
     JOIN users usr ON usr.id = uu.user_id
     JOIN units un  ON un.id  = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE b.condominium_id = ? AND uu.status = 'pending'
     ORDER BY uu.created_at ASC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

// POST /api/memberships/:id/approve
router.post('/:id/approve', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const u = req.user!;

  const row = db.prepare(
    `SELECT uu.id, uu.user_id, uu.unit_id, uu.status,
            un.number AS unit_number, b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ?`
  ).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (row.condominium_id !== u.condominium_id) return fail(res, 'forbidden', 403);
  if (row.status !== 'pending') return fail(res, 'not_pending', 409);

  db.transaction(() => {
    db.prepare(
      `UPDATE user_unit
       SET status = 'active', move_in_date = COALESCE(move_in_date, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);
    db.prepare(
      `UPDATE users SET condominium_id = ?, unit_number = ? WHERE id = ?`
    ).run(row.condominium_id, row.unit_number, row.user_id);
  })();

  return ok(res, { id, status: 'active' });
});

// POST /api/memberships/:id/deny
router.post('/:id/deny', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const u = req.user!;
  const row = db.prepare(
    `SELECT uu.id, uu.status, b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ?`
  ).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (row.condominium_id !== u.condominium_id) return fail(res, 'forbidden', 403);
  db.prepare(`UPDATE user_unit SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  return ok(res, { id, status: 'revoked' });
});

// POST /api/memberships/:id/reassign  — move a pending claim to a different unit
const reassignSchema = z.object({ unit_id: z.number().int() });
router.post('/:id/reassign', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = reassignSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const id = Number(req.params.id);
  const u = req.user!;
  const row = db.prepare(
    `SELECT uu.id, uu.status, b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ?`
  ).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (row.condominium_id !== u.condominium_id) return fail(res, 'forbidden', 403);

  const newUnit = db.prepare(
    `SELECT u.id, b.condominium_id FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = ?`
  ).get(parsed.data.unit_id) as any;
  if (!newUnit || newUnit.condominium_id !== u.condominium_id)
    return fail(res, 'unit_not_in_condo', 400);
  db.prepare(`UPDATE user_unit SET unit_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(parsed.data.unit_id, id);
  return ok(res, { id, unit_id: parsed.data.unit_id });
});

export default router;
