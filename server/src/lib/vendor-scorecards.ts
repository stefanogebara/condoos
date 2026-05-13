import db from '../db';

export interface ServiceContactWithScorecard {
  id: number;
  condominium_id: number;
  category: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  service_scope: string | null;
  notes: string | null;
  contract_url: string | null;
  emergency_available: number;
  preferred: number;
  active: number;
  last_used_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  dispatches_total: number;
  dispatches_responded: number;
  avg_response_seconds: number | null;
  last_response_at_dispatch: string | null;
  work_orders_total: number;
  work_orders_completed: number;
  work_orders_open: number;
  work_orders_cancelled: number;
  last_work_order_at: string | null;
  work_order_value_cents: number;
  expense_count: number;
  expense_total_cents: number;
  expense_average_cents: number | null;
  expense_currency: string | null;
  last_expense_at: string | null;
}

export function listServiceContactsWithScorecards(
  condoId: number,
  includeInactive = false,
): ServiceContactWithScorecard[] {
  return db.prepare(
    `WITH scoped_contacts AS (
       SELECT *
       FROM service_contacts
       WHERE condominium_id = ?
         AND (? = 1 OR active = 1)
     ),
     dispatch_stats AS (
       SELECT td.service_contact_id,
              SUM(CASE WHEN td.channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN td.status = 'responded' AND td.channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS responded,
              AVG(CASE WHEN td.status = 'responded' AND td.responded_at IS NOT NULL
                       THEN (strftime('%s', td.responded_at) - strftime('%s', td.created_at))
                       ELSE NULL END) AS avg_response_seconds,
              MAX(CASE WHEN td.status = 'responded' THEN td.responded_at ELSE NULL END) AS last_response_at
       FROM ticket_dispatches td
       JOIN tickets t ON t.id = td.ticket_id
       WHERE t.condominium_id = ?
         AND td.service_contact_id IS NOT NULL
       GROUP BY td.service_contact_id
     ),
     work_order_stats AS (
       SELECT wo.service_contact_id,
              COUNT(*) AS total,
              SUM(CASE WHEN wo.status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN wo.status IN ('draft','scheduled','in_progress') THEN 1 ELSE 0 END) AS open_count,
              SUM(CASE WHEN wo.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
              MAX(COALESCE(wo.completed_at, wo.scheduled_for, wo.updated_at, wo.created_at)) AS last_work_order_at,
              SUM(COALESCE(wo.approved_amount_cents, wo.estimated_amount_cents, 0)) AS value_cents
       FROM ticket_work_orders wo
       JOIN tickets t ON t.id = wo.ticket_id
       WHERE t.condominium_id = ?
         AND wo.service_contact_id IS NOT NULL
       GROUP BY wo.service_contact_id
     ),
     expense_stats AS (
       SELECT sc.id AS service_contact_id,
              COUNT(e.id) AS expense_count,
              SUM(COALESCE(e.amount_cents, 0)) AS total_cents,
              AVG(e.amount_cents) AS average_cents,
              MAX(e.currency) AS currency,
              MAX(e.spent_at) AS last_expense_at
       FROM scoped_contacts sc
       LEFT JOIN expenses e
        ON e.condominium_id = sc.condominium_id
        AND e.vendor IS NOT NULL
        AND trim(e.vendor) <> ''
        AND instr(lower(trim(e.vendor)), lower(trim(sc.company_name))) = 1
       GROUP BY sc.id
     )
     SELECT sc.*,
            COALESCE(ds.sent, 0)             AS dispatches_total,
            COALESCE(ds.responded, 0)        AS dispatches_responded,
            ds.avg_response_seconds          AS avg_response_seconds,
            ds.last_response_at              AS last_response_at_dispatch,
            COALESCE(wos.total, 0)           AS work_orders_total,
            COALESCE(wos.completed, 0)       AS work_orders_completed,
            COALESCE(wos.open_count, 0)      AS work_orders_open,
            COALESCE(wos.cancelled, 0)       AS work_orders_cancelled,
            wos.last_work_order_at           AS last_work_order_at,
            COALESCE(wos.value_cents, 0)     AS work_order_value_cents,
            COALESCE(es.expense_count, 0)    AS expense_count,
            COALESCE(es.total_cents, 0)      AS expense_total_cents,
            es.average_cents                 AS expense_average_cents,
            es.currency                      AS expense_currency,
            es.last_expense_at               AS last_expense_at
     FROM scoped_contacts sc
     LEFT JOIN dispatch_stats ds ON ds.service_contact_id = sc.id
     LEFT JOIN work_order_stats wos ON wos.service_contact_id = sc.id
     LEFT JOIN expense_stats es ON es.service_contact_id = sc.id
     ORDER BY sc.preferred DESC, sc.emergency_available DESC, sc.category, sc.company_name`
  ).all(condoId, includeInactive ? 1 : 0, condoId, condoId) as ServiceContactWithScorecard[];
}
