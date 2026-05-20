import { randomBytes } from 'crypto';
import db from '../db';
import { hashSetupCode, normalizeSetupCode } from './private-access';

export type AgencyRole =
  | 'agency_admin'
  | 'building_admin'
  | 'finance_manager'
  | 'maintenance_manager'
  | 'concierge_supervisor';

export interface AgencyLinkResult {
  agencyId: number;
  agencyName: string;
}

export interface AgencyMembership {
  agency_id: number;
  agency_name: string;
  slug: string;
  role: AgencyRole;
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
  return agency;
}

export function userAgencyMemberships(userId: number) {
  return db.prepare(
    `SELECT a.id AS agency_id, a.name AS agency_name, a.slug, am.role
     FROM agency_memberships am
     JOIN agencies a ON a.id = am.agency_id
     WHERE am.user_id = ?
     ORDER BY a.name`
  ).all(userId) as AgencyMembership[];
}

export function userAgencyMembership(userId: number, agencyId: number): AgencyMembership | null {
  const row = db.prepare(
    `SELECT a.id AS agency_id, a.name AS agency_name, a.slug, am.role
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

function agencyById(agencyId: number): { id: number; name: string; slug: string } | null {
  const row = db.prepare(
    `SELECT id, name, slug FROM agencies WHERE id = ? LIMIT 1`
  ).get(agencyId) as { id: number; name: string; slug: string } | undefined;
  return row || null;
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

export function buildAgencyPortfolio(membership: AgencyMembership): AgencyPortfolio {
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
