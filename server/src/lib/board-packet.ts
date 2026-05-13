import db from '../db';
import { listServiceContactsWithScorecards } from './vendor-scorecards';

type CountRow = { count: number };
type MoneyRow = { total_cents: number | null; count: number; currency: string | null };

export interface BoardPacket {
  month: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  condominium: {
    id: number;
    name: string;
    address: string | null;
  };
  summary: {
    headline: string;
    bullets: string[];
    expense_total_cents: number;
    open_dues_cents: number;
    overdue_dues_cents: number;
    open_ticket_count: number;
    urgent_ticket_count: number;
    active_work_order_count: number;
    active_proposal_count: number;
    upcoming_meeting_count: number;
    vendor_count: number;
  };
  finances: {
    currency: string;
    expenses_total_cents: number;
    expense_count: number;
    by_category: Array<{ category: string; total_cents: number; count: number }>;
    top_expenses: Array<{
      id: number;
      category: string;
      vendor: string | null;
      description: string;
      amount_cents: number;
      currency: string;
      spent_at: string;
      receipt_url: string | null;
    }>;
    receivables: {
      total_open_cents: number;
      overdue_cents: number;
      open_invoice_count: number;
      overdue_invoice_count: number;
      overdue_units: Array<{
        id: number;
        unit_number: string;
        building_name: string;
        due_date: string;
        remaining_cents: number;
        currency: string;
      }>;
    };
  };
  tickets: {
    created_count: number;
    resolved_count: number;
    open_count: number;
    urgent_open_count: number;
    by_status: Array<{ status: string; count: number }>;
    by_priority: Array<{ priority: string; count: number }>;
    active: Array<{
      id: number;
      title: string;
      priority: string;
      status: string;
      remediation_status: string | null;
      updated_at: string;
      reporter_name: string;
      unit_number: string | null;
    }>;
    work_orders: {
      total_count: number;
      open_count: number;
      completed_count: number;
      value_cents: number;
      active: Array<{
        id: number;
        ticket_id: number;
        title: string;
        status: string;
        vendor_name: string | null;
        scheduled_for: string | null;
        amount_cents: number | null;
      }>;
    };
  };
  proposals: {
    active_count: number;
    closed_count: number;
    by_status: Array<{ status: string; count: number }>;
    active: Array<{
      id: number;
      title: string;
      status: string;
      estimated_cost: number | null;
      voting_closes_at: string | null;
      yes_votes: number;
      no_votes: number;
      abstain_votes: number;
      created_at: string;
    }>;
  };
  meetings: {
    upcoming_count: number;
    completed_count: number;
    upcoming: Array<{ id: number; title: string; scheduled_for: string; status: string }>;
  };
  announcements: {
    count: number;
    recent: Array<{ id: number; title: string; pinned: number; created_at: string }>;
  };
  vendors: {
    count: number;
    open_work_count: number;
    tracked_spend_cents: number;
    response_rate_percent: number | null;
    top_by_work: Array<{
      id: number;
      company_name: string;
      category: string;
      work_orders_total: number;
      work_orders_open: number;
      work_order_value_cents: number;
      dispatches_total: number;
      dispatches_responded: number;
      expense_total_cents: number;
    }>;
  };
  risks: Array<{ level: 'high' | 'medium' | 'low'; title: string; detail: string; action: string }>;
  next_steps: string[];
  markdown: string;
}

export function normalizeBoardPacketMonth(value?: string, now = new Date()): string {
  if (!value) return now.toISOString().slice(0, 7);
  const clean = value.trim();
  if (!/^\d{4}-\d{2}$/.test(clean)) {
    throw new Error('invalid_month');
  }
  const month = Number(clean.slice(5, 7));
  if (month < 1 || month > 12) throw new Error('invalid_month');
  return clean;
}

function monthBounds(month: string) {
  const [year, rawMonth] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, rawMonth - 1, 1));
  const end = new Date(Date.UTC(year, rawMonth, 1));
  const displayEnd = new Date(end);
  displayEnd.setUTCDate(displayEnd.getUTCDate() - 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: displayEnd.toISOString().slice(0, 10),
  };
}

function count(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as CountRow | undefined;
  return Number(row?.count || 0);
}

function money(value: unknown): number {
  return Number(value || 0);
}

function compact<T>(items: Array<T | null | undefined | false>): T[] {
  return items.filter(Boolean) as T[];
}

function moneyLabel(cents: number, currency = 'BRL') {
  return `${currency} ${(cents / 100).toFixed(0)}`;
}

export function getBoardPacket(condoId: number, monthInput?: string, now = new Date()): BoardPacket {
  const month = normalizeBoardPacketMonth(monthInput, now);
  const bounds = monthBounds(month);
  const nowIso = now.toISOString();

  const condominium = db.prepare(
    `SELECT id, name, address FROM condominiums WHERE id = ?`
  ).get(condoId) as BoardPacket['condominium'] | undefined;
  if (!condominium) throw new Error('condo_not_found');

  const expenseSummary = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents,
            COUNT(*) AS count,
            COALESCE(MAX(currency), 'BRL') AS currency
     FROM expenses
     WHERE condominium_id = ?
       AND spent_at >= ?
       AND spent_at < ?`
  ).get(condoId, bounds.start, bounds.end) as MoneyRow;

  const expensesByCategory = db.prepare(
    `SELECT category, COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS count
     FROM expenses
     WHERE condominium_id = ?
       AND spent_at >= ?
       AND spent_at < ?
     GROUP BY category
     ORDER BY total_cents DESC`
  ).all(condoId, bounds.start, bounds.end) as BoardPacket['finances']['by_category'];

  const topExpenses = db.prepare(
    `SELECT id, category, vendor, description, amount_cents, currency, spent_at, receipt_url
     FROM expenses
     WHERE condominium_id = ?
       AND spent_at >= ?
       AND spent_at < ?
     ORDER BY amount_cents DESC, spent_at DESC
     LIMIT 5`
  ).all(condoId, bounds.start, bounds.end) as BoardPacket['finances']['top_expenses'];

  const receivables = db.prepare(
    `WITH balances AS (
       SELECT i.id, i.amount_cents, i.currency, i.status, i.due_date,
              MAX(i.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0), 0) AS remaining_cents
       FROM invoices i
       WHERE i.condominium_id = ?
     )
     SELECT COALESCE(SUM(CASE WHEN status <> 'void' AND remaining_cents > 0 THEN remaining_cents ELSE 0 END), 0) AS total_open_cents,
            COALESCE(SUM(CASE WHEN status <> 'void' AND remaining_cents > 0 AND due_date < ? THEN remaining_cents ELSE 0 END), 0) AS overdue_cents,
            SUM(CASE WHEN status <> 'void' AND remaining_cents > 0 THEN 1 ELSE 0 END) AS open_invoice_count,
            SUM(CASE WHEN status <> 'void' AND remaining_cents > 0 AND due_date < ? THEN 1 ELSE 0 END) AS overdue_invoice_count
     FROM balances`
  ).get(condoId, nowIso, nowIso) as {
    total_open_cents: number | null;
    overdue_cents: number | null;
    open_invoice_count: number | null;
    overdue_invoice_count: number | null;
  };

  const overdueUnits = db.prepare(
    `WITH balances AS (
       SELECT i.id, u.number AS unit_number, b.name AS building_name, i.due_date, i.currency, i.status,
              MAX(i.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0), 0) AS remaining_cents
       FROM invoices i
       JOIN units u ON u.id = i.unit_id
       JOIN buildings b ON b.id = u.building_id
       WHERE i.condominium_id = ?
     )
     SELECT id, unit_number, building_name, due_date, remaining_cents, currency
     FROM balances
     WHERE status <> 'void'
       AND remaining_cents > 0
       AND due_date < ?
     ORDER BY due_date ASC, remaining_cents DESC
     LIMIT 5`
  ).all(condoId, nowIso) as BoardPacket['finances']['receivables']['overdue_units'];

  const ticketCreatedCount = count(
    `SELECT COUNT(*) AS count FROM tickets WHERE condominium_id = ? AND created_at >= ? AND created_at < ?`,
    condoId, bounds.start, bounds.end,
  );
  const ticketResolvedCount = count(
    `SELECT COUNT(*) AS count FROM tickets WHERE condominium_id = ? AND resolved_at >= ? AND resolved_at < ?`,
    condoId, bounds.start, bounds.end,
  );
  const openTicketCount = count(
    `SELECT COUNT(*) AS count FROM tickets WHERE condominium_id = ? AND status IN ('open','in_progress','waiting')`,
    condoId,
  );
  const urgentTicketCount = count(
    `SELECT COUNT(*) AS count FROM tickets WHERE condominium_id = ? AND status IN ('open','in_progress','waiting') AND priority = 'urgent'`,
    condoId,
  );

  const ticketsByStatus = db.prepare(
    `SELECT status, COUNT(*) AS count
     FROM tickets
     WHERE condominium_id = ?
     GROUP BY status
     ORDER BY count DESC`
  ).all(condoId) as BoardPacket['tickets']['by_status'];

  const ticketsByPriority = db.prepare(
    `SELECT priority, COUNT(*) AS count
     FROM tickets
     WHERE condominium_id = ?
       AND status IN ('open','in_progress','waiting')
     GROUP BY priority
     ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`
  ).all(condoId) as BoardPacket['tickets']['by_priority'];

  const activeTickets = db.prepare(
    `SELECT t.id, t.title, t.priority, t.status, t.remediation_status, t.updated_at,
            TRIM(r.first_name || ' ' || r.last_name) AS reporter_name,
            COALESCE(u.number, ru.number) AS unit_number
     FROM tickets t
     JOIN users r ON r.id = t.reporter_id
     LEFT JOIN units u ON u.id = t.unit_id
     LEFT JOIN user_unit uu ON uu.user_id = r.id AND uu.status = 'active' AND uu.primary_contact = 1
     LEFT JOIN units ru ON ru.id = uu.unit_id
     WHERE t.condominium_id = ?
       AND t.status IN ('open','in_progress','waiting')
     ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
              t.updated_at DESC
     LIMIT 8`
  ).all(condoId) as BoardPacket['tickets']['active'];

  const workOrderSummary = db.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN wo.status IN ('draft','scheduled','in_progress') THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN wo.status = 'completed' AND wo.completed_at >= ? AND wo.completed_at < ? THEN 1 ELSE 0 END) AS completed_count,
            COALESCE(SUM(COALESCE(wo.approved_amount_cents, wo.estimated_amount_cents, 0)), 0) AS value_cents
     FROM ticket_work_orders wo
     JOIN tickets t ON t.id = wo.ticket_id
     WHERE t.condominium_id = ?`
  ).get(bounds.start, bounds.end, condoId) as {
    total_count: number | null;
    open_count: number | null;
    completed_count: number | null;
    value_cents: number | null;
  };

  const activeWorkOrders = db.prepare(
    `SELECT wo.id, wo.ticket_id, wo.title, wo.status, sc.company_name AS vendor_name,
            wo.scheduled_for,
            COALESCE(wo.approved_amount_cents, wo.estimated_amount_cents) AS amount_cents
     FROM ticket_work_orders wo
     JOIN tickets t ON t.id = wo.ticket_id
     LEFT JOIN service_contacts sc ON sc.id = wo.service_contact_id
     WHERE t.condominium_id = ?
       AND wo.status IN ('draft','scheduled','in_progress')
     ORDER BY COALESCE(wo.scheduled_for, wo.updated_at) ASC
     LIMIT 8`
  ).all(condoId) as BoardPacket['tickets']['work_orders']['active'];

  const proposalsByStatus = db.prepare(
    `SELECT status, COUNT(*) AS count
     FROM proposals
     WHERE condominium_id = ?
     GROUP BY status
     ORDER BY CASE status WHEN 'voting' THEN 1 WHEN 'discussion' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END`
  ).all(condoId) as BoardPacket['proposals']['by_status'];

  const activeProposals = db.prepare(
    `SELECT p.id, p.title, p.status, p.estimated_cost, p.voting_closes_at, p.created_at,
            SUM(CASE WHEN v.choice = 'yes' THEN 1 ELSE 0 END) AS yes_votes,
            SUM(CASE WHEN v.choice = 'no' THEN 1 ELSE 0 END) AS no_votes,
            SUM(CASE WHEN v.choice = 'abstain' THEN 1 ELSE 0 END) AS abstain_votes
     FROM proposals p
     LEFT JOIN proposal_votes v ON v.proposal_id = p.id
     WHERE p.condominium_id = ?
       AND p.status IN ('discussion','voting')
     GROUP BY p.id
     ORDER BY CASE p.status WHEN 'voting' THEN 1 ELSE 2 END, p.created_at DESC
     LIMIT 8`
  ).all(condoId) as BoardPacket['proposals']['active'];

  const activeProposalCount = count(
    `SELECT COUNT(*) AS count FROM proposals WHERE condominium_id = ? AND status IN ('discussion','voting')`,
    condoId,
  );
  const closedProposalCount = count(
    `SELECT COUNT(*) AS count
     FROM proposals
     WHERE condominium_id = ?
       AND status IN ('approved','rejected','completed','inconclusive')
       AND COALESCE(closed_at, updated_at) >= ?
       AND COALESCE(closed_at, updated_at) < ?`,
    condoId, bounds.start, bounds.end,
  );
  const proposalsMissingBudget = count(
    `SELECT COUNT(*) AS count
     FROM proposals
     WHERE condominium_id = ?
       AND status = 'voting'
       AND estimated_cost IS NULL
       AND (cost_breakdown IS NULL OR trim(cost_breakdown) = '')`,
    condoId,
  );

  const upcomingMeetings = db.prepare(
    `SELECT id, title, scheduled_for, status
     FROM meetings
     WHERE condominium_id = ?
       AND scheduled_for >= ?
       AND status <> 'cancelled'
     ORDER BY scheduled_for ASC
     LIMIT 6`
  ).all(condoId, nowIso) as BoardPacket['meetings']['upcoming'];
  const completedMeetingCount = count(
    `SELECT COUNT(*) AS count FROM meetings WHERE condominium_id = ? AND status = 'completed' AND scheduled_for >= ? AND scheduled_for < ?`,
    condoId, bounds.start, bounds.end,
  );

  const announcementCount = count(
    `SELECT COUNT(*) AS count FROM announcements WHERE condominium_id = ? AND created_at >= ? AND created_at < ?`,
    condoId, bounds.start, bounds.end,
  );
  const recentAnnouncements = db.prepare(
    `SELECT id, title, pinned, created_at
     FROM announcements
     WHERE condominium_id = ?
     ORDER BY pinned DESC, created_at DESC
     LIMIT 5`
  ).all(condoId) as BoardPacket['announcements']['recent'];

  const vendors = listServiceContactsWithScorecards(condoId, false);
  const vendorsWithDispatches = vendors.filter((vendor) => vendor.dispatches_total > 0);
  const responseRatePercent = vendorsWithDispatches.length
    ? Math.round(
      vendorsWithDispatches.reduce((sum, vendor) => (
        sum + (vendor.dispatches_responded / Math.max(1, vendor.dispatches_total)) * 100
      ), 0) / vendorsWithDispatches.length,
    )
    : null;
  const topVendors = [...vendors]
    .sort((a, b) => {
      const workDelta = b.work_orders_total - a.work_orders_total;
      if (workDelta) return workDelta;
      return b.expense_total_cents - a.expense_total_cents;
    })
    .slice(0, 5)
    .map((vendor) => ({
      id: vendor.id,
      company_name: vendor.company_name,
      category: vendor.category,
      work_orders_total: vendor.work_orders_total,
      work_orders_open: vendor.work_orders_open,
      work_order_value_cents: vendor.work_order_value_cents,
      dispatches_total: vendor.dispatches_total,
      dispatches_responded: vendor.dispatches_responded,
      expense_total_cents: vendor.expense_total_cents,
    }));

  const risks = compact<BoardPacket['risks'][number]>([
    urgentTicketCount > 0 && {
      level: 'high',
      title: `${urgentTicketCount} urgent open ticket${urgentTicketCount === 1 ? '' : 's'}`,
      detail: 'Urgent issues are still open or waiting for action.',
      action: 'Review the ticket queue and assign owner or vendor today.',
    },
    money(receivables.overdue_cents) > 0 && {
      level: 'high',
      title: `${moneyLabel(money(receivables.overdue_cents), expenseSummary.currency || 'BRL')} overdue`,
      detail: `${money(receivables.overdue_invoice_count)} invoice${money(receivables.overdue_invoice_count) === 1 ? '' : 's'} are past due.`,
      action: 'Follow up with the listed units or send a dues reminder.',
    },
    money(workOrderSummary.open_count) > 0 && {
      level: 'medium',
      title: `${money(workOrderSummary.open_count)} open work order${money(workOrderSummary.open_count) === 1 ? '' : 's'}`,
      detail: 'Repairs have been scoped but are not completed.',
      action: 'Confirm vendor schedule, estimate, photo evidence, and invoice status.',
    },
    proposalsMissingBudget > 0 && {
      level: 'medium',
      title: `${proposalsMissingBudget} vote${proposalsMissingBudget === 1 ? '' : 's'} missing budget analysis`,
      detail: 'Residents should see cost, timeline, risks, and alternatives before voting.',
      action: 'Add the proposal budget and analysis before pushing the vote.',
    },
    vendors.length === 0 && {
      level: 'low',
      title: 'No vendor network saved yet',
      detail: 'The building has no reusable service contacts for incidents or repairs.',
      action: 'Add emergency, maintenance, elevator, cleaning, and amenity vendors.',
    },
  ]);

  const nextSteps = compact<string>([
    urgentTicketCount > 0 && 'Clear urgent tickets or assign same-day vendor follow-up.',
    money(receivables.overdue_cents) > 0 && 'Send dues reminders for overdue invoices.',
    money(workOrderSummary.open_count) > 0 && 'Update work-order schedule, estimate, receipt, or completion photo.',
    activeProposalCount > 0 && 'Review active proposals for budget readiness and voting deadlines.',
    upcomingMeetings.length > 0 && 'Prepare agenda and packet for upcoming meetings.',
    risks.length === 0 && 'No critical risks detected this month; keep the report updated before the board meeting.',
  ]);

  const packet: BoardPacket = {
    month,
    period_start: bounds.startDate,
    period_end: bounds.endDate,
    generated_at: nowIso,
    condominium,
    summary: {
      headline: `${condominium.name} board packet for ${month}`,
      bullets: [
        `${moneyLabel(money(expenseSummary.total_cents), expenseSummary.currency || 'BRL')} spent across ${money(expenseSummary.count)} expense${money(expenseSummary.count) === 1 ? '' : 's'} this month.`,
        `${moneyLabel(money(receivables.total_open_cents), expenseSummary.currency || 'BRL')} open dues, including ${moneyLabel(money(receivables.overdue_cents), expenseSummary.currency || 'BRL')} overdue.`,
        `${openTicketCount} open ticket${openTicketCount === 1 ? '' : 's'}, ${urgentTicketCount} urgent.`,
        `${activeProposalCount} active proposal${activeProposalCount === 1 ? '' : 's'} and ${upcomingMeetings.length} upcoming meeting${upcomingMeetings.length === 1 ? '' : 's'}.`,
      ],
      expense_total_cents: money(expenseSummary.total_cents),
      open_dues_cents: money(receivables.total_open_cents),
      overdue_dues_cents: money(receivables.overdue_cents),
      open_ticket_count: openTicketCount,
      urgent_ticket_count: urgentTicketCount,
      active_work_order_count: money(workOrderSummary.open_count),
      active_proposal_count: activeProposalCount,
      upcoming_meeting_count: upcomingMeetings.length,
      vendor_count: vendors.length,
    },
    finances: {
      currency: expenseSummary.currency || 'BRL',
      expenses_total_cents: money(expenseSummary.total_cents),
      expense_count: money(expenseSummary.count),
      by_category: expensesByCategory.map((row) => ({
        category: row.category,
        total_cents: money(row.total_cents),
        count: money(row.count),
      })),
      top_expenses: topExpenses,
      receivables: {
        total_open_cents: money(receivables.total_open_cents),
        overdue_cents: money(receivables.overdue_cents),
        open_invoice_count: money(receivables.open_invoice_count),
        overdue_invoice_count: money(receivables.overdue_invoice_count),
        overdue_units: overdueUnits.map((row) => ({ ...row, remaining_cents: money(row.remaining_cents) })),
      },
    },
    tickets: {
      created_count: ticketCreatedCount,
      resolved_count: ticketResolvedCount,
      open_count: openTicketCount,
      urgent_open_count: urgentTicketCount,
      by_status: ticketsByStatus.map((row) => ({ status: row.status, count: money(row.count) })),
      by_priority: ticketsByPriority.map((row) => ({ priority: row.priority, count: money(row.count) })),
      active: activeTickets,
      work_orders: {
        total_count: money(workOrderSummary.total_count),
        open_count: money(workOrderSummary.open_count),
        completed_count: money(workOrderSummary.completed_count),
        value_cents: money(workOrderSummary.value_cents),
        active: activeWorkOrders,
      },
    },
    proposals: {
      active_count: activeProposalCount,
      closed_count: closedProposalCount,
      by_status: proposalsByStatus.map((row) => ({ status: row.status, count: money(row.count) })),
      active: activeProposals.map((row) => ({
        ...row,
        yes_votes: money(row.yes_votes),
        no_votes: money(row.no_votes),
        abstain_votes: money(row.abstain_votes),
      })),
    },
    meetings: {
      upcoming_count: upcomingMeetings.length,
      completed_count: completedMeetingCount,
      upcoming: upcomingMeetings,
    },
    announcements: {
      count: announcementCount,
      recent: recentAnnouncements,
    },
    vendors: {
      count: vendors.length,
      open_work_count: vendors.reduce((sum, vendor) => sum + vendor.work_orders_open, 0),
      tracked_spend_cents: vendors.reduce((sum, vendor) => sum + vendor.expense_total_cents, 0),
      response_rate_percent: responseRatePercent,
      top_by_work: topVendors,
    },
    risks,
    next_steps: nextSteps,
    markdown: '',
  };
  packet.markdown = buildBoardPacketMarkdown(packet);
  return packet;
}

function buildBoardPacketMarkdown(packet: BoardPacket): string {
  const lines = [
    `# ${packet.condominium.name} board packet`,
    '',
    `Month: ${packet.month}`,
    `Generated: ${packet.generated_at.slice(0, 10)}`,
    '',
    '## Executive summary',
    ...packet.summary.bullets.map((bullet) => `- ${bullet}`),
    '',
    '## Risks',
    ...(packet.risks.length
      ? packet.risks.map((risk) => `- [${risk.level.toUpperCase()}] ${risk.title}: ${risk.action}`)
      : ['- No critical risks detected.']),
    '',
    '## Next steps',
    ...packet.next_steps.map((step) => `- ${step}`),
    '',
    '## Finance',
    `- Expenses: ${moneyLabel(packet.finances.expenses_total_cents, packet.finances.currency)} across ${packet.finances.expense_count} entries.`,
    `- Open dues: ${moneyLabel(packet.finances.receivables.total_open_cents, packet.finances.currency)}.`,
    `- Overdue dues: ${moneyLabel(packet.finances.receivables.overdue_cents, packet.finances.currency)}.`,
    '',
    '## Operations',
    `- Open tickets: ${packet.tickets.open_count}.`,
    `- Urgent open tickets: ${packet.tickets.urgent_open_count}.`,
    `- Open work orders: ${packet.tickets.work_orders.open_count}.`,
    `- Active proposals: ${packet.proposals.active_count}.`,
    `- Upcoming meetings: ${packet.meetings.upcoming_count}.`,
    '',
    '## Vendor network',
    `- Saved vendors: ${packet.vendors.count}.`,
    `- Vendor-linked spend: ${moneyLabel(packet.vendors.tracked_spend_cents, packet.finances.currency)}.`,
    `- Average response rate: ${packet.vendors.response_rate_percent == null ? 'No history' : `${packet.vendors.response_rate_percent}%`}.`,
    '',
  ];
  return lines.join('\n');
}
