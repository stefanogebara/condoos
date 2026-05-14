import db from '../db';
import { AuthUser } from './auth';
import { InAppNotification, listInAppNotifications, unreadInAppNotificationCount } from './in-app-notifications';

export type DashboardActionPriority = 'low' | 'normal' | 'high' | 'urgent';
export type DashboardActionSource = 'visitor' | 'package' | 'finance' | 'reservation' | 'proposal' | 'ticket' | 'meeting' | 'membership' | 'suggestion' | 'concierge' | 'clear';

export interface DashboardQuickAction {
  label: string;
  method: 'POST';
  path: string;
  body?: Record<string, unknown>;
  success_label?: string;
}

export interface DashboardAction {
  id: string;
  role: AuthUser['role'];
  source: DashboardActionSource;
  priority: DashboardActionPriority;
  title: string;
  detail: string;
  href: string;
  cta: string;
  icon: string;
  target_type?: string;
  target_id?: number;
  due_at?: string | null;
  quick_actions?: DashboardQuickAction[];
}

export interface DashboardActionPayload {
  role: AuthUser['role'];
  generated_at: string;
  unread_count: number;
  notifications: InAppNotification[];
  actions: DashboardAction[];
  counts: Record<string, number>;
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function dayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString(), weekday: start.getDay() };
}

function money(cents: number, currency = 'BRL') {
  return `${currency} ${(Number(cents || 0) / 100).toFixed(0)}`;
}

function remainingCents(invoice: { amount_cents: number; paid_cents: number | null }) {
  return Math.max(0, Number(invoice.amount_cents || 0) - Number(invoice.paid_cents || 0));
}

function count(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count || 0);
}

function activeUnitIds(userId: number, condoId: number): number[] {
  const rows = db.prepare(
    `SELECT uu.unit_id
     FROM user_unit uu
     JOIN units u ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE uu.user_id = ?
       AND uu.status = 'active'
       AND b.condominium_id = ?
     ORDER BY uu.primary_contact DESC, uu.created_at ASC`
  ).all(userId, condoId) as Array<{ unit_id: number }>;
  return rows.map((row) => row.unit_id);
}

function residentActions(user: AuthUser, condoId: number, generatedAt = new Date()): { actions: DashboardAction[]; counts: Record<string, number> } {
  const actions: DashboardAction[] = [];
  const counts: Record<string, number> = {};
  const now = nowIso(generatedAt);

  const pendingVisitor = db.prepare(
    `SELECT id, visitor_name, visitor_type, expected_at
     FROM visitors
     WHERE condominium_id = ?
       AND host_id = ?
       AND status = 'pending'
     ORDER BY COALESCE(expected_at, created_at) ASC
     LIMIT 1`
  ).get(condoId, user.id) as { id: number; visitor_name: string; visitor_type: string; expected_at: string | null } | undefined;
  counts.pending_visitors = count(
    `SELECT COUNT(*) AS count FROM visitors WHERE condominium_id = ? AND host_id = ? AND status = 'pending'`,
    condoId,
    user.id,
  );
  if (pendingVisitor) {
    actions.push({
      id: `visitor-${pendingVisitor.id}`,
      role: 'resident',
      source: 'visitor',
      priority: 'urgent',
      title: 'Approve visitor',
      detail: `${pendingVisitor.visitor_name}${pendingVisitor.expected_at ? ` · ${pendingVisitor.expected_at}` : ''}`,
      href: '/app/visitors',
      cta: 'Review',
      icon: 'DoorOpen',
      target_type: 'visitor',
      target_id: pendingVisitor.id,
      due_at: pendingVisitor.expected_at,
      quick_actions: [
        { label: 'Approve', method: 'POST', path: `/visitors/${pendingVisitor.id}/decide`, body: { decision: 'approved' }, success_label: 'Visitor approved' },
        { label: 'Reject', method: 'POST', path: `/visitors/${pendingVisitor.id}/decide`, body: { decision: 'denied' }, success_label: 'Visitor rejected' },
      ],
    });
  }

  const packageWaiting = db.prepare(
    `SELECT id, carrier, description, arrived_at
     FROM packages
     WHERE condominium_id = ?
       AND recipient_id = ?
       AND status = 'waiting'
     ORDER BY arrived_at ASC
     LIMIT 1`
  ).get(condoId, user.id) as { id: number; carrier: string; description: string | null; arrived_at: string } | undefined;
  counts.waiting_packages = count(
    `SELECT COUNT(*) AS count FROM packages WHERE condominium_id = ? AND recipient_id = ? AND status = 'waiting'`,
    condoId,
    user.id,
  );
  if (packageWaiting) {
    actions.push({
      id: `package-${packageWaiting.id}`,
      role: 'resident',
      source: 'package',
      priority: 'high',
      title: 'Package waiting',
      detail: `${packageWaiting.carrier}${packageWaiting.description ? ` · ${packageWaiting.description}` : ''}`,
      href: '/app/packages',
      cta: 'Mark picked up',
      icon: 'Package',
      target_type: 'package',
      target_id: packageWaiting.id,
      quick_actions: [
        { label: 'Mark picked up', method: 'POST', path: `/packages/${packageWaiting.id}/pickup`, success_label: 'Package picked up' },
      ],
    });
  }

  const unitIds = activeUnitIds(user.id, condoId);
  if (unitIds.length > 0) {
    const placeholders = unitIds.map(() => '?').join(',');
    const invoice = db.prepare(
      `SELECT i.id, i.amount_cents, i.currency, i.due_date,
              COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
       FROM invoices i
       WHERE i.condominium_id = ?
         AND i.unit_id IN (${placeholders})
         AND i.status <> 'void'
       ORDER BY i.due_date ASC, i.id ASC`
    ).all(condoId, ...unitIds)
      .map((row: any) => ({ ...row, remaining_cents: remainingCents(row) }))
      .find((row: any) => row.remaining_cents > 0) as any | undefined;
    const invoiceCounts = db.prepare(
      `SELECT COUNT(*) AS count
       FROM invoices i
       WHERE i.condominium_id = ?
         AND i.unit_id IN (${placeholders})
         AND i.status <> 'void'
         AND i.amount_cents > COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)`
    ).get(condoId, ...unitIds) as { count: number } | undefined;
    counts.open_invoices = Number(invoiceCounts?.count || 0);
    if (invoice) {
      actions.push({
        id: `invoice-${invoice.id}`,
        role: 'resident',
        source: 'finance',
        priority: new Date(invoice.due_date).getTime() < generatedAt.getTime() ? 'urgent' : 'high',
        title: 'Payment due',
        detail: `${money(invoice.remaining_cents, invoice.currency)} · due ${invoice.due_date.slice(0, 10)}`,
        href: '/app/transparencia',
        cta: 'Open charges',
        icon: 'ReceiptText',
        target_type: 'invoice',
        target_id: invoice.id,
        due_at: invoice.due_date,
      });
    }
  }

  const reservation = db.prepare(
    `SELECT r.id, r.starts_at, a.name AS amenity_name
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     WHERE a.condominium_id = ?
       AND r.user_id = ?
       AND r.status = 'confirmed'
       AND r.starts_at >= ?
     ORDER BY r.starts_at ASC
     LIMIT 1`
  ).get(condoId, user.id, now) as { id: number; starts_at: string; amenity_name: string } | undefined;
  counts.future_reservations = count(
    `SELECT COUNT(*) AS count
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     WHERE a.condominium_id = ? AND r.user_id = ? AND r.status = 'confirmed' AND r.starts_at >= ?`,
    condoId,
    user.id,
    now,
  );
  if (reservation) {
    const isToday = new Date(reservation.starts_at).toDateString() === generatedAt.toDateString();
    if (isToday) {
      actions.push({
        id: `reservation-${reservation.id}`,
        role: 'resident',
        source: 'reservation',
        priority: 'normal',
        title: 'Reservation today',
        detail: `${reservation.amenity_name} · ${reservation.starts_at}`,
        href: '/app/amenities',
        cta: 'View booking',
        icon: 'CalendarClock',
        target_type: 'amenity_reservation',
        target_id: reservation.id,
        due_at: reservation.starts_at,
      });
    }
  }

  const proposal = db.prepare(
    `SELECT p.id, p.title, p.voting_closes_at
     FROM proposals p
     LEFT JOIN proposal_votes v ON v.proposal_id = p.id AND v.user_id = ?
     WHERE p.condominium_id = ?
       AND p.status = 'voting'
       AND v.proposal_id IS NULL
     ORDER BY COALESCE(p.voting_closes_at, p.updated_at) ASC
     LIMIT 1`
  ).get(user.id, condoId) as { id: number; title: string; voting_closes_at: string | null } | undefined;
  counts.open_votes = count(
    `SELECT COUNT(*) AS count
     FROM proposals p
     LEFT JOIN proposal_votes v ON v.proposal_id = p.id AND v.user_id = ?
     WHERE p.condominium_id = ? AND p.status = 'voting' AND v.proposal_id IS NULL`,
    user.id,
    condoId,
  );
  if (proposal) {
    actions.push({
      id: `proposal-${proposal.id}`,
      role: 'resident',
      source: 'proposal',
      priority: 'high',
      title: 'Vote now',
      detail: proposal.title,
      href: `/app/proposals/${proposal.id}`,
      cta: 'Vote',
      icon: 'Vote',
      target_type: 'proposal',
      target_id: proposal.id,
      due_at: proposal.voting_closes_at,
    });
  }

  const ticket = db.prepare(
    `SELECT id, title, priority, updated_at
     FROM tickets
     WHERE condominium_id = ?
       AND (reporter_id = ? OR verification_threshold > 0)
       AND status NOT IN ('resolved','closed')
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(condoId, user.id) as { id: number; title: string; priority: string; updated_at: string } | undefined;
  counts.open_tickets = count(
    `SELECT COUNT(*) AS count
     FROM tickets
     WHERE condominium_id = ?
       AND (reporter_id = ? OR verification_threshold > 0)
       AND status NOT IN ('resolved','closed')`,
    condoId,
    user.id,
  );
  if (ticket) {
    actions.push({
      id: `ticket-${ticket.id}`,
      role: 'resident',
      source: 'ticket',
      priority: ticket.priority === 'urgent' ? 'urgent' : ticket.priority === 'high' ? 'high' : 'normal',
      title: 'Ticket updated',
      detail: ticket.title,
      href: '/app/tickets',
      cta: 'Follow up',
      icon: 'AlertTriangle',
      target_type: 'ticket',
      target_id: ticket.id,
    });
  }

  return { actions: actions.slice(0, 8), counts };
}

function boardActions(user: AuthUser, condoId: number, generatedAt = new Date()): { actions: DashboardAction[]; counts: Record<string, number> } {
  const actions: DashboardAction[] = [];
  const counts: Record<string, number> = {};
  const now = nowIso(generatedAt);

  const pendingResidents = db.prepare(
    `SELECT uu.id, u.first_name, u.last_name, units.number AS unit_number
     FROM user_unit uu
     JOIN users u ON u.id = uu.user_id
     JOIN units ON units.id = uu.unit_id
     JOIN buildings b ON b.id = units.building_id
     WHERE b.condominium_id = ?
       AND uu.status = 'pending'
     ORDER BY uu.created_at ASC
     LIMIT 1`
  ).get(condoId) as { id: number; first_name: string; last_name: string; unit_number: string | null } | undefined;
  counts.pending_residents = count(
    `SELECT COUNT(*) AS count
     FROM user_unit uu
     JOIN units u ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ? AND uu.status = 'pending'`,
    condoId,
  );
  if (pendingResidents) {
    actions.push({
      id: 'pending-residents',
      role: user.role,
      source: 'membership',
      priority: 'urgent',
      title: counts.pending_residents === 1 ? '1 resident waiting for approval' : `${counts.pending_residents} residents waiting for approval`,
      detail: `${pendingResidents.first_name} ${pendingResidents.last_name}${pendingResidents.unit_number ? ` · Unit ${pendingResidents.unit_number}` : ''}`,
      href: '/board/pending',
      cta: 'Review',
      icon: 'UserPlus',
      target_type: 'membership',
      target_id: pendingResidents.id,
    });
  }

  const ticket = db.prepare(
    `SELECT id, title, priority, remediation_status, blocked_reason, updated_at
     FROM tickets
     WHERE condominium_id = ?
       AND status NOT IN ('resolved','closed')
       AND (
         remediation_status IN ('blocked_needs_admin','verified','agent_dispatched')
         OR priority = 'urgent'
       )
     ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, updated_at DESC
     LIMIT 1`
  ).get(condoId) as any;
  counts.tickets_need_attention = count(
    `SELECT COUNT(*) AS count
     FROM tickets
     WHERE condominium_id = ?
       AND status NOT IN ('resolved','closed')
       AND (
         remediation_status IN ('blocked_needs_admin','verified','agent_dispatched')
         OR priority = 'urgent'
       )`,
    condoId,
  );
  if (ticket) {
    actions.push({
      id: 'tickets-need-attention',
      role: user.role,
      source: 'ticket',
      priority: ticket.priority === 'urgent' ? 'urgent' : 'high',
      title: counts.tickets_need_attention === 1 ? '1 ticket needs attention' : `${counts.tickets_need_attention} tickets need attention`,
      detail: ticket.title,
      href: '/board/tickets',
      cta: 'Open tickets',
      icon: 'AlertTriangle',
      target_type: 'ticket',
      target_id: ticket.id,
    });
  }

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
            SUM(CASE WHEN status <> 'void' AND remaining_cents > 0 AND due_date < ? THEN 1 ELSE 0 END) AS overdue_invoice_count,
            COALESCE(MAX(currency), 'BRL') AS currency
     FROM balances`
  ).get(condoId, now, now) as any;
  counts.open_invoices = Number(receivables?.open_invoice_count || 0);
  counts.overdue_invoices = Number(receivables?.overdue_invoice_count || 0);
  if (Number(receivables?.total_open_cents || 0) > 0) {
    actions.push({
      id: 'open-dues',
      role: user.role,
      source: 'finance',
      priority: Number(receivables?.overdue_cents || 0) > 0 ? 'urgent' : 'high',
      title: `${money(Number(receivables.total_open_cents || 0), receivables.currency)} open in dues`,
      detail: Number(receivables.overdue_cents || 0) > 0
        ? `${money(Number(receivables.overdue_cents || 0), receivables.currency)} overdue`
        : `${counts.open_invoices} open charges`,
      href: '/board/financas',
      cta: 'Open finance',
      icon: 'Wallet',
    });
  }

  const proposal = db.prepare(
    `SELECT id, title
     FROM proposals
     WHERE condominium_id = ?
       AND status IN ('discussion','voting')
       AND (estimated_cost IS NULL OR estimated_cost <= 0 OR cost_breakdown IS NULL OR trim(cost_breakdown) = '')
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(condoId) as { id: number; title: string } | undefined;
  counts.proposals_missing_budget = count(
    `SELECT COUNT(*) AS count
     FROM proposals
     WHERE condominium_id = ?
       AND status IN ('discussion','voting')
       AND (estimated_cost IS NULL OR estimated_cost <= 0 OR cost_breakdown IS NULL OR trim(cost_breakdown) = '')`,
    condoId,
  );
  if (proposal) {
    actions.push({
      id: 'proposal-budget',
      role: user.role,
      source: 'proposal',
      priority: 'high',
      title: counts.proposals_missing_budget === 1 ? '1 proposal needs budget analysis' : `${counts.proposals_missing_budget} proposals need budget analysis`,
      detail: proposal.title,
      href: `/board/proposals/${proposal.id}`,
      cta: 'Add analysis',
      icon: 'Vote',
      target_type: 'proposal',
      target_id: proposal.id,
    });
  }

  const reservationConflict = db.prepare(
    `SELECT a.id AS amenity_id, a.name, r.starts_at,
            SUM(CASE WHEN COALESCE(r.expected_guests, 0) > 0 THEN r.expected_guests ELSE 1 END) AS people,
            a.capacity
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     WHERE a.condominium_id = ?
       AND r.status = 'confirmed'
       AND r.starts_at >= ?
     GROUP BY a.id, r.starts_at
     HAVING people > a.capacity
     ORDER BY r.starts_at ASC
     LIMIT 1`
  ).get(condoId, now) as { amenity_id: number; name: string; starts_at: string; people: number; capacity: number } | undefined;
  counts.reservation_conflicts = count(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT a.id, r.starts_at,
              SUM(CASE WHEN COALESCE(r.expected_guests, 0) > 0 THEN r.expected_guests ELSE 1 END) AS people,
              a.capacity
       FROM amenity_reservations r
       JOIN amenities a ON a.id = r.amenity_id
       WHERE a.condominium_id = ? AND r.status = 'confirmed' AND r.starts_at >= ?
       GROUP BY a.id, r.starts_at
       HAVING people > a.capacity
     )`,
    condoId,
    now,
  );
  if (reservationConflict) {
    actions.push({
      id: 'reservation-conflict',
      role: user.role,
      source: 'reservation',
      priority: 'urgent',
      title: 'Reservation conflict',
      detail: `${reservationConflict.name} · ${reservationConflict.people}/${reservationConflict.capacity}`,
      href: '/board/amenities',
      cta: 'Review slots',
      icon: 'Waves',
      target_type: 'amenity',
      target_id: reservationConflict.amenity_id,
      due_at: reservationConflict.starts_at,
    });
  }

  const meeting = db.prepare(
    `SELECT id, title, scheduled_for
     FROM meetings
     WHERE condominium_id = ?
       AND scheduled_for >= ?
       AND status <> 'cancelled'
     ORDER BY scheduled_for ASC
     LIMIT 1`
  ).get(condoId, now) as { id: number; title: string; scheduled_for: string } | undefined;
  counts.upcoming_meetings = count(
    `SELECT COUNT(*) AS count FROM meetings WHERE condominium_id = ? AND scheduled_for >= ? AND status <> 'cancelled'`,
    condoId,
    now,
  );
  if (meeting) {
    actions.push({
      id: 'upcoming-meeting',
      role: user.role,
      source: 'meeting',
      priority: 'normal',
      title: 'Upcoming meeting',
      detail: meeting.title,
      href: `/board/meetings/${meeting.id}`,
      cta: 'Prepare',
      icon: 'Calendar',
      target_type: 'meeting',
      target_id: meeting.id,
      due_at: meeting.scheduled_for,
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'all-clear',
      role: user.role,
      source: 'clear',
      priority: 'low',
      title: 'Nothing urgent right now',
      detail: 'No approvals, overdue dues, urgent tickets, or meeting blockers need action.',
      href: '/board',
      cta: 'Stay ready',
      icon: 'CheckCircle2',
    });
  }

  return { actions: actions.slice(0, 10), counts };
}

function conciergeActions(user: AuthUser, condoId: number, generatedAt = new Date()): { actions: DashboardAction[]; counts: Record<string, number> } {
  const { start, end, weekday } = dayBounds(generatedAt);
  const actions: DashboardAction[] = [];
  const counts: Record<string, number> = {};

  const visitorRows = db.prepare(
    `SELECT v.id, v.visitor_name, v.visitor_type, v.expected_at, v.status,
            u.first_name, u.last_name, u.unit_number, u.mobile_phone, u.home_phone, u.phone
     FROM visitors v
     JOIN users u ON u.id = v.host_id
     WHERE v.condominium_id = ?
       AND v.status IN ('pending','approved','arrived')
       AND (
         v.expected_at IS NULL
         OR (v.expected_at >= ? AND v.expected_at < ?)
         OR v.recurring_days IS NOT NULL
       )
     ORDER BY CASE v.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              COALESCE(v.expected_at, v.created_at) ASC`
  ).all(condoId, start, end) as any[];
  const visitors = visitorRows.filter((v) => {
    if (!v.recurring_days) return true;
    const days = String(v.recurring_days).split(',').map((d) => Number(d)).filter((d) => Number.isInteger(d));
    if (!days.includes(weekday)) return false;
    if (v.recurring_until) {
      const until = new Date(v.recurring_until);
      until.setHours(23, 59, 59, 999);
      if (until < new Date(start)) return false;
    }
    return true;
  });
  counts.expected_visitors = visitors.filter((v) => v.status !== 'arrived').length;
  counts.pending_approvals = visitors.filter((v) => v.status === 'pending').length;

  const nextPending = visitors.find((v) => v.status === 'pending');
  if (nextPending) {
    actions.push({
      id: `visitor-${nextPending.id}`,
      role: user.role,
      source: 'visitor',
      priority: 'urgent',
      title: 'Visitor needs resident approval',
      detail: `${nextPending.visitor_name} · Unit ${nextPending.unit_number || 'n/a'}`,
      href: '/board/concierge',
      cta: 'Notify resident',
      icon: 'DoorOpen',
      target_type: 'visitor',
      target_id: nextPending.id,
      due_at: nextPending.expected_at,
      quick_actions: [
        { label: 'Notify resident', method: 'POST', path: '/concierge/notify', body: { target_type: 'visitor', target_id: nextPending.id, message_type: 'visitor_arrived' }, success_label: 'Resident notified' },
      ],
    });
  }

  const nextApproved = visitors.find((v) => v.status === 'approved');
  if (nextApproved) {
    actions.push({
      id: `approved-visitor-${nextApproved.id}`,
      role: user.role,
      source: 'visitor',
      priority: 'high',
      title: 'Pre-approved visitor expected',
      detail: `${nextApproved.visitor_name} · Unit ${nextApproved.unit_number || 'n/a'}`,
      href: '/board/concierge',
      cta: 'Register entry',
      icon: 'CheckCircle2',
      target_type: 'visitor',
      target_id: nextApproved.id,
      due_at: nextApproved.expected_at,
      quick_actions: [
        { label: 'Register entry', method: 'POST', path: `/visitors/${nextApproved.id}/arrived`, success_label: 'Entry registered' },
      ],
    });
  }

  const packageRows = db.prepare(
    `SELECT p.id, p.carrier, p.description, p.arrived_at,
            u.first_name, u.last_name, u.unit_number
     FROM packages p
     JOIN users u ON u.id = p.recipient_id
     WHERE p.condominium_id = ?
       AND p.status = 'waiting'
     ORDER BY p.arrived_at ASC`
  ).all(condoId) as any[];
  counts.waiting_packages = packageRows.length;
  if (packageRows[0]) {
    const pkg = packageRows[0];
    actions.push({
      id: `package-${pkg.id}`,
      role: user.role,
      source: 'package',
      priority: 'normal',
      title: 'Package waiting',
      detail: `${pkg.first_name} ${pkg.last_name} · Unit ${pkg.unit_number || 'n/a'}`,
      href: '/board/concierge',
      cta: 'Notify resident',
      icon: 'Package',
      target_type: 'package',
      target_id: pkg.id,
      quick_actions: [
        { label: 'Notify resident', method: 'POST', path: '/concierge/notify', body: { target_type: 'package', target_id: pkg.id, message_type: 'package_arrived' }, success_label: 'Resident notified' },
      ],
    });
  }

  const parties = db.prepare(
    `SELECT COUNT(*) AS count
     FROM amenity_reservations r
     JOIN amenities a ON a.id = r.amenity_id
     WHERE a.condominium_id = ?
       AND r.status = 'confirmed'
       AND r.starts_at >= ?
       AND r.starts_at < ?
       AND (COALESCE(r.expected_guests, 0) > 0 OR r.guest_list IS NOT NULL)`
  ).get(condoId, start, end) as { count: number } | undefined;
  counts.parties_today = Number(parties?.count || 0);
  if (counts.parties_today > 0) {
    actions.push({
      id: 'parties-today',
      role: user.role,
      source: 'concierge',
      priority: 'normal',
      title: counts.parties_today === 1 ? 'Party guest list today' : `${counts.parties_today} party guest lists today`,
      detail: 'Use search to find guest names, unit, host, or amenity.',
      href: '/board/concierge',
      cta: 'Search list',
      icon: 'PartyPopper',
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'front-desk-clear',
      role: user.role,
      source: 'clear',
      priority: 'low',
      title: 'Front desk is clear',
      detail: 'No expected visitors, packages, or party lists need attention right now.',
      href: '/board/concierge',
      cta: 'Keep watch',
      icon: 'CheckCircle2',
    });
  }

  return { actions, counts };
}

export function getDashboardActions(user: AuthUser, condoId: number, generatedAt = new Date()): DashboardActionPayload {
  const result = user.role === 'resident'
    ? residentActions(user, condoId, generatedAt)
    : user.role === 'concierge'
      ? conciergeActions(user, condoId, generatedAt)
      : boardActions(user, condoId, generatedAt);

  return {
    role: user.role,
    generated_at: nowIso(generatedAt),
    unread_count: unreadInAppNotificationCount(user.id),
    notifications: listInAppNotifications(user.id, 5),
    actions: result.actions,
    counts: result.counts,
  };
}
