import db from '../db';

export interface InviteClaimUser {
  id: number;
  email: string;
  condominium_id: number | null;
  unit_number: string | null;
}

interface PendingInvite {
  id: number;
  condominium_id: number;
  unit_id: number;
  unit_number: string;
  relationship: 'owner' | 'tenant' | 'occupant';
  primary_contact: number;
  voting_weight: number;
}

export function claimPendingInvitesForUser(user: InviteClaimUser): number {
  const pendingInvites = db.prepare(
    `SELECT i.id, i.condominium_id, i.unit_id, i.relationship, i.primary_contact,
            i.voting_weight, un.number AS unit_number
     FROM invites i
     JOIN units un ON un.id = i.unit_id
     WHERE LOWER(i.email) = LOWER(?) AND i.status = 'pending'`
  ).all(user.email) as PendingInvite[];

  if (pendingInvites.length === 0) return 0;

  const claimTx = db.transaction(() => {
    for (const inv of pendingInvites) {
      const existing = db.prepare(
        `SELECT id FROM user_unit WHERE user_id = ? AND unit_id = ? AND status = 'active'`
      ).get(user.id, inv.unit_id);

      if (!existing) {
        db.prepare(
          `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
           VALUES (?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)`
        ).run(
          user.id,
          inv.unit_id,
          inv.relationship,
          inv.primary_contact ? 1 : 0,
          Number(inv.voting_weight || 1),
        );
      }

      db.prepare(`UPDATE invites SET status = 'claimed', claimed_by_user_id = ? WHERE id = ?`)
        .run(user.id, inv.id);
    }

    const primary = pendingInvites[0];
    db.prepare(`UPDATE users SET condominium_id = ?, unit_number = ? WHERE id = ?`)
      .run(primary.condominium_id, primary.unit_number, user.id);
    user.condominium_id = primary.condominium_id;
    user.unit_number = primary.unit_number;
  });

  claimTx();
  return pendingInvites.length;
}
