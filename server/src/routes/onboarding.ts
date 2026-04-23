// Onboarding API.
//   POST /api/onboarding/create-building  — board admin creates a brand new condo
//   GET  /api/onboarding/by-code/:code    — resident looks up a condo by invite code
//   POST /api/onboarding/join             — resident submits claim on a unit
//   GET  /api/onboarding/me               — current user's memberships (pending + active)
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';

const router = Router();

function randomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // avoids 0/O/1/I/L
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const defaultAmenities = [
  { name: 'Rooftop Pool',   description: 'Heated, with sun deck',        icon: 'Waves',       capacity: 20, open_hour: 7,  close_hour: 22 },
  { name: 'Fitness Center', description: 'Full cardio + weights',        icon: 'Dumbbell',    capacity: 15, open_hour: 5,  close_hour: 23 },
  { name: 'BBQ Grill',      description: 'Rooftop grill station',        icon: 'Flame',       capacity: 8,  open_hour: 11, close_hour: 22 },
  { name: 'Party Room',     description: 'Lounge, kitchen, seats 40',    icon: 'PartyPopper', capacity: 40, open_hour: 9,  close_hour: 23 },
];

// ---------------------------------------------------------------------------
// Create a new condo (first admin)
// ---------------------------------------------------------------------------
const createSchema = z.object({
  condoName: z.string().min(2).max(120),
  address: z.string().min(3).max(240),
  buildingName: z.string().min(1).max(60).default('Main Building'),
  floors: z.number().int().min(1).max(80),
  unitsPerFloor: z.number().int().min(1).max(40),
  ownerUnitNumber: z.string().min(1).max(20),       // admin's own unit
  seedAmenities: z.boolean().default(true),
  requireApproval: z.boolean().default(true),
  votingModel: z.enum(['one_per_unit', 'weighted_by_sqft']).default('one_per_unit'),
});

router.post('/create-building', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const u = req.user!;
  const body = parsed.data;

  const tx = db.transaction(() => {
    // 1. Create condo
    const inviteCode = randomCode();
    const condoId = Number(
      db.prepare(
        `INSERT INTO condominiums (name, address, invite_code, voting_model, require_approval, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(body.condoName, body.address, inviteCode, body.votingModel, body.requireApproval ? 1 : 0, u.id).lastInsertRowid
    );

    // 2. Create building
    const buildingId = Number(
      db.prepare(
        `INSERT INTO buildings (condominium_id, name, floors) VALUES (?, ?, ?)`
      ).run(condoId, body.buildingName, body.floors).lastInsertRowid
    );

    // 3. Generate units — floor N, units N01..N{unitsPerFloor}
    const insertUnit = db.prepare(
      `INSERT INTO units (building_id, floor, number) VALUES (?, ?, ?)`
    );
    let ownerUnitId: number | null = null;
    for (let f = 1; f <= body.floors; f++) {
      for (let i = 1; i <= body.unitsPerFloor; i++) {
        const number = `${f}${i.toString().padStart(2, '0')}`;
        const unitId = Number(insertUnit.run(buildingId, f, number).lastInsertRowid);
        if (number === body.ownerUnitNumber) ownerUnitId = unitId;
      }
    }

    // If creator's unit wasn't inside the generated range, add it manually.
    if (!ownerUnitId) {
      ownerUnitId = Number(
        insertUnit.run(buildingId, null, body.ownerUnitNumber).lastInsertRowid
      );
    }

    // 4. Move the creating user into this new condo + promote to board_admin.
    db.prepare(
      `UPDATE users SET condominium_id = ?, role = 'board_admin', unit_number = ? WHERE id = ?`
    ).run(condoId, body.ownerUnitNumber, u.id);

    // 5. Link them to their unit as active owner + primary contact.
    db.prepare(
      `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
       VALUES (?, ?, 'owner', 'active', 1, 1.0, CURRENT_TIMESTAMP)`
    ).run(u.id, ownerUnitId);

    // 6. Seed amenities
    if (body.seedAmenities) {
      const insertAmenity = db.prepare(
        `INSERT INTO amenities (condominium_id, name, description, icon, capacity, open_hour, close_hour)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of defaultAmenities) {
        insertAmenity.run(condoId, a.name, a.description, a.icon, a.capacity, a.open_hour, a.close_hour);
      }
    }

    return { condoId, buildingId, inviteCode };
  });

  const out = tx();
  return ok(res, out);
}));

// ---------------------------------------------------------------------------
// Look up a condo by invite code (public, so join UI can show details)
// ---------------------------------------------------------------------------
router.get('/by-code/:code', asyncHandler(async (req, res) => {
  const code = (req.params.code || '').toUpperCase().trim();
  if (!code) return fail(res, 'missing_code');
  const condo = db.prepare(
    `SELECT c.id, c.name, c.address, c.logo_url, c.require_approval,
            (SELECT name FROM buildings WHERE condominium_id = c.id LIMIT 1) AS building_name
     FROM condominiums c WHERE c.invite_code = ?`
  ).get(code) as any;
  if (!condo) return fail(res, 'unknown_code', 404);

  // Return unclaimed unit list so joiner can pick their apartment.
  const units = db.prepare(
    `SELECT u.id, u.floor, u.number,
            (SELECT COUNT(*) FROM user_unit uu WHERE uu.unit_id = u.id AND uu.status IN ('active','pending')) AS claims
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ?
     ORDER BY CASE WHEN u.floor IS NULL THEN 9999 ELSE u.floor END, u.number`
  ).all(condo.id) as any[];

  return ok(res, {
    condo: { id: condo.id, name: condo.name, address: condo.address, logo_url: condo.logo_url, building_name: condo.building_name, require_approval: !!condo.require_approval },
    units,
  });
}));

// ---------------------------------------------------------------------------
// Resident joins a condo by code + picks a unit + relationship
// ---------------------------------------------------------------------------
const joinSchema = z.object({
  code: z.string().min(4).max(12),
  unit_id: z.number().int(),
  relationship: z.enum(['owner', 'tenant', 'occupant']),
  primary_contact: z.boolean().default(true),
});

router.post('/join', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const u = req.user!;
  const { code, unit_id, relationship, primary_contact } = parsed.data;

  const condo = db.prepare(
    `SELECT id, require_approval FROM condominiums WHERE invite_code = ?`
  ).get(code.toUpperCase().trim()) as { id: number; require_approval: number } | undefined;
  if (!condo) return fail(res, 'invalid_code', 404);

  // Validate unit belongs to this condo
  const unit = db.prepare(
    `SELECT u.id, u.number, b.condominium_id
     FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = ?`
  ).get(unit_id) as { id: number; number: string; condominium_id: number } | undefined;
  if (!unit) return fail(res, 'unit_not_found', 404);
  if (unit.condominium_id !== condo.id) return fail(res, 'unit_wrong_condo', 400);

  // Block duplicate pending/active claim by same user on same unit
  const existing = db.prepare(
    `SELECT id FROM user_unit WHERE user_id = ? AND unit_id = ? AND status IN ('pending','active')`
  ).get(u.id, unit_id);
  if (existing) return fail(res, 'already_claimed', 409);

  const status = condo.require_approval ? 'pending' : 'active';
  const newId = Number(
    db.prepare(
      `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
       VALUES (?, ?, ?, ?, ?, 1.0, ?)`
    ).run(u.id, unit_id, relationship, status, primary_contact ? 1 : 0, status === 'active' ? new Date().toISOString() : null).lastInsertRowid
  );

  // If auto-approved, move the user into this condo too.
  if (status === 'active') {
    db.prepare(
      `UPDATE users SET condominium_id = ?, unit_number = ? WHERE id = ?`
    ).run(condo.id, unit.number, u.id);
  }

  return ok(res, { id: newId, status, condominium_id: condo.id });
}));

// ---------------------------------------------------------------------------
// Current user's memberships (pending + active) — used by first-run routing
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT uu.id, uu.status, uu.relationship, uu.primary_contact, uu.voting_weight,
            uu.move_in_date, u.id AS unit_id, u.number AS unit_number, u.floor,
            b.id AS building_id, b.name AS building_name,
            c.id AS condo_id, c.name AS condo_name, c.address AS condo_address
     FROM user_unit uu
     JOIN units u ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     JOIN condominiums c ON c.id = b.condominium_id
     WHERE uu.user_id = ?
     ORDER BY
       CASE uu.status WHEN 'active' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
       uu.created_at DESC`
  ).all(u.id);
  return ok(res, rows);
});

export default router;
