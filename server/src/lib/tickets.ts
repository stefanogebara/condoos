import db from '../db';

export function canAssignTicketToUser(userId: number, condoId: number): boolean {
  return !!db.prepare(
    `SELECT 1
     FROM users usr
     JOIN user_unit uu ON uu.user_id = usr.id AND uu.status = 'active'
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE usr.id = ?
       AND usr.role = 'board_admin'
       AND b.condominium_id = ?
     LIMIT 1`
  ).get(userId, condoId);
}

export function markTicketAgentFailed(ticketId: number): boolean {
  const result = db.prepare(
    `UPDATE tickets
     SET remediation_status = 'blocked_needs_admin',
         blocked_reason = 'agent_failed',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status NOT IN ('resolved','closed')
       AND remediation_status NOT IN ('resolved','blocked_needs_admin')`
  ).run(ticketId);
  return result.changes > 0;
}
