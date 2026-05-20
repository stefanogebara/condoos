import { Router } from 'express';
import db from '../db';
import { AuthedRequest, requireAuth } from '../lib/auth';
import { ok, asyncHandler } from '../lib/respond';
import { userAgencyMemberships } from '../lib/agencies';

const router = Router();

function count(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count || 0);
}

router.get('/portfolio', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const memberships = userAgencyMemberships(userId);
  if (!memberships.length) return ok(res, { agencies: [] });

  const agencies = memberships.map((membership) => {
    const condos = db.prepare(
      `SELECT c.id, c.name, c.address, c.invite_code
       FROM agency_condominiums ac
       JOIN condominiums c ON c.id = ac.condominium_id
       WHERE ac.agency_id = ?
       ORDER BY c.name`
    ).all(membership.agency_id) as Array<{
      id: number;
      name: string;
      address: string;
      invite_code: string | null;
    }>;

    const buildings = condos.map((condo) => {
      const pendingResidents = count(
        `SELECT COUNT(*) AS count
         FROM user_unit uu
         JOIN units un ON un.id = uu.unit_id
         JOIN buildings b ON b.id = un.building_id
         WHERE b.condominium_id = ? AND uu.status = 'pending'`,
        condo.id,
      );
      const openTickets = count(
        `SELECT COUNT(*) AS count
         FROM tickets
         WHERE condominium_id = ? AND status NOT IN ('resolved','closed')`,
        condo.id,
      );
      const urgentTickets = count(
        `SELECT COUNT(*) AS count
         FROM tickets
         WHERE condominium_id = ?
           AND status NOT IN ('resolved','closed')
           AND priority IN ('high','urgent')`,
        condo.id,
      );
      const overdueDues = count(
        `SELECT COUNT(*) AS count
         FROM invoices
         WHERE condominium_id = ?
           AND status IN ('open','overdue')
           AND due_date < date('now')`,
        condo.id,
      );
      const pendingPaymentProofs = count(
        `SELECT COUNT(*) AS count
         FROM payment_proofs
         WHERE condominium_id = ? AND status = 'pending'`,
        condo.id,
      );
      const vendorSlaProblems = count(
        `SELECT COUNT(*) AS count
         FROM ticket_work_orders wo
         JOIN tickets t ON t.id = wo.ticket_id
         WHERE t.condominium_id = ?
           AND wo.status IN ('scheduled','in_progress')
           AND wo.scheduled_for IS NOT NULL
           AND wo.scheduled_for < CURRENT_TIMESTAMP`,
        condo.id,
      );
      const proposalsMissingBudget = count(
        `SELECT COUNT(*) AS count
         FROM proposals
         WHERE condominium_id = ?
           AND status IN ('discussion','voting')
           AND estimated_cost IS NULL`,
        condo.id,
      );
      const upcomingMeetings = count(
        `SELECT COUNT(*) AS count
         FROM meetings
         WHERE condominium_id = ?
           AND status = 'scheduled'
           AND scheduled_for >= CURRENT_TIMESTAMP`,
        condo.id,
      );

      return {
        id: condo.id,
        name: condo.name,
        address: condo.address,
        invite_code: condo.invite_code,
        metrics: {
          pending_residents: pendingResidents,
          unresolved_tickets: openTickets,
          urgent_tickets: urgentTickets,
          overdue_dues: overdueDues,
          pending_payment_proofs: pendingPaymentProofs,
          vendor_sla_problems: vendorSlaProblems,
          proposals_missing_budget: proposalsMissingBudget,
          upcoming_meetings: upcomingMeetings,
        },
      };
    });

    const totals = buildings.reduce((acc, building) => {
      for (const [key, value] of Object.entries(building.metrics)) {
        acc[key] = (acc[key] || 0) + Number(value || 0);
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      id: membership.agency_id,
      name: membership.agency_name,
      slug: membership.slug,
      role: membership.role,
      totals,
      buildings,
    };
  });

  return ok(res, { agencies });
}));

export default router;
