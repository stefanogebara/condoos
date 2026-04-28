// Per-unit edits: rename, change floor, delete.
//
// All endpoints require board_admin. Delete is blocked when an active or
// pending user_unit row points at the unit — an admin has to move those
// memberships out first via /memberships before nuking the row, otherwise
// we'd silently orphan claims.
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

const updateSchema = z.object({
  number: z.string().min(1).max(20).optional(),
  floor: z.number().int().min(0).max(120).nullable().optional(),
});

interface UnitRow {
  id: number;
  number: string;
  floor: number | null;
  building_id: number;
  condominium_id: number;
}

function unitInCondo(unitId: number, condoId: number): UnitRow | null {
  const row = db.prepare(
    `SELECT u.id, u.number, u.floor, u.building_id, b.condominium_id
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE u.id = ? AND b.condominium_id = ?`
  ).get(unitId, condoId) as UnitRow | undefined;
  return row || null;
}

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const unitId = Number(req.params.id);

  const unit = unitInCondo(unitId, condoId);
  if (!unit) return fail(res, 'not_found', 404);

  const newNumber = parsed.data.number?.trim();
  if (newNumber && newNumber !== unit.number) {
    const dupe = db.prepare(
      `SELECT id FROM units WHERE building_id = ? AND number = ? AND id != ?`
    ).get(unit.building_id, newNumber, unitId);
    if (dupe) return fail(res, 'duplicate_number', 409);
  }

  const nextNumber = newNumber || unit.number;
  const nextFloor = parsed.data.floor !== undefined ? parsed.data.floor : unit.floor;
  db.prepare(`UPDATE units SET number = ?, floor = ? WHERE id = ?`)
    .run(nextNumber, nextFloor, unitId);

  // Keep cached users.unit_number coherent — match Brazilian condo expectation
  // that someone's "apto" label updates when the building manager renames it.
  if (newNumber && newNumber !== unit.number) {
    db.prepare(
      `UPDATE users SET unit_number = ?
       WHERE id IN (
         SELECT uu.user_id FROM user_unit uu
         WHERE uu.unit_id = ? AND uu.status = 'active'
       )`
    ).run(newNumber, unitId);
  }

  audit(req, {
    action: 'unit.update',
    target_type: 'unit',
    target_id: unitId,
    condominium_id: condoId,
    metadata: { from: { number: unit.number, floor: unit.floor }, to: { number: nextNumber, floor: nextFloor } },
  });
  return ok(res, { id: unitId, number: nextNumber, floor: nextFloor });
});

router.delete('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const unitId = Number(req.params.id);

  const unit = unitInCondo(unitId, condoId);
  if (!unit) return fail(res, 'not_found', 404);

  const claims = (db.prepare(
    `SELECT COUNT(*) AS c FROM user_unit WHERE unit_id = ? AND status IN ('active','pending')`
  ).get(unitId) as { c: number }).c;
  if (claims > 0) return fail(res, 'unit_has_active_claims', 409);

  db.prepare(`DELETE FROM units WHERE id = ?`).run(unitId);
  audit(req, { action: 'unit.delete', target_type: 'unit', target_id: unitId, condominium_id: condoId, metadata: { number: unit.number } });
  return ok(res, { id: unitId });
});

export default router;
