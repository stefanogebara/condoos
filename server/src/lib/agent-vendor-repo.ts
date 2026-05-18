// ARC-R4 — Vendor data for the admin agent's prompt context.
//
// Extracted from runAdminAgentInner so the 8 SQL queries that were
// inline in the runner have a single boundary. Two responsibilities:
//
//   1) Saved-vendor list with reputation stats (response rate, avg
//      response seconds, last_used_at). The model sees these so it
//      prefers proven responders over alphabetic-first.
//
//   2) Cost history per vendor from the expenses ledger, last 24
//      months. Lets the agent anchor estimated_cost_range on actual
//      past spend instead of "confirm by quote".
//
// Both queries are condo-scoped + active=1 + capped at 40 vendors —
// matches the limits the runner used.

import db from '../db';

export interface VendorRecord {
  id: number;
  category: string | null;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  service_scope: string | null;
  notes: string | null;
  emergency_available: number;
  preferred: number;
  last_used_at: string | null;
  dispatches_total: number;
  dispatches_responded: number;
  avg_response_seconds: number | null;
}

export interface VendorCostHistory {
  service_contact_id: number;
  company_name: string;
  expense_count: number;
  total_cents: number | null;
  avg_cents: number | null;
  min_cents: number | null;
  max_cents: number | null;
  last_spent_at: string | null;
  last_amount_cents: number | null;
}

export interface VendorBundle {
  contacts: VendorRecord[];
  costByVendor: Map<string, VendorCostHistory>;
  idByName: Map<string, number>;
}

// Saved vendors + dispatch reputation stats. Sort order matches what
// the picker uses client-side so the model + admin see the same
// ranking. LIMIT 40 — anything beyond is noise in the prompt and the
// admin's picker is paginated anyway.
export function loadServiceContacts(condoId: number): VendorRecord[] {
  return db.prepare(
    `WITH stats AS (
       SELECT service_contact_id,
              SUM(CASE WHEN channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'responded' AND channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS responded,
              AVG(CASE WHEN status = 'responded' AND responded_at IS NOT NULL
                       THEN (strftime('%s', responded_at) - strftime('%s', created_at))
                       ELSE NULL END) AS avg_response_seconds
       FROM ticket_dispatches
       GROUP BY service_contact_id
     )
     SELECT sc.id AS id, sc.category, sc.company_name, sc.contact_name, sc.phone, sc.whatsapp, sc.email, sc.website,
            sc.service_scope, sc.notes, sc.emergency_available, sc.preferred, sc.last_used_at,
            COALESCE(stats.sent, 0) AS dispatches_total,
            COALESCE(stats.responded, 0) AS dispatches_responded,
            stats.avg_response_seconds AS avg_response_seconds
     FROM service_contacts sc
     LEFT JOIN stats ON stats.service_contact_id = sc.id
     WHERE sc.condominium_id = ? AND sc.active = 1
     ORDER BY sc.preferred DESC, sc.emergency_available DESC, sc.company_name ASC
     LIMIT 40`
  ).all(condoId) as VendorRecord[];
}

// Cost history per vendor. Match is `LOWER(expenses.vendor) LIKE
// company_name || '%'` because the free-text vendor column drifts
// (admins type 'Otis', 'Otis Elevadores', 'Otis - SP'). 24 months
// only — older spend isn't a useful estimate signal.
export function loadVendorCostHistory(condoId: number): VendorCostHistory[] {
  return db.prepare(
    `SELECT sc.id           AS service_contact_id,
            sc.company_name AS company_name,
            COUNT(e.id)     AS expense_count,
            SUM(e.amount_cents) AS total_cents,
            AVG(e.amount_cents) AS avg_cents,
            MIN(e.amount_cents) AS min_cents,
            MAX(e.amount_cents) AS max_cents,
            MAX(e.spent_at)     AS last_spent_at,
            (SELECT amount_cents FROM expenses e2
             WHERE e2.condominium_id = sc.condominium_id
               AND LOWER(e2.vendor) LIKE LOWER(sc.company_name) || '%'
             ORDER BY spent_at DESC LIMIT 1) AS last_amount_cents
     FROM service_contacts sc
     LEFT JOIN expenses e
       ON e.condominium_id = sc.condominium_id
      AND LOWER(e.vendor) LIKE LOWER(sc.company_name) || '%'
      AND substr(e.spent_at, 1, 10) >= date('now', '-24 months')
     WHERE sc.condominium_id = ? AND sc.active = 1
     GROUP BY sc.id, sc.company_name
     HAVING expense_count > 0`
  ).all(condoId) as VendorCostHistory[];
}

// One-shot loader: contacts + cost map + name→id map. The id map is
// the SEC-2 binding the sanitizer uses to drop hallucinated vendor
// names — model sees company_name strings, server binds back to a
// real service_contacts.id at decoration time.
export function loadVendorBundle(condoId: number): VendorBundle {
  const contacts = loadServiceContacts(condoId);
  const costHistory = loadVendorCostHistory(condoId);
  const costByVendor = new Map(
    costHistory.map((c) => [String(c.company_name).toLowerCase(), c]),
  );
  const idByName = new Map<string, number>();
  for (const c of contacts) {
    if (c.id != null && c.company_name) {
      idByName.set(String(c.company_name).toLowerCase(), Number(c.id));
    }
  }
  return { contacts, costByVendor, idByName };
}
