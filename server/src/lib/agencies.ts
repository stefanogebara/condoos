import { createHash, randomBytes } from 'crypto';
import db from '../db';
import type { EmailDeliveryResult } from './email';
import { hashSetupCode, normalizeSetupCode } from './private-access';

export type AgencyRole =
  | 'agency_admin'
  | 'building_admin'
  | 'finance_manager'
  | 'maintenance_manager'
  | 'concierge_supervisor';

export const AGENCY_ROLES: AgencyRole[] = [
  'agency_admin',
  'building_admin',
  'finance_manager',
  'maintenance_manager',
  'concierge_supervisor',
];

export type AgencyBuildingCapability =
  | 'building_admin'
  | 'finance'
  | 'maintenance'
  | 'concierge'
  | 'documents'
  | 'reports';

export const AGENCY_ROLE_CAPABILITIES: Record<AgencyRole, AgencyBuildingCapability[]> = {
  agency_admin: ['building_admin', 'finance', 'maintenance', 'concierge', 'documents', 'reports'],
  building_admin: ['building_admin', 'finance', 'maintenance', 'concierge', 'documents', 'reports'],
  finance_manager: ['finance', 'documents', 'reports'],
  maintenance_manager: ['maintenance', 'documents', 'reports'],
  concierge_supervisor: ['concierge'],
};

export function isAgencyRole(value: unknown): value is AgencyRole {
  return typeof value === 'string' && (AGENCY_ROLES as string[]).includes(value);
}

export function agencyRoleCanUseCapability(role: AgencyRole, capability: AgencyBuildingCapability): boolean {
  return AGENCY_ROLE_CAPABILITIES[role]?.includes(capability) || false;
}

export function agencyCapabilitiesForRole(role: AgencyRole): AgencyBuildingCapability[] {
  return [...(AGENCY_ROLE_CAPABILITIES[role] || [])];
}

export interface AgencyLinkResult {
  agencyId: number;
  agencyName: string;
}

export interface AgencyMembership {
  id: number;
  agency_id: number;
  agency_name: string;
  slug: string;
  user_id: number;
  role: AgencyRole;
}

export interface AgencyStaffMember {
  id: number;
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: AgencyRole;
  created_at: string;
  assigned_building_ids: number[];
}

export interface AgencyStaffInvite {
  id: number;
  agency_id: number;
  agency_name: string;
  email: string;
  role: AgencyRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: number | null;
  revoked_at: string | null;
  created_by_user_id: number | null;
  email_status: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  assigned_building_ids: number[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface CreatedAgencyStaffInvite extends AgencyStaffInvite {
  token: string;
}

export interface AgencyBuildingMetrics {
  pending_residents: number;
  unresolved_tickets: number;
  urgent_tickets: number;
  overdue_dues: number;
  pending_payment_proofs: number;
  vendor_sla_problems: number;
  proposals_missing_budget: number;
  upcoming_meetings: number;
}

export interface AgencyPermissionReview {
  total_staff: number;
  agency_admins: number;
  scoped_staff: number;
  unassigned_staff: number;
  pending_invites: number;
  expired_invites: number;
  failed_invite_emails: number;
  buildings_without_direct_staff: Array<{
    id: number;
    name: string;
  }>;
}

export type AgencyPortfolioAttentionKind =
  | 'urgent_tickets'
  | 'vendor_sla_problems'
  | 'overdue_dues'
  | 'pending_payment_proofs'
  | 'pending_residents'
  | 'proposals_missing_budget';

export interface AgencyPortfolioAttentionItem {
  id: string;
  kind: AgencyPortfolioAttentionKind;
  severity: 'critical' | 'warning' | 'info';
  condominium_id: number;
  condominium_name: string;
  count: number;
  route: string;
}

export interface AgencyMonthlyReportBuilding {
  condominium_id: number;
  condominium_name: string;
  metrics: AgencyBuildingMetrics;
  month: {
    tickets_opened: number;
    work_orders_completed: number;
    dues_billed: string;
    payments_received: string;
    expenses_spent: string;
    expense_receipt_coverage_percent: number;
  };
  next_actions: string[];
}

export interface AgencyMonthlyReport {
  agency_id: number;
  agency_name: string;
  role: AgencyRole;
  month: string;
  generated_at: string;
  totals: AgencyBuildingMetrics;
  attention: AgencyPortfolioAttentionItem[];
  buildings: AgencyMonthlyReportBuilding[];
  markdown: string;
}

export interface AgencyPortfolio {
  id: number;
  name: string;
  slug: string;
  role: AgencyRole;
  capabilities: AgencyBuildingCapability[];
  totals: AgencyBuildingMetrics;
  permission_review: AgencyPermissionReview | null;
  attention: AgencyPortfolioAttentionItem[];
  buildings: Array<{
    id: number;
    name: string;
    address: string;
    invite_code: string | null;
    metrics: AgencyBuildingMetrics;
  }>;
}

export interface AgencySetupCode {
  id: number;
  label: string | null;
  agency_name: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  disabled_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  last_used_at: string | null;
  activation_count: number;
  last_activated_at: string | null;
  last_activated_condominium_id: number | null;
  last_activated_condominium_name: string | null;
  last_activated_by_email: string | null;
  status: 'active' | 'disabled' | 'expired' | 'exhausted';
}

export interface CreatedAgencySetupCode extends AgencySetupCode {
  code: string;
}

export const AGENCY_EXPORT_KINDS = ['residents', 'finance', 'tickets', 'work-orders', 'audit'] as const;
export type AgencyExportKind = typeof AGENCY_EXPORT_KINDS[number];

export interface AgencyAuditEvent {
  id: number;
  created_at: string;
  condominium_id: number | null;
  condominium_name: string | null;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  metadata: string | null;
}

function count(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined;
  return Number(row?.count || 0);
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'agency';
}

function uniqueSlug(name: string): string {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const exists = db.prepare(`SELECT 1 FROM agencies WHERE slug = ? LIMIT 1`).get(slug);
    if (!exists) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function findOrCreateAgency(name: string): AgencyLinkResult {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const existing = db.prepare(
    `SELECT id, name FROM agencies WHERE lower(name) = lower(?) LIMIT 1`
  ).get(cleanName) as { id: number; name: string } | undefined;
  if (existing) return { agencyId: existing.id, agencyName: existing.name };

  const result = db.prepare(
    `INSERT INTO agencies (name, slug) VALUES (?, ?)`
  ).run(cleanName, uniqueSlug(cleanName));
  return { agencyId: Number(result.lastInsertRowid), agencyName: cleanName };
}

function agencyById(agencyId: number): { id: number; name: string; slug: string } | null {
  const row = db.prepare(
    `SELECT id, name, slug FROM agencies WHERE id = ? LIMIT 1`
  ).get(agencyId) as { id: number; name: string; slug: string } | undefined;
  return row || null;
}

function agencyMembershipById(agencyId: number, membershipId: number): AgencyMembership | null {
  const row = db.prepare(
    `SELECT am.id, a.id AS agency_id, a.name AS agency_name, a.slug, am.user_id, am.role
     FROM agency_memberships am
     JOIN agencies a ON a.id = am.agency_id
     WHERE am.id = ? AND am.agency_id = ?
     LIMIT 1`
  ).get(membershipId, agencyId) as AgencyMembership | undefined;
  return row || null;
}

function normalizeBuildingIds(buildingIds: number[] | undefined | null): number[] {
  return Array.from(new Set((buildingIds || [])
    .map((id) => Math.floor(Number(id)))
    .filter((id) => Number.isInteger(id) && id > 0)));
}

function validateAgencyBuildingIds(agencyId: number, buildingIds: number[]): number[] {
  const normalized = normalizeBuildingIds(buildingIds);
  if (normalized.length === 0) return [];
  const placeholders = normalized.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT condominium_id
     FROM agency_condominiums
     WHERE agency_id = ? AND condominium_id IN (${placeholders})`
  ).all(agencyId, ...normalized) as Array<{ condominium_id: number }>;
  const valid = new Set(rows.map((row) => Number(row.condominium_id)));
  if (valid.size !== normalized.length) {
    throw Object.assign(new Error('invalid_building_scope'), { status: 400 });
  }
  return normalized;
}

function setAgencyMemberBuildings(agencyId: number, membershipId: number, buildingIds: number[]) {
  const normalized = validateAgencyBuildingIds(agencyId, buildingIds);
  db.prepare(`DELETE FROM agency_member_buildings WHERE agency_membership_id = ?`).run(membershipId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agency_member_buildings (agency_membership_id, condominium_id)
     VALUES (?, ?)`
  );
  for (const buildingId of normalized) insert.run(membershipId, buildingId);
}

export function linkCondominiumToAgency(input: {
  agencyName: string | null | undefined;
  condominiumId: number;
  userId: number;
  role?: AgencyRole;
}): AgencyLinkResult | null {
  const agencyName = input.agencyName?.trim();
  if (!agencyName) return null;

  const agency = findOrCreateAgency(agencyName);
  db.prepare(
    `INSERT OR IGNORE INTO agency_condominiums (agency_id, condominium_id) VALUES (?, ?)`
  ).run(agency.agencyId, input.condominiumId);
  db.prepare(
    `INSERT OR IGNORE INTO agency_memberships (agency_id, user_id, role) VALUES (?, ?, ?)`
  ).run(agency.agencyId, input.userId, input.role || 'agency_admin');
  const membership = db.prepare(
    `SELECT id, role FROM agency_memberships WHERE agency_id = ? AND user_id = ? LIMIT 1`
  ).get(agency.agencyId, input.userId) as { id: number; role: AgencyRole } | undefined;
  if (membership && membership.role !== 'agency_admin') {
    setAgencyMemberBuildings(agency.agencyId, membership.id, [input.condominiumId]);
  }
  return agency;
}

export function userAgencyMemberships(userId: number) {
  return db.prepare(
    `SELECT am.id, a.id AS agency_id, a.name AS agency_name, a.slug, am.user_id, am.role
     FROM agency_memberships am
     JOIN agencies a ON a.id = am.agency_id
     WHERE am.user_id = ?
     ORDER BY a.name`
  ).all(userId) as AgencyMembership[];
}

export function userAgencyMembership(userId: number, agencyId: number): AgencyMembership | null {
  const row = db.prepare(
    `SELECT am.id, a.id AS agency_id, a.name AS agency_name, a.slug, am.user_id, am.role
     FROM agency_memberships am
     JOIN agencies a ON a.id = am.agency_id
     WHERE am.user_id = ? AND a.id = ?
     LIMIT 1`
  ).get(userId, agencyId) as AgencyMembership | undefined;
  return row || null;
}

export function userCanManageAgency(userId: number, agencyId: number): boolean {
  return userAgencyMembership(userId, agencyId)?.role === 'agency_admin';
}

export function agencyRolesForBuilding(userId: number, condominiumId: number): AgencyRole[] {
  const rows = db.prepare(
    `SELECT DISTINCT am.role
     FROM agency_memberships am
     JOIN agency_condominiums ac
       ON ac.agency_id = am.agency_id
      AND ac.condominium_id = ?
     LEFT JOIN agency_member_buildings amb
       ON amb.agency_membership_id = am.id
      AND amb.condominium_id = ?
     WHERE am.user_id = ?
       AND (am.role = 'agency_admin' OR amb.id IS NOT NULL)
     ORDER BY
       CASE am.role
         WHEN 'agency_admin' THEN 0
         WHEN 'building_admin' THEN 1
         WHEN 'finance_manager' THEN 2
         WHEN 'maintenance_manager' THEN 3
         ELSE 4
       END`
  ).all(condominiumId, condominiumId, userId) as Array<{ role: AgencyRole }>;
  return rows.map((row) => row.role).filter(isAgencyRole);
}

export function agencyUserCanUseBuildingCapability(
  userId: number,
  condominiumId: number,
  capability: AgencyBuildingCapability,
): { scoped: boolean; allowed: boolean; roles: AgencyRole[] } {
  const roles = agencyRolesForBuilding(userId, condominiumId);
  if (roles.length === 0) {
    const hasAgencyMembership = count(
      `SELECT COUNT(*) AS count FROM agency_memberships WHERE user_id = ?`,
      userId,
    ) > 0;
    return { scoped: hasAgencyMembership, allowed: !hasAgencyMembership, roles };
  }
  return {
    scoped: true,
    allowed: roles.some((role) => agencyRoleCanUseCapability(role, capability)),
    roles,
  };
}

function zeroMetrics(): AgencyBuildingMetrics {
  return {
    pending_residents: 0,
    unresolved_tickets: 0,
    urgent_tickets: 0,
    overdue_dues: 0,
    pending_payment_proofs: 0,
    vendor_sla_problems: 0,
    proposals_missing_budget: 0,
    upcoming_meetings: 0,
  };
}

const ATTENTION_CONFIG: Record<AgencyPortfolioAttentionKind, {
  severity: AgencyPortfolioAttentionItem['severity'];
  route: string;
  priority: number;
}> = {
  urgent_tickets: { severity: 'critical', route: '/board/tickets', priority: 10 },
  vendor_sla_problems: { severity: 'critical', route: '/board/tickets', priority: 9 },
  overdue_dues: { severity: 'warning', route: '/board/financas', priority: 8 },
  pending_payment_proofs: { severity: 'warning', route: '/board/financas', priority: 7 },
  pending_residents: { severity: 'info', route: '/board/pending', priority: 6 },
  proposals_missing_budget: { severity: 'info', route: '/board/proposals', priority: 5 },
};

function buildingIdsForMembership(membership: AgencyMembership): number[] {
  const rows = db.prepare(
    `SELECT ac.condominium_id
     FROM agency_condominiums ac
     WHERE ac.agency_id = ?
     ORDER BY ac.condominium_id`
  ).all(membership.agency_id) as Array<{ condominium_id: number }>;
  const allAgencyBuildingIds = rows.map((row) => Number(row.condominium_id));
  if (membership.role === 'agency_admin') return allAgencyBuildingIds;

  const assigned = db.prepare(
    `SELECT amb.condominium_id
     FROM agency_member_buildings amb
     JOIN agency_condominiums ac
       ON ac.condominium_id = amb.condominium_id
      AND ac.agency_id = ?
     WHERE amb.agency_membership_id = ?
     ORDER BY amb.condominium_id`
  ).all(membership.agency_id, membership.id) as Array<{ condominium_id: number }>;
  return assigned.map((row) => Number(row.condominium_id));
}

function buildAgencyPermissionReview(
  agencyId: number,
  buildings: AgencyPortfolio['buildings'],
): AgencyPermissionReview {
  const staff = listAgencyStaff(agencyId);
  const invites = listAgencyStaffInvites(agencyId);
  const directStaff = staff.filter((member) => member.role !== 'agency_admin');
  const scopedStaff = directStaff.filter((member) => member.assigned_building_ids.length > 0);
  const unassignedStaff = directStaff.filter((member) => member.assigned_building_ids.length === 0);
  const buildingsWithoutDirectStaff = buildings
    .filter((building) => !directStaff.some((member) => member.assigned_building_ids.includes(building.id)))
    .map((building) => ({ id: building.id, name: building.name }));

  return {
    total_staff: staff.length,
    agency_admins: staff.filter((member) => member.role === 'agency_admin').length,
    scoped_staff: scopedStaff.length,
    unassigned_staff: unassignedStaff.length,
    pending_invites: invites.filter((invite) => invite.status === 'pending').length,
    expired_invites: invites.filter((invite) => invite.status === 'expired').length,
    failed_invite_emails: invites.filter((invite) => invite.email_status === 'failed').length,
    buildings_without_direct_staff: buildingsWithoutDirectStaff,
  };
}

function buildAgencyAttentionQueue(
  buildings: AgencyPortfolio['buildings'],
): AgencyPortfolioAttentionItem[] {
  const items: AgencyPortfolioAttentionItem[] = [];
  const candidates: AgencyPortfolioAttentionKind[] = [
    'urgent_tickets',
    'vendor_sla_problems',
    'overdue_dues',
    'pending_payment_proofs',
    'pending_residents',
    'proposals_missing_budget',
  ];

  for (const building of buildings) {
    for (const kind of candidates) {
      const countValue = Number(building.metrics[kind] || 0);
      if (countValue <= 0) continue;
      const config = ATTENTION_CONFIG[kind];
      items.push({
        id: `${building.id}:${kind}`,
        kind,
        severity: config.severity,
        condominium_id: building.id,
        condominium_name: building.name,
        count: countValue,
        route: config.route,
      });
    }
  }

  return items
    .sort((a, b) => {
      const priorityDiff = ATTENTION_CONFIG[b.kind].priority - ATTENTION_CONFIG[a.kind].priority;
      if (priorityDiff !== 0) return priorityDiff;
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      return a.condominium_name.localeCompare(b.condominium_name);
    })
    .slice(0, 12);
}

export function buildAgencyPortfolio(membership: AgencyMembership): AgencyPortfolio {
  const allowedBuildingIds = buildingIdsForMembership(membership);
  const placeholders = allowedBuildingIds.map(() => '?').join(',');
  const condos = allowedBuildingIds.length === 0
    ? []
    : db.prepare(
      `SELECT c.id, c.name, c.address, c.invite_code
       FROM agency_condominiums ac
       JOIN condominiums c ON c.id = ac.condominium_id
       WHERE ac.agency_id = ? AND c.id IN (${placeholders})
       ORDER BY c.name`
    ).all(membership.agency_id, ...allowedBuildingIds) as Array<{
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
      acc[key as keyof AgencyBuildingMetrics] += Number(value || 0);
    }
    return acc;
  }, zeroMetrics());

  return {
    id: membership.agency_id,
    name: membership.agency_name,
    slug: membership.slug,
    role: membership.role,
    capabilities: agencyCapabilitiesForRole(membership.role),
    totals,
    permission_review: membership.role === 'agency_admin'
      ? buildAgencyPermissionReview(membership.agency_id, buildings)
      : null,
    attention: buildAgencyAttentionQueue(buildings),
    buildings,
  };
}

export function agencyPortfoliosForUser(userId: number): AgencyPortfolio[] {
  return userAgencyMemberships(userId).map(buildAgencyPortfolio);
}

function countAgencyAdmins(agencyId: number): number {
  return count(
    `SELECT COUNT(*) AS count FROM agency_memberships WHERE agency_id = ? AND role = 'agency_admin'`,
    agencyId,
  );
}

function mapStaffMember(row: Omit<AgencyStaffMember, 'assigned_building_ids'>): AgencyStaffMember {
  const assigned = db.prepare(
    `SELECT condominium_id
     FROM agency_member_buildings
     WHERE agency_membership_id = ?
     ORDER BY condominium_id`
  ).all(row.id) as Array<{ condominium_id: number }>;
  return {
    ...row,
    assigned_building_ids: assigned.map((item) => Number(item.condominium_id)),
  };
}

function agencyStaffInviteStatus(row: Pick<AgencyStaffInvite, 'accepted_at' | 'revoked_at' | 'expires_at'>): AgencyStaffInvite['status'] {
  if (row.accepted_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) <= Date.now()) return 'expired';
  return 'pending';
}

function parseInviteBuildingIds(raw: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return normalizeBuildingIds(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function mapStaffInvite(row: any): AgencyStaffInvite {
  const invite: AgencyStaffInvite = {
    id: Number(row.id),
    agency_id: Number(row.agency_id),
    agency_name: row.agency_name,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at || null,
    accepted_by_user_id: row.accepted_by_user_id ?? null,
    revoked_at: row.revoked_at || null,
    created_by_user_id: row.created_by_user_id ?? null,
    email_status: row.email_status || null,
    email_sent_at: row.email_sent_at || null,
    email_error: row.email_error || null,
    assigned_building_ids: parseInviteBuildingIds(row.building_ids),
    status: 'pending',
  };
  invite.status = agencyStaffInviteStatus(invite);
  return invite;
}

function randomInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

function hashAgencyStaffInviteToken(token: string): string {
  return createHash('sha256').update(String(token || '').trim()).digest('hex');
}

export function listAgencyStaff(agencyId: number): AgencyStaffMember[] {
  if (!agencyById(agencyId)) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  const rows = db.prepare(
    `SELECT am.id, am.user_id, u.email, u.first_name, u.last_name, am.role, am.created_at
     FROM agency_memberships am
     JOIN users u ON u.id = am.user_id
     WHERE am.agency_id = ?
     ORDER BY
       CASE am.role WHEN 'agency_admin' THEN 0 ELSE 1 END,
       lower(u.email)`
  ).all(agencyId) as Array<Omit<AgencyStaffMember, 'assigned_building_ids'>>;
  return rows.map(mapStaffMember);
}

export function listAgencyStaffInvites(agencyId: number): AgencyStaffInvite[] {
  if (!agencyById(agencyId)) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  const rows = db.prepare(
    `SELECT asi.id, asi.agency_id, a.name AS agency_name, asi.email, asi.role,
            asi.building_ids, asi.expires_at, asi.accepted_at, asi.accepted_by_user_id,
            asi.revoked_at, asi.created_by_user_id, asi.email_status, asi.email_sent_at,
            asi.email_error, asi.created_at
     FROM agency_staff_invites asi
     JOIN agencies a ON a.id = asi.agency_id
     WHERE asi.agency_id = ?
     ORDER BY asi.created_at DESC, asi.id DESC`
  ).all(agencyId);
  return rows.map(mapStaffInvite);
}

export function createAgencyStaffInvite(input: {
  agencyId: number;
  email: string;
  role: AgencyRole;
  buildingIds?: number[] | null;
  createdByUserId?: number | null;
  expiresAt?: string | null;
}): CreatedAgencyStaffInvite {
  const agency = agencyById(input.agencyId);
  if (!agency) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  if (!isAgencyRole(input.role)) throw Object.assign(new Error('invalid_agency_role'), { status: 400 });

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw Object.assign(new Error('invalid_email'), { status: 400 });
  }
  const buildingIds = validateAgencyBuildingIds(input.agencyId, input.role === 'agency_admin' ? [] : normalizeBuildingIds(input.buildingIds));
  if (input.role !== 'agency_admin' && buildingIds.length === 0) {
    throw Object.assign(new Error('building_assignment_required'), { status: 400 });
  }
  const expiresAt = input.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw Object.assign(new Error('invalid_expires_at'), { status: 400 });
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const token = randomInviteToken();
    try {
      const result = db.prepare(
        `INSERT INTO agency_staff_invites (
           agency_id, email, role, building_ids, token_hash, expires_at, created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.agencyId,
        email,
        input.role,
        JSON.stringify(buildingIds),
        hashAgencyStaffInviteToken(token),
        expiresAt,
        input.createdByUserId || null,
      );
      const invite = listAgencyStaffInvites(input.agencyId).find((item) => item.id === Number(result.lastInsertRowid));
      if (!invite) throw new Error('agency_staff_invite_not_found');
      return { ...invite, token };
    } catch (err) {
      if (attempt === 7) {
        throw Object.assign(new Error('agency_staff_invite_generation_failed'), { status: 500, cause: err });
      }
    }
  }
  throw Object.assign(new Error('agency_staff_invite_generation_failed'), { status: 500 });
}

export function recordAgencyStaffInviteEmailDelivery(inviteId: number, delivery: EmailDeliveryResult): void {
  db.prepare(
    `UPDATE agency_staff_invites
     SET email_status = ?,
         email_sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE email_sent_at END,
         email_error = ?
     WHERE id = ?`
  ).run(delivery.status, delivery.status, delivery.error || null, inviteId);
}

function firstBuildingForAgency(agencyId: number): number | null {
  const row = db.prepare(
    `SELECT condominium_id
     FROM agency_condominiums
     WHERE agency_id = ?
     ORDER BY condominium_id
     LIMIT 1`
  ).get(agencyId) as { condominium_id: number } | undefined;
  return row?.condominium_id || null;
}

function selectUserFields(userId: number) {
  return db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name,
            unit_number, avatar_url, mobile_phone, home_phone, email_verified_at
     FROM users
     WHERE id = ?`
  ).get(userId);
}

function activateAgencyStaffUser(userId: number, agencyId: number, role: AgencyRole, buildingIds: number[], preferredBuildingId?: number | null): void {
  const activeBuildingId = preferredBuildingId || (role === 'agency_admin'
    ? firstBuildingForAgency(agencyId)
    : buildingIds[0] || firstBuildingForAgency(agencyId));
  db.prepare(
    `UPDATE users
     SET role = 'board_admin',
         condominium_id = COALESCE(?, condominium_id)
     WHERE id = ?`
  ).run(activeBuildingId, userId);
}

export function switchAgencyActiveBuilding(input: {
  userId: number;
  agencyId: number;
  condominiumId: number;
}) {
  const membership = userAgencyMembership(input.userId, input.agencyId);
  if (!membership) throw Object.assign(new Error('agency_membership_not_found'), { status: 404 });
  const allowedBuildingIds = buildingIdsForMembership(membership);
  if (!allowedBuildingIds.includes(input.condominiumId)) {
    throw Object.assign(new Error('agency_building_forbidden'), { status: 403 });
  }
  activateAgencyStaffUser(input.userId, input.agencyId, membership.role, allowedBuildingIds, input.condominiumId);
  return selectUserFields(input.userId);
}

export function acceptAgencyStaffInvite(input: {
  token: string;
  userId: number;
}): { invite: AgencyStaffInvite; staff: AgencyStaffMember } {
  const tokenHash = hashAgencyStaffInviteToken(input.token);
  const row = db.prepare(
    `SELECT asi.id, asi.agency_id, a.name AS agency_name, asi.email, asi.role,
            asi.building_ids, asi.expires_at, asi.accepted_at, asi.accepted_by_user_id,
            asi.revoked_at, asi.created_by_user_id, asi.email_status, asi.email_sent_at,
            asi.email_error, asi.created_at
     FROM agency_staff_invites asi
     JOIN agencies a ON a.id = asi.agency_id
     WHERE asi.token_hash = ?
     LIMIT 1`
  ).get(tokenHash);
  if (!row) throw Object.assign(new Error('invalid_agency_staff_invite'), { status: 404 });
  const invite = mapStaffInvite(row);
  if (invite.revoked_at) throw Object.assign(new Error('agency_staff_invite_revoked'), { status: 403 });
  if (invite.accepted_at) throw Object.assign(new Error('agency_staff_invite_accepted'), { status: 409 });
  if (Date.parse(invite.expires_at) <= Date.now()) throw Object.assign(new Error('agency_staff_invite_expired'), { status: 403 });

  const user = db.prepare(
    `SELECT id, email FROM users WHERE id = ? LIMIT 1`
  ).get(input.userId) as { id: number; email: string } | undefined;
  if (!user) throw Object.assign(new Error('user_not_found'), { status: 404 });
  if (user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
    throw Object.assign(new Error('invite_email_mismatch'), { status: 403 });
  }

  const staff = upsertAgencyStaff({
    agencyId: invite.agency_id,
    email: invite.email,
    role: invite.role,
    buildingIds: invite.role === 'agency_admin' ? [] : invite.assigned_building_ids,
  });
  db.prepare(
    `UPDATE agency_staff_invites
     SET accepted_at = CURRENT_TIMESTAMP,
         accepted_by_user_id = ?
     WHERE id = ?`
  ).run(input.userId, invite.id);

  const acceptedInvite = listAgencyStaffInvites(invite.agency_id).find((item) => item.id === invite.id)!;
  return { invite: acceptedInvite, staff };
}

export function upsertAgencyStaff(input: {
  agencyId: number;
  email: string;
  role: AgencyRole;
  buildingIds?: number[] | null;
}): AgencyStaffMember {
  if (!agencyById(input.agencyId)) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  if (!isAgencyRole(input.role)) throw Object.assign(new Error('invalid_agency_role'), { status: 400 });

  const user = db.prepare(
    `SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1`
  ).get(input.email.trim()) as { id: number } | undefined;
  if (!user) throw Object.assign(new Error('staff_user_not_found'), { status: 404 });

  const existing = db.prepare(
    `SELECT id, role FROM agency_memberships WHERE agency_id = ? AND user_id = ? LIMIT 1`
  ).get(input.agencyId, user.id) as { id: number; role: AgencyRole } | undefined;
  if (existing?.role === 'agency_admin' && input.role !== 'agency_admin' && countAgencyAdmins(input.agencyId) <= 1) {
    throw Object.assign(new Error('last_agency_admin'), { status: 400 });
  }

  const buildingIds = normalizeBuildingIds(input.buildingIds);
  if (input.role !== 'agency_admin' && buildingIds.length === 0) {
    throw Object.assign(new Error('building_assignment_required'), { status: 400 });
  }

  if (existing) {
    db.prepare(`UPDATE agency_memberships SET role = ? WHERE id = ?`).run(input.role, existing.id);
  } else {
    db.prepare(
      `INSERT INTO agency_memberships (agency_id, user_id, role) VALUES (?, ?, ?)`
    ).run(input.agencyId, user.id, input.role);
  }

  const membership = db.prepare(
    `SELECT id FROM agency_memberships WHERE agency_id = ? AND user_id = ? LIMIT 1`
  ).get(input.agencyId, user.id) as { id: number };
  setAgencyMemberBuildings(input.agencyId, membership.id, input.role === 'agency_admin' ? [] : buildingIds);
  activateAgencyStaffUser(user.id, input.agencyId, input.role, input.role === 'agency_admin' ? [] : buildingIds);

  const row = db.prepare(
    `SELECT am.id, am.user_id, u.email, u.first_name, u.last_name, am.role, am.created_at
     FROM agency_memberships am
     JOIN users u ON u.id = am.user_id
     WHERE am.id = ?`
  ).get(membership.id) as Omit<AgencyStaffMember, 'assigned_building_ids'>;
  return mapStaffMember(row);
}

export function updateAgencyStaff(input: {
  agencyId: number;
  membershipId: number;
  role?: AgencyRole | null;
  buildingIds?: number[] | null;
}): AgencyStaffMember {
  const membership = agencyMembershipById(input.agencyId, input.membershipId);
  if (!membership) throw Object.assign(new Error('agency_staff_not_found'), { status: 404 });

  const nextRole = input.role || membership.role;
  if (!isAgencyRole(nextRole)) throw Object.assign(new Error('invalid_agency_role'), { status: 400 });
  if (membership.role === 'agency_admin' && nextRole !== 'agency_admin' && countAgencyAdmins(input.agencyId) <= 1) {
    throw Object.assign(new Error('last_agency_admin'), { status: 400 });
  }

  const nextBuildings = input.buildingIds === undefined
    ? buildingIdsForMembership(membership)
    : normalizeBuildingIds(input.buildingIds);
  if (nextRole !== 'agency_admin' && nextBuildings.length === 0) {
    throw Object.assign(new Error('building_assignment_required'), { status: 400 });
  }

  db.prepare(`UPDATE agency_memberships SET role = ? WHERE id = ?`).run(nextRole, input.membershipId);
  setAgencyMemberBuildings(input.agencyId, input.membershipId, nextRole === 'agency_admin' ? [] : nextBuildings);
  activateAgencyStaffUser(membership.user_id, input.agencyId, nextRole, nextRole === 'agency_admin' ? [] : nextBuildings);

  const row = db.prepare(
    `SELECT am.id, am.user_id, u.email, u.first_name, u.last_name, am.role, am.created_at
     FROM agency_memberships am
     JOIN users u ON u.id = am.user_id
     WHERE am.id = ?`
  ).get(input.membershipId) as Omit<AgencyStaffMember, 'assigned_building_ids'>;
  return mapStaffMember(row);
}

export function removeAgencyStaff(input: {
  agencyId: number;
  membershipId: number;
  actorUserId?: number | null;
}): AgencyStaffMember {
  const membership = agencyMembershipById(input.agencyId, input.membershipId);
  if (!membership) throw Object.assign(new Error('agency_staff_not_found'), { status: 404 });
  if (input.actorUserId && membership.user_id === input.actorUserId) {
    throw Object.assign(new Error('cannot_remove_self'), { status: 400 });
  }
  if (membership.role === 'agency_admin' && countAgencyAdmins(input.agencyId) <= 1) {
    throw Object.assign(new Error('last_agency_admin'), { status: 400 });
  }

  const staff = listAgencyStaff(input.agencyId).find((item) => item.id === input.membershipId);
  db.prepare(`DELETE FROM agency_memberships WHERE id = ?`).run(input.membershipId);
  if (!staff) throw Object.assign(new Error('agency_staff_not_found'), { status: 404 });
  return staff;
}

type AgencySetupCodeRow = Omit<AgencySetupCode, 'status' | 'activation_count' | 'last_activated_at' | 'last_activated_condominium_id' | 'last_activated_condominium_name' | 'last_activated_by_email'> & Partial<Pick<
  AgencySetupCode,
  'activation_count' | 'last_activated_at' | 'last_activated_condominium_id' | 'last_activated_condominium_name' | 'last_activated_by_email'
>>;

function setupCodeStatus(row: AgencySetupCodeRow): AgencySetupCode['status'] {
  if (row.disabled_at) return 'disabled';
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return 'expired';
  if (row.used_count >= row.max_uses) return 'exhausted';
  return 'active';
}

function mapSetupCode(row: AgencySetupCodeRow): AgencySetupCode {
  return {
    ...row,
    activation_count: Number(row.activation_count || 0),
    last_activated_at: row.last_activated_at || null,
    last_activated_condominium_id: row.last_activated_condominium_id || null,
    last_activated_condominium_name: row.last_activated_condominium_name || null,
    last_activated_by_email: row.last_activated_by_email || null,
    status: setupCodeStatus(row),
  };
}

function randomSetupCode(): string {
  return normalizeSetupCode(`CONDOS-${randomBytes(4).toString('hex')}`);
}

export function createAgencySetupCode(input: {
  agencyId: number;
  actorUserId: number;
  label?: string | null;
  code?: string | null;
  maxUses?: number | null;
  expiresAt?: string | null;
}): CreatedAgencySetupCode {
  const agency = agencyById(input.agencyId);
  if (!agency) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  const fixedCode = input.code ? normalizeSetupCode(input.code) : null;
  const maxUses = Math.max(1, Math.min(500, Math.floor(Number(input.maxUses || 1))));
  const label = input.label?.trim() || null;
  const expiresAt = input.expiresAt || null;
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw Object.assign(new Error('invalid_expires_at'), { status: 400 });
  }

  const attempts = fixedCode ? 1 : 8;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const code = fixedCode || randomSetupCode();
    if (!code || code.length > 80) {
      throw Object.assign(new Error('invalid_setup_code'), { status: 400 });
    }
    try {
      const result = db.prepare(
        `INSERT INTO private_setup_codes (code_hash, label, agency_name, max_uses, expires_at, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(hashSetupCode(code), label, agency.name, maxUses, expiresAt, input.actorUserId);
      const created = db.prepare(
        `SELECT id, label, agency_name, max_uses, used_count, expires_at, disabled_at,
                created_by_user_id, created_at, last_used_at
         FROM private_setup_codes
         WHERE id = ?`
      ).get(Number(result.lastInsertRowid)) as AgencySetupCodeRow;
      return { ...mapSetupCode(created), code };
    } catch (err) {
      if (fixedCode || attempt === attempts - 1) {
        throw Object.assign(new Error('setup_code_already_exists'), { status: 409, cause: err });
      }
    }
  }
  throw Object.assign(new Error('setup_code_generation_failed'), { status: 500 });
}

export function listAgencySetupCodes(agencyId: number): AgencySetupCode[] {
  const agency = agencyById(agencyId);
  if (!agency) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  const rows = db.prepare(
    `SELECT
       p.id, p.label, p.agency_name, p.max_uses, p.used_count, p.expires_at,
       p.disabled_at, p.created_by_user_id, p.created_at, p.last_used_at,
       COALESCE(stats.activation_count, 0) AS activation_count,
       last_activation.created_at AS last_activated_at,
       c.id AS last_activated_condominium_id,
       c.name AS last_activated_condominium_name,
       u.email AS last_activated_by_email
     FROM private_setup_codes p
     LEFT JOIN (
       SELECT setup_code_id, COUNT(*) AS activation_count, MAX(created_at) AS last_activated_at
       FROM private_setup_code_activations
       GROUP BY setup_code_id
     ) stats ON stats.setup_code_id = p.id
     LEFT JOIN private_setup_code_activations last_activation
       ON last_activation.id = (
         SELECT id
         FROM private_setup_code_activations
         WHERE setup_code_id = p.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
     LEFT JOIN condominiums c ON c.id = last_activation.condominium_id
     LEFT JOIN users u ON u.id = last_activation.activated_by_user_id
     WHERE lower(COALESCE(p.agency_name, '')) = lower(?)
     ORDER BY p.created_at DESC, p.id DESC`
  ).all(agency.name) as AgencySetupCodeRow[];
  return rows.map(mapSetupCode);
}

export function disableAgencySetupCode(agencyId: number, setupCodeId: number): AgencySetupCode {
  const agency = agencyById(agencyId);
  if (!agency) throw Object.assign(new Error('agency_not_found'), { status: 404 });
  const existing = db.prepare(
    `SELECT id
     FROM private_setup_codes
     WHERE id = ? AND lower(COALESCE(agency_name, '')) = lower(?)
     LIMIT 1`
  ).get(setupCodeId, agency.name);
  if (!existing) throw Object.assign(new Error('setup_code_not_found'), { status: 404 });

  db.prepare(
    `UPDATE private_setup_codes
     SET disabled_at = COALESCE(disabled_at, CURRENT_TIMESTAMP)
     WHERE id = ?`
  ).run(setupCodeId);

  const row = db.prepare(
    `SELECT id, label, agency_name, max_uses, used_count, expires_at, disabled_at,
            created_by_user_id, created_at, last_used_at
     FROM private_setup_codes
     WHERE id = ?`
  ).get(setupCodeId) as AgencySetupCodeRow;
  return mapSetupCode(row);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function placeholders(ids: number[]): string {
  return ids.map(() => '?').join(',');
}

export function agencyOperationalExportToCsv(membership: AgencyMembership, kind: AgencyExportKind): string {
  const buildingIds = buildingIdsForMembership(membership);
  if (buildingIds.length === 0) {
    const emptyHeaders: Record<AgencyExportKind, string[]> = {
      residents: ['condominium_id', 'condominium_name', 'user_id', 'email', 'first_name', 'last_name', 'role', 'mobile_phone', 'home_phone', 'unit_numbers', 'active_units', 'pending_units', 'created_at'],
      finance: ['condominium_id', 'condominium_name', 'record_type', 'record_id', 'unit_number', 'period', 'date', 'status', 'amount_cents', 'currency', 'method', 'reference', 'category', 'vendor', 'description'],
      tickets: ['condominium_id', 'condominium_name', 'ticket_id', 'title', 'category', 'priority', 'status', 'remediation_status', 'reporter_email', 'unit_number', 'created_at', 'updated_at'],
      'work-orders': ['condominium_id', 'condominium_name', 'work_order_id', 'ticket_id', 'title', 'status', 'vendor', 'estimated_amount_cents', 'approved_amount_cents', 'scheduled_for', 'completed_at', 'updated_at'],
      audit: ['id', 'created_at', 'condominium_id', 'condominium_name', 'actor_user_id', 'actor_email', 'action', 'target_type', 'target_id', 'metadata', 'ip'],
    };
    return rowsToCsv(emptyHeaders[kind], []);
  }

  const ids = placeholders(buildingIds);
  if (kind === 'residents') {
    const headers = ['condominium_id', 'condominium_name', 'user_id', 'email', 'first_name', 'last_name', 'role', 'mobile_phone', 'home_phone', 'unit_numbers', 'active_units', 'pending_units', 'created_at'];
    const rows = db.prepare(
      `SELECT
         c.id AS condominium_id,
         c.name AS condominium_name,
         u.id AS user_id,
         u.email,
         u.first_name,
         u.last_name,
         u.role,
         u.mobile_phone,
         u.home_phone,
         GROUP_CONCAT(DISTINCT COALESCE(b.name || ' ', '') || un.number) AS unit_numbers,
         SUM(CASE WHEN uu.status = 'active' THEN 1 ELSE 0 END) AS active_units,
         SUM(CASE WHEN uu.status = 'pending' THEN 1 ELSE 0 END) AS pending_units,
         u.created_at
       FROM users u
       JOIN condominiums c ON c.id = u.condominium_id
       LEFT JOIN user_unit uu ON uu.user_id = u.id
       LEFT JOIN units un ON un.id = uu.unit_id
       LEFT JOIN buildings b ON b.id = un.building_id
       WHERE c.id IN (${ids})
       GROUP BY c.id, u.id
       ORDER BY c.name, lower(u.last_name), lower(u.first_name), lower(u.email)`
    ).all(...buildingIds) as Array<Record<string, unknown>>;
    return rowsToCsv(headers, rows);
  }

  if (kind === 'finance') {
    const headers = ['condominium_id', 'condominium_name', 'record_type', 'record_id', 'unit_number', 'period', 'date', 'status', 'amount_cents', 'currency', 'method', 'reference', 'category', 'vendor', 'description'];
    const rows = db.prepare(
      `SELECT * FROM (
         SELECT c.id AS condominium_id, c.name AS condominium_name, 'invoice' AS record_type,
                i.id AS record_id, un.number AS unit_number, i.period, i.due_date AS date,
                i.status, i.amount_cents, i.currency, '' AS method, '' AS reference,
                'dues' AS category, '' AS vendor, COALESCE(i.notes, '') AS description
         FROM invoices i
         JOIN condominiums c ON c.id = i.condominium_id
         JOIN units un ON un.id = i.unit_id
         WHERE i.condominium_id IN (${ids})
         UNION ALL
         SELECT c.id AS condominium_id, c.name AS condominium_name, 'payment' AS record_type,
                p.id AS record_id, un.number AS unit_number, i.period, p.paid_at AS date,
                'paid' AS status, p.amount_cents, i.currency, p.method, COALESCE(p.reference, ''),
                'dues' AS category, '' AS vendor, 'Payment received' AS description
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN condominiums c ON c.id = p.condominium_id
         JOIN units un ON un.id = i.unit_id
         WHERE p.condominium_id IN (${ids})
         UNION ALL
         SELECT c.id AS condominium_id, c.name AS condominium_name, 'expense' AS record_type,
                e.id AS record_id, '' AS unit_number, '' AS period, e.spent_at AS date,
                'spent' AS status, e.amount_cents, e.currency, '' AS method, '' AS reference,
                e.category, COALESCE(e.vendor, ''), e.description
         FROM expenses e
         JOIN condominiums c ON c.id = e.condominium_id
         WHERE e.condominium_id IN (${ids})
       )
       ORDER BY condominium_name, date DESC, record_type, record_id DESC`
    ).all(...buildingIds, ...buildingIds, ...buildingIds) as Array<Record<string, unknown>>;
    return rowsToCsv(headers, rows);
  }

  if (kind === 'tickets') {
    const headers = ['condominium_id', 'condominium_name', 'ticket_id', 'title', 'category', 'priority', 'status', 'remediation_status', 'reporter_email', 'unit_number', 'created_at', 'updated_at'];
    const rows = db.prepare(
      `SELECT c.id AS condominium_id, c.name AS condominium_name, t.id AS ticket_id,
              t.title, t.category, t.priority, t.status, t.remediation_status,
              u.email AS reporter_email, un.number AS unit_number, t.created_at, t.updated_at
       FROM tickets t
       JOIN condominiums c ON c.id = t.condominium_id
       JOIN users u ON u.id = t.reporter_id
       LEFT JOIN units un ON un.id = t.unit_id
       WHERE t.condominium_id IN (${ids})
       ORDER BY c.name, t.updated_at DESC, t.id DESC`
    ).all(...buildingIds) as Array<Record<string, unknown>>;
    return rowsToCsv(headers, rows);
  }

  if (kind === 'work-orders') {
    const headers = ['condominium_id', 'condominium_name', 'work_order_id', 'ticket_id', 'title', 'status', 'vendor', 'estimated_amount_cents', 'approved_amount_cents', 'scheduled_for', 'completed_at', 'updated_at'];
    const rows = db.prepare(
      `SELECT c.id AS condominium_id, c.name AS condominium_name, wo.id AS work_order_id,
              t.id AS ticket_id, wo.title, wo.status, COALESCE(sc.company_name, '') AS vendor,
              wo.estimated_amount_cents, wo.approved_amount_cents,
              wo.scheduled_for, wo.completed_at, wo.updated_at
       FROM ticket_work_orders wo
       JOIN tickets t ON t.id = wo.ticket_id
       JOIN condominiums c ON c.id = t.condominium_id
       LEFT JOIN service_contacts sc ON sc.id = wo.service_contact_id
       WHERE t.condominium_id IN (${ids})
       ORDER BY c.name, wo.updated_at DESC, wo.id DESC`
    ).all(...buildingIds) as Array<Record<string, unknown>>;
    return rowsToCsv(headers, rows);
  }

  const headers = ['id', 'created_at', 'condominium_id', 'condominium_name', 'actor_user_id', 'actor_email', 'action', 'target_type', 'target_id', 'metadata', 'ip'];
  const agencyNeedle = `%"agency_id":${membership.agency_id}%`;
  const rows = db.prepare(
    `SELECT al.id, al.created_at, al.condominium_id, c.name AS condominium_name,
            al.actor_user_id, al.actor_email, al.action, al.target_type,
            al.target_id, al.metadata, al.ip
     FROM audit_log al
     LEFT JOIN condominiums c ON c.id = al.condominium_id
     WHERE al.condominium_id IN (${ids})
        OR al.metadata LIKE ?
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT 1000`
  ).all(...buildingIds, agencyNeedle) as Array<Record<string, unknown>>;
  return rowsToCsv(headers, rows);
}

export function listAgencyAuditEvents(membership: AgencyMembership, limitInput = 25): AgencyAuditEvent[] {
  const buildingIds = buildingIdsForMembership(membership);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(limitInput) || 25)));
  const agencyNeedle = `%"agency_id":${membership.agency_id}%`;
  const buildingClause = buildingIds.length > 0
    ? `al.condominium_id IN (${placeholders(buildingIds)})`
    : '0 = 1';
  const rows = db.prepare(
    `SELECT al.id, al.created_at, al.condominium_id, c.name AS condominium_name,
            al.actor_user_id, al.actor_email, al.action, al.target_type,
            al.target_id, al.metadata
     FROM audit_log al
     LEFT JOIN condominiums c ON c.id = al.condominium_id
     WHERE ${buildingClause}
        OR al.metadata LIKE ?
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ?`
  ).all(...buildingIds, agencyNeedle, limit) as AgencyAuditEvent[];
  return rows;
}

export function agencyPortfolioToCsv(portfolio: AgencyPortfolio): string {
  const headers = [
    'agency_id',
    'agency_name',
    'building_id',
    'building_name',
    'address',
    'invite_code',
    'pending_residents',
    'unresolved_tickets',
    'urgent_tickets',
    'overdue_dues',
    'pending_payment_proofs',
    'vendor_sla_problems',
    'proposals_missing_budget',
    'upcoming_meetings',
  ];
  const lines = [headers.join(',')];
  for (const building of portfolio.buildings) {
    lines.push(headers.map((header) => {
      const source: Record<string, unknown> = {
        agency_id: portfolio.id,
        agency_name: portfolio.name,
        building_id: building.id,
        building_name: building.name,
        address: building.address,
        invite_code: building.invite_code,
        ...building.metrics,
      };
      return csvCell(source[header]);
    }).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function normalizeAgencyReportMonth(input?: string | null): string {
  if (input && /^\d{4}-\d{2}$/.test(input)) return input;
  return new Date().toISOString().slice(0, 7);
}

function markdownText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'N/A';
}

function formatMoneyByCurrency(rows: Array<{ currency: string | null; amount_cents: number | null }>): string {
  const parts = rows
    .map((row) => {
      const amount = Number(row.amount_cents || 0);
      if (amount <= 0) return null;
      const currency = String(row.currency || 'BRL').toUpperCase();
      return `${currency} ${(amount / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '0.00';
}

function moneyByCurrency(sql: string, ...params: unknown[]): string {
  const rows = db.prepare(sql).all(...params) as Array<{ currency: string | null; amount_cents: number | null }>;
  return formatMoneyByCurrency(rows);
}

function expenseReceiptCoverage(condominiumId: number, month: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN receipt_url IS NOT NULL OR receipt_file_id IS NOT NULL THEN 1 ELSE 0 END) AS with_receipt
     FROM expenses
     WHERE condominium_id = ?
       AND substr(spent_at, 1, 7) = ?`
  ).get(condominiumId, month) as { total: number; with_receipt: number | null } | undefined;
  const total = Number(row?.total || 0);
  if (total <= 0) return 100;
  return Math.round((Number(row?.with_receipt || 0) / total) * 100);
}

function agencyNextActions(building: AgencyPortfolio['buildings'][number]): string[] {
  const actions: string[] = [];
  if (building.metrics.urgent_tickets > 0) actions.push(`Review ${building.metrics.urgent_tickets} urgent ticket(s).`);
  if (building.metrics.vendor_sla_problems > 0) actions.push(`Escalate ${building.metrics.vendor_sla_problems} vendor SLA problem(s).`);
  if (building.metrics.overdue_dues > 0) actions.push(`Follow up on ${building.metrics.overdue_dues} overdue due(s).`);
  if (building.metrics.pending_payment_proofs > 0) actions.push(`Review ${building.metrics.pending_payment_proofs} payment proof(s).`);
  if (building.metrics.pending_residents > 0) actions.push(`Approve or reject ${building.metrics.pending_residents} pending resident request(s).`);
  if (building.metrics.proposals_missing_budget > 0) actions.push(`Add budget analysis to ${building.metrics.proposals_missing_budget} proposal(s).`);
  if (actions.length === 0) actions.push('No immediate agency action flagged by current metrics.');
  return actions;
}

function buildAgencyMonthlyReportMarkdown(report: Omit<AgencyMonthlyReport, 'markdown'>): string {
  const lines = [
    `# CONDOS agency report - ${markdownText(report.agency_name)} - ${report.month}`,
    '',
    `Generated: ${report.generated_at}`,
    `Scope: ${report.buildings.length} building(s) visible to ${report.role}`,
    '',
    '## Portfolio attention',
  ];

  if (report.attention.length === 0) {
    lines.push('- No urgent portfolio actions right now.');
  } else {
    for (const item of report.attention.slice(0, 12)) {
      lines.push(`- ${markdownText(item.condominium_name)}: ${item.count} ${item.kind.replace(/_/g, ' ')} (${item.severity})`);
    }
  }

  lines.push(
    '',
    '## Portfolio totals',
    `- Pending residents: ${report.totals.pending_residents}`,
    `- Open tickets: ${report.totals.unresolved_tickets}`,
    `- Urgent tickets: ${report.totals.urgent_tickets}`,
    `- Overdue dues: ${report.totals.overdue_dues}`,
    `- Pending payment proofs: ${report.totals.pending_payment_proofs}`,
    `- Vendor SLA problems: ${report.totals.vendor_sla_problems}`,
    `- Proposals missing budget: ${report.totals.proposals_missing_budget}`,
    `- Upcoming meetings: ${report.totals.upcoming_meetings}`,
    '',
    '## Buildings',
  );

  if (report.buildings.length === 0) {
    lines.push('- No buildings are visible for this agency member.');
  }

  for (const building of report.buildings) {
    lines.push(
      '',
      `### ${markdownText(building.condominium_name)}`,
      `- Month activity: ${building.month.tickets_opened} ticket(s) opened, ${building.month.work_orders_completed} work order(s) completed.`,
      `- Finance: billed ${building.month.dues_billed}; received ${building.month.payments_received}; expenses ${building.month.expenses_spent}; receipt coverage ${building.month.expense_receipt_coverage_percent}%.`,
      `- Current risk: ${building.metrics.urgent_tickets} urgent ticket(s), ${building.metrics.vendor_sla_problems} vendor SLA problem(s), ${building.metrics.overdue_dues} overdue due(s).`,
      '- Next actions:',
      ...building.next_actions.map((action) => `  - ${action}`),
    );
  }

  return `${lines.join('\n')}\n`;
}

export function buildAgencyMonthlyReport(membership: AgencyMembership, monthInput?: string | null): AgencyMonthlyReport {
  const month = normalizeAgencyReportMonth(monthInput);
  const portfolio = buildAgencyPortfolio(membership);

  const buildings = portfolio.buildings.map((building) => ({
    condominium_id: building.id,
    condominium_name: building.name,
    metrics: building.metrics,
    month: {
      tickets_opened: count(
        `SELECT COUNT(*) AS count
         FROM tickets
         WHERE condominium_id = ?
           AND substr(created_at, 1, 7) = ?`,
        building.id,
        month,
      ),
      work_orders_completed: count(
        `SELECT COUNT(*) AS count
         FROM ticket_work_orders wo
         JOIN tickets t ON t.id = wo.ticket_id
         WHERE t.condominium_id = ?
           AND wo.completed_at IS NOT NULL
           AND substr(wo.completed_at, 1, 7) = ?`,
        building.id,
        month,
      ),
      dues_billed: moneyByCurrency(
        `SELECT currency, COALESCE(SUM(amount_cents), 0) AS amount_cents
         FROM invoices
         WHERE condominium_id = ?
           AND period = ?
         GROUP BY currency
         ORDER BY currency`,
        building.id,
        month,
      ),
      payments_received: moneyByCurrency(
        `SELECT COALESCE(i.currency, 'BRL') AS currency, COALESCE(SUM(p.amount_cents), 0) AS amount_cents
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE p.condominium_id = ?
           AND substr(p.paid_at, 1, 7) = ?
         GROUP BY COALESCE(i.currency, 'BRL')
         ORDER BY COALESCE(i.currency, 'BRL')`,
        building.id,
        month,
      ),
      expenses_spent: moneyByCurrency(
        `SELECT currency, COALESCE(SUM(amount_cents), 0) AS amount_cents
         FROM expenses
         WHERE condominium_id = ?
           AND substr(spent_at, 1, 7) = ?
         GROUP BY currency
         ORDER BY currency`,
        building.id,
        month,
      ),
      expense_receipt_coverage_percent: expenseReceiptCoverage(building.id, month),
    },
    next_actions: agencyNextActions(building),
  }));

  const baseReport: Omit<AgencyMonthlyReport, 'markdown'> = {
    agency_id: portfolio.id,
    agency_name: portfolio.name,
    role: portfolio.role,
    month,
    generated_at: new Date().toISOString(),
    totals: portfolio.totals,
    attention: portfolio.attention,
    buildings,
  };

  return {
    ...baseReport,
    markdown: buildAgencyMonthlyReportMarkdown(baseReport),
  };
}
