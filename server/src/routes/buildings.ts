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

export default router;
