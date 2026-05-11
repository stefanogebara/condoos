// SLA escalator — closes the no-response leg of the incident loop.
//
// When the admin (or the auto-dispatch path) sends a vendor a WhatsApp / email
// outreach, the ticket flips to remediation_status='awaiting_vendor'. The
// inbound-webhook path moves it to 'vendor_engaged' when the vendor replies.
// But vendors ghost. Without this loop, a ticket can sit in awaiting_vendor
// forever and the admin never sees it again unless they go looking. This
// scanner:
//
//   1. finds tickets in remediation_status='awaiting_vendor' whose most
//      recent dispatch is older than the priority-based SLA window AND has
//      no response,
//   2. flips them to blocked_needs_admin with blocked_reason='vendor_no_response',
//   3. notifies every board_admin in the condo so they can act (re-dispatch
//      a different vendor, escalate, or resolve directly).
//
// The vendor-add auto-rewire only fires for blocked_reason='no_vendor_in_category',
// so SLA-breached tickets stay surfaced until the admin actively handles them.
// If the vendor does reply late, the existing inbound webhook will flip the
// dispatch to 'responded' regardless; the admin's manual recovery path is
// just one option.

import db from '../db';
import { notifyUsers } from './whatsapp';

// Priority-based SLA windows in seconds. Tuned for residential operations:
// urgent (gas leak / fire / elevator entrapment) gets 2h before escalation,
// normal day-to-day maintenance gets 24h. Values fall back to the 'normal'
// tier for any priority the planner didn't anticipate.
const SLA_SECONDS_BY_PRIORITY: Record<string, number> = {
  urgent: 2 * 3600,
  high:   6 * 3600,
  normal: 24 * 3600,
  low:    48 * 3600,
};

function slaForPriority(priority: string | null | undefined): number {
  return SLA_SECONDS_BY_PRIORITY[priority || 'normal'] ?? SLA_SECONDS_BY_PRIORITY.normal;
}

interface BreachCandidate {
  ticket_id: number;
  condominium_id: number;
  title: string;
  priority: string;
  last_dispatch_at: string;
  last_dispatch_age_seconds: number;
}

// Single SQL pass — find tickets in awaiting_vendor whose most recent
// dispatch is past its SLA window with no response. Using a correlated
// subquery for the latest dispatch keeps the result one row per ticket.
function findBreachedTickets(): BreachCandidate[] {
  const rows = db.prepare(
    `SELECT t.id            AS ticket_id,
            t.condominium_id,
            t.title,
            t.priority,
            d.created_at    AS last_dispatch_at,
            CAST(strftime('%s', 'now') - strftime('%s', d.created_at) AS INTEGER) AS last_dispatch_age_seconds
     FROM tickets t
     JOIN ticket_dispatches d ON d.ticket_id = t.id
     WHERE t.remediation_status = 'awaiting_vendor'
       AND d.created_at = (
         SELECT MAX(d2.created_at)
         FROM ticket_dispatches d2
         WHERE d2.ticket_id = t.id
       )
       AND d.status IN ('queued', 'sent')
       AND d.responded_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ticket_dispatches d3
         WHERE d3.ticket_id = t.id AND d3.status = 'responded'
       )`
  ).all() as BreachCandidate[];
  return rows.filter((r) => r.last_dispatch_age_seconds >= slaForPriority(r.priority));
}

function adminUserIds(condoId: number): number[] {
  const rows = db.prepare(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN user_unit uu ON uu.user_id = u.id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE b.condominium_id = ?
       AND u.role = 'board_admin'
       AND uu.status = 'active'`
  ).all(condoId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

export interface SlaTickResult {
  scanned: number;
  escalated: number;
  notified: number;
  ticketIds: number[];
}

export async function tickSlaEscalator(): Promise<SlaTickResult> {
  const breached = findBreachedTickets();
  const result: SlaTickResult = { scanned: breached.length, escalated: 0, notified: 0, ticketIds: [] };
  if (breached.length === 0) return result;

  // Escalate each ticket individually so a single broken row doesn't block
  // the rest of the batch. Audit log + notification are best-effort.
  for (const row of breached) {
    try {
      const update = db.prepare(
        `UPDATE tickets
         SET remediation_status = 'blocked_needs_admin',
             blocked_reason = 'vendor_no_response',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND remediation_status = 'awaiting_vendor'`
      ).run(row.ticket_id);
      if (update.changes === 0) continue;
      result.escalated += 1;
      result.ticketIds.push(row.ticket_id);

      db.prepare(
        `INSERT INTO audit_log (action, target_type, target_id, condominium_id, metadata)
         VALUES ('ticket.sla_breach', 'ticket', ?, ?, ?)`
      ).run(
        row.ticket_id,
        row.condominium_id,
        JSON.stringify({
          priority: row.priority,
          sla_seconds: slaForPriority(row.priority),
          actual_age_seconds: row.last_dispatch_age_seconds,
        })
      );

      // Notify board admins so they see the breach without polling the
      // dashboard. notifyUsers handles opt-in/missing-phone filtering.
      const admins = adminUserIds(row.condominium_id);
      if (admins.length > 0) {
        const hours = Math.round(row.last_dispatch_age_seconds / 3600);
        const msg = `⏱️ Sem resposta do fornecedor em ${hours}h — chamado #${row.ticket_id}: ${row.title}. Verifique e acione outro fornecedor se necessário.`;
        await notifyUsers(admins, msg).catch((err) => {
          console.warn(`[sla] notify failed for ticket ${row.ticket_id}:`, (err as Error)?.message || err);
        });
        result.notified += admins.length;
      }
    } catch (err) {
      console.warn(`[sla] escalation failed for ticket ${row.ticket_id}:`, (err as Error)?.message || err);
    }
  }
  return result;
}

export function startSlaEscalator(intervalMs = 5 * 60_000): NodeJS.Timeout {
  // Boot tick is fire-and-forget so the server's listen callback doesn't
  // wait on a network round-trip from notifyUsers.
  void tickSlaEscalator().catch((err) => console.error('[sla] boot tick error', err));
  return setInterval(() => {
    void tickSlaEscalator().catch((err) => console.error('[sla] tick error', err));
  }, intervalMs);
}
