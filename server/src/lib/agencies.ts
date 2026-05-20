import db from '../db';

export interface AgencyLinkResult {
  agencyId: number;
  agencyName: string;
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
  role?: 'agency_admin' | 'building_admin' | 'finance_manager' | 'maintenance_manager' | 'concierge_supervisor';
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
  ).all(userId) as Array<{
    agency_id: number;
    agency_name: string;
    slug: string;
    role: string;
  }>;
}
