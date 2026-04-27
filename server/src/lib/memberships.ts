import db from '../db';

export type MembershipStatus = 'pending' | 'active' | 'revoked' | 'moved_out';
export type Relationship = 'owner' | 'tenant' | 'occupant';

export interface MembershipScope {
  id: number;
  user_id: number;
  unit_id: number;
  status: MembershipStatus;
  relationship: Relationship;
  primary_contact: number;
  voting_weight: number;
  unit_number: string;
  condominium_id: number;
}

export interface MembershipHistoryRow {
  id: number;
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  unit_id: number;
  unit_number: string;
  building_name: string;
  relationship: Relationship;
  status: MembershipStatus;
  primary_contact: number;
  voting_weight: number;
  move_in_date: string | null;
  move_out_date: string | null;
  created_at: string;
  updated_at: string;
}

export function getMembershipInCondo(id: number, condoId: number): MembershipScope | null {
  const row = db.prepare(
    `SELECT uu.id, uu.user_id, uu.unit_id, uu.status, uu.relationship,
            uu.primary_contact, uu.voting_weight,
            un.number AS unit_number,
            b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ? AND b.condominium_id = ?`
  ).get(id, condoId) as MembershipScope | undefined;
  return row || null;
}

export function unitBelongsToCondo(unitId: number, condoId: number): { id: number; number: string } | null {
  const row = db.prepare(
    `SELECT un.id, un.number
     FROM units un
     JOIN buildings b ON b.id = un.building_id
     WHERE un.id = ? AND b.condominium_id = ?`
  ).get(unitId, condoId) as { id: number; number: string } | undefined;
  return row || null;
}

function refreshUserActiveCondo(userId: number) {
  const active = db.prepare(
    `SELECT b.condominium_id, un.number AS unit_number
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.user_id = ? AND uu.status = 'active'
     ORDER BY uu.primary_contact DESC, uu.updated_at DESC, uu.id DESC
     LIMIT 1`
  ).get(userId) as { condominium_id: number; unit_number: string } | undefined;

  db.prepare(`UPDATE users SET condominium_id = ?, unit_number = ? WHERE id = ?`)
    .run(active?.condominium_id || null, active?.unit_number || null, userId);
}

export function moveOutMembership(id: number, condoId: number, moveOutDate: string) {
  const membership = getMembershipInCondo(id, condoId);
  if (!membership) return { ok: false as const, error: 'not_found', status: 404 };
  if (membership.status !== 'active' && membership.status !== 'pending') {
    return { ok: false as const, error: 'not_active_or_pending', status: 409 };
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE user_unit
       SET status = 'moved_out',
           primary_contact = 0,
           move_out_date = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(moveOutDate, id);
    refreshUserActiveCondo(membership.user_id);
  });
  tx();

  return { ok: true as const, id, user_id: membership.user_id, unit_id: membership.unit_id, status: 'moved_out' as const };
}

export function reactivateMembership(id: number, condoId: number) {
  const membership = getMembershipInCondo(id, condoId);
  if (!membership) return { ok: false as const, error: 'not_found', status: 404 };
  if (membership.status === 'active') {
    return { ok: false as const, error: 'already_active', status: 409 };
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE user_unit
       SET status = 'active',
           primary_contact = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM user_unit other
               WHERE other.unit_id = user_unit.unit_id
                 AND other.status = 'active'
                 AND other.primary_contact = 1
                 AND other.id <> user_unit.id
             )
             THEN 1
             ELSE primary_contact
           END,
           move_out_date = NULL,
           move_in_date = COALESCE(move_in_date, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);
    refreshUserActiveCondo(membership.user_id);
  });
  tx();

  return { ok: true as const, id, user_id: membership.user_id, unit_id: membership.unit_id, status: 'active' as const };
}

export function transferUnit(input: {
  fromMembershipId: number;
  toUnitId: number;
  condoId: number;
  moveOutDate: string;
  moveInDate?: string | null;
  relationship?: Relationship;
  primaryContact?: boolean;
  votingWeight?: number;
}) {
  const from = getMembershipInCondo(input.fromMembershipId, input.condoId);
  if (!from) return { ok: false as const, error: 'membership_not_found', status: 404 };
  if (from.status !== 'active' && from.status !== 'pending') {
    return { ok: false as const, error: 'not_active_or_pending', status: 409 };
  }

  const unit = unitBelongsToCondo(input.toUnitId, input.condoId);
  if (!unit) return { ok: false as const, error: 'unit_not_in_condo', status: 400 };

  const existing = db.prepare(
    `SELECT id FROM user_unit
     WHERE user_id = ? AND unit_id = ? AND status IN ('pending','active')`
  ).get(from.user_id, input.toUnitId);
  if (existing) return { ok: false as const, error: 'already_has_target_unit', status: 409 };

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE user_unit
       SET status = 'moved_out',
           primary_contact = 0,
           move_out_date = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(input.moveOutDate, from.id);

    const result = db.prepare(
      `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      from.user_id,
      input.toUnitId,
      input.relationship || from.relationship,
      input.primaryContact === undefined ? from.primary_contact : input.primaryContact ? 1 : 0,
      input.votingWeight ?? from.voting_weight,
      input.moveInDate || new Date().toISOString(),
    );

    db.prepare(`UPDATE users SET condominium_id = ?, unit_number = ? WHERE id = ?`)
      .run(input.condoId, unit.number, from.user_id);
    return Number(result.lastInsertRowid);
  });

  const newMembershipId = tx();
  return {
    ok: true as const,
    moved_out_id: from.id,
    new_membership_id: newMembershipId,
    user_id: from.user_id,
    unit_id: input.toUnitId,
  };
}

export function listUnitMembershipHistory(unitId: number, condoId: number): MembershipHistoryRow[] {
  return db.prepare(
    `SELECT uu.id, uu.user_id, usr.email, usr.first_name, usr.last_name,
            uu.unit_id, un.number AS unit_number, b.name AS building_name,
            uu.relationship, uu.status, uu.primary_contact, uu.voting_weight,
            uu.move_in_date, uu.move_out_date, uu.created_at, uu.updated_at
     FROM user_unit uu
     JOIN users usr ON usr.id = uu.user_id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.unit_id = ? AND b.condominium_id = ? AND uu.status IN ('moved_out','revoked')
     ORDER BY COALESCE(uu.move_out_date, uu.updated_at, uu.created_at) DESC`
  ).all(unitId, condoId) as MembershipHistoryRow[];
}

export function listUserMembershipHistory(userId: number): MembershipHistoryRow[] {
  return db.prepare(
    `SELECT uu.id, uu.user_id, usr.email, usr.first_name, usr.last_name,
            uu.unit_id, un.number AS unit_number, b.name AS building_name,
            uu.relationship, uu.status, uu.primary_contact, uu.voting_weight,
            uu.move_in_date, uu.move_out_date, uu.created_at, uu.updated_at
     FROM user_unit uu
     JOIN users usr ON usr.id = uu.user_id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.user_id = ? AND uu.status IN ('moved_out','revoked')
     ORDER BY COALESCE(uu.move_out_date, uu.updated_at, uu.created_at) DESC`
  ).all(userId) as MembershipHistoryRow[];
}
