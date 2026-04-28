import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

const buildingSchema = z.object({
  name: z.string().min(1).max(80),
  floors: z.number().int().min(1).max(120),
  units_per_floor: z.number().int().min(0).max(80).default(0),
  unit_prefix: z.string().max(12).optional().default(''),
});

const renameSchema = z.object({
  name: z.string().min(1).max(80),
  floors: z.number().int().min(1).max(120).optional(),
});

const newUnitSchema = z.object({
  number: z.string().min(1).max(20),
  floor: z.number().int().min(0).max(120).nullable().optional(),
});

function buildingInCondo(buildingId: number, condoId: number): { id: number } | null {
  const row = db.prepare(
    `SELECT id FROM buildings WHERE id = ? AND condominium_id = ?`
  ).get(buildingId, condoId) as { id: number } | undefined;
  return row || null;
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT b.*,
            (SELECT COUNT(*) FROM units u WHERE u.building_id = b.id) AS unit_count
     FROM buildings b
     WHERE b.condominium_id = ?
     ORDER BY b.created_at ASC, b.name ASC`
  ).all(condoId);
  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = buildingSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;

  const tx = db.transaction(() => {
    const buildingId = Number(db.prepare(
      `INSERT INTO buildings (condominium_id, name, floors) VALUES (?, ?, ?)`
    ).run(condoId, body.name, body.floors).lastInsertRowid);

    if (body.units_per_floor > 0) {
      const insertUnit = db.prepare(
        `INSERT INTO units (building_id, floor, number) VALUES (?, ?, ?)`
      );
      for (let floor = 1; floor <= body.floors; floor++) {
        for (let index = 1; index <= body.units_per_floor; index++) {
          const number = `${body.unit_prefix}${floor}${index.toString().padStart(2, '0')}`;
          insertUnit.run(buildingId, floor, number);
        }
      }
    }
    return buildingId;
  });

  const id = tx();
  audit(req, {
    action: 'building.create',
    target_type: 'building',
    target_id: id,
    condominium_id: condoId,
    metadata: { floors: body.floors, units_per_floor: body.units_per_floor },
  });
  return ok(res, { id }, 201);
});

// Rename a building (and optionally update floor count metadata).
router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const buildingId = Number(req.params.id);
  if (!buildingInCondo(buildingId, condoId)) return fail(res, 'not_found', 404);

  if (parsed.data.floors != null) {
    db.prepare(`UPDATE buildings SET name = ?, floors = ? WHERE id = ?`)
      .run(parsed.data.name, parsed.data.floors, buildingId);
  } else {
    db.prepare(`UPDATE buildings SET name = ? WHERE id = ?`)
      .run(parsed.data.name, buildingId);
  }

  audit(req, { action: 'building.rename', target_type: 'building', target_id: buildingId, condominium_id: condoId, metadata: parsed.data });
  return ok(res, { id: buildingId });
});

// Delete a building. Blocked if it still has units (admin must clear them
// first) — keeps the cascade explicit and avoids accidental data loss.
router.delete('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const buildingId = Number(req.params.id);
  if (!buildingInCondo(buildingId, condoId)) return fail(res, 'not_found', 404);

  const unitCount = (db.prepare(`SELECT COUNT(*) AS c FROM units WHERE building_id = ?`)
    .get(buildingId) as { c: number }).c;
  if (unitCount > 0) return fail(res, 'building_has_units', 409);

  db.prepare(`DELETE FROM buildings WHERE id = ?`).run(buildingId);
  audit(req, { action: 'building.delete', target_type: 'building', target_id: buildingId, condominium_id: condoId });
  return ok(res, { id: buildingId });
});

// List units in a building.
router.get('/:id/units', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const buildingId = Number(req.params.id);
  if (!buildingInCondo(buildingId, condoId)) return fail(res, 'not_found', 404);

  const rows = db.prepare(
    `SELECT u.id, u.floor, u.number,
            (SELECT COUNT(*) FROM user_unit uu WHERE uu.unit_id = u.id AND uu.status IN ('active','pending')) AS active_claims
     FROM units u
     WHERE u.building_id = ?
     ORDER BY CASE WHEN u.floor IS NULL THEN 9999 ELSE u.floor END, u.number`
  ).all(buildingId);
  return ok(res, rows);
});

// Add a single unit to a building.
router.post('/:id/units', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = newUnitSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const buildingId = Number(req.params.id);
  if (!buildingInCondo(buildingId, condoId)) return fail(res, 'not_found', 404);

  const number = parsed.data.number.trim();
  const dupe = db.prepare(
    `SELECT id FROM units WHERE building_id = ? AND number = ?`
  ).get(buildingId, number);
  if (dupe) return fail(res, 'duplicate_number', 409);

  const id = Number(db.prepare(
    `INSERT INTO units (building_id, floor, number) VALUES (?, ?, ?)`
  ).run(buildingId, parsed.data.floor ?? null, number).lastInsertRowid);

  audit(req, { action: 'unit.create', target_type: 'unit', target_id: id, condominium_id: condoId, metadata: { building_id: buildingId, number } });
  return ok(res, { id, building_id: buildingId, number, floor: parsed.data.floor ?? null }, 201);
});

export default router;
