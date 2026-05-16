import db from '../db';

export type TicketEventVisibility = 'resident' | 'admin';

export interface TicketEventInput {
  ticketId: number;
  condoId: number;
  actorUserId?: number | null;
  eventType: string;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  visibility?: TicketEventVisibility;
}

export interface TicketTimelineEvent {
  id: number;
  ticket_id: number;
  condominium_id: number;
  actor_user_id: number | null;
  event_type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  visibility: TicketEventVisibility;
  created_at: string;
  actor_first: string | null;
  actor_last: string | null;
}

export function recordTicketEvent(input: TicketEventInput): number {
  const visibility = input.visibility || 'resident';
  const title = input.title.trim();
  const eventType = input.eventType.trim();
  if (!eventType || !title) return 0;
  const metadataJson = input.metadata && Object.keys(input.metadata).length > 0
    ? JSON.stringify(input.metadata)
    : null;
  const result = db.prepare(
    `INSERT INTO ticket_events (
       ticket_id, condominium_id, actor_user_id, event_type, title, body, metadata_json, visibility
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.ticketId,
    input.condoId,
    input.actorUserId || null,
    eventType.slice(0, 120),
    title.slice(0, 180),
    input.body ? input.body.slice(0, 2_000) : null,
    metadataJson,
    visibility,
  );
  return Number(result.lastInsertRowid);
}

export function listTicketTimeline(params: {
  ticketId: number;
  condoId: number;
  role: string;
}): TicketTimelineEvent[] {
  const isAdmin = params.role === 'board_admin';
  const rows = db.prepare(
    `SELECT e.*,
            u.first_name AS actor_first,
            u.last_name AS actor_last
     FROM ticket_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.ticket_id = ?
       AND e.condominium_id = ?
       AND (? = 1 OR e.visibility = 'resident')
     ORDER BY e.created_at ASC, e.id ASC`
  ).all(params.ticketId, params.condoId, isAdmin ? 1 : 0) as Array<Omit<TicketTimelineEvent, 'metadata'> & { metadata_json: string | null }>;

  return rows.map((row) => {
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata_json) {
      try {
        const parsed = JSON.parse(row.metadata_json);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = null;
      }
    }
    const { metadata_json: _metadataJson, ...rest } = row;
    return { ...rest, metadata };
  });
}

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
