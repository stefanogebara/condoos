import { randomBytes } from 'crypto';
import db from '../db';
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

export function isAgencyRole(value: unknown): value is AgencyRole {
  return typeof value === 'string' && (AGENCY_ROLES as string[]).includes(value);
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

export interface AgencyPortfolio {
  id: number;
  name: string;
  slug: string;
  role: AgencyRole;
  totals: AgencyBuildingMetrics;
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
  status: 'active' | 'disabled' | 'expired' | 'exhausted';
}

export interface CreatedAgencySetupCode extends AgencySetupCode {
  code: string;
}

export const AGENCY_EXPORT_KINDS = ['residents', 'finance', 'tickets', 'work-orders', 'audit'] as const;
export type AgencyExportKind = typeof AGENCY_EXPORT_KINDS[number];

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
    totals,
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

function setupCodeStatus(row: Omit<AgencySetupCode, 'status'>): AgencySetupCode['status'] {
  if (row.disabled_at) return 'disabled';
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return 'expired';
  if (row.used_count >= row.max_uses) return 'exhausted';
  return 'active';
}

function mapSetupCode(row: Omit<AgencySetupCode, 'status'>): AgencySetupCode {
  return { ...row, status: setupCodeStatus(row) };
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
      ).get(Number(result.lastInsertRowid)) as Omit<AgencySetupCode, 'status'>;
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
    `SELECT id, label, agency_name, max_uses, used_count, expires_at, disabled_at,
            created_by_user_id, created_at, last_used_at
     FROM private_setup_codes
     WHERE lower(COALESCE(agency_name, '')) = lower(?)
     ORDER BY created_at DESC, id DESC`
  ).all(agency.name) as Array<Omit<AgencySetupCode, 'status'>>;
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
  ).get(setupCodeId) as Omit<AgencySetupCode, 'status'>;
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
