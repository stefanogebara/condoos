import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { normalizeServiceContact, serviceContactSchema } from '../lib/service-contacts';

const router = Router();

router.get('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  // Pilot-readiness — compute vendor reputation from ticket_dispatches and
  // attach it to every row. The picker uses these stats to rank vendors
  // (vendors that never reply drift below ones that do), and the admin-agent
  // prompt includes them so the model can recommend based on track record
  // rather than just category match. Stats are computed in a single CTE so
  // we don't N+1 the dispatch table per vendor.
  //
  // Counts only the rows the worker actually attempted to deliver — manual
  // dispatches don't contribute to response_rate. avg_response_seconds is
  // computed from the responded rows only; null when none.
  const rows = db.prepare(
    `WITH stats AS (
       SELECT service_contact_id,
              SUM(CASE WHEN channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'responded' AND channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS responded,
              AVG(CASE WHEN status = 'responded' AND responded_at IS NOT NULL
                       THEN (strftime('%s', responded_at) - strftime('%s', created_at))
                       ELSE NULL END) AS avg_response_seconds,
              MAX(CASE WHEN status = 'responded' THEN responded_at ELSE NULL END) AS last_response_at
       FROM ticket_dispatches
       GROUP BY service_contact_id
     )
     SELECT sc.*,
            COALESCE(stats.sent, 0)        AS dispatches_total,
            COALESCE(stats.responded, 0)   AS dispatches_responded,
            stats.avg_response_seconds     AS avg_response_seconds,
            stats.last_response_at         AS last_response_at_dispatch
     FROM service_contacts sc
     LEFT JOIN stats ON stats.service_contact_id = sc.id
     WHERE sc.condominium_id = ?
       AND (? = 1 OR sc.active = 1)
     ORDER BY sc.preferred DESC, sc.emergency_available DESC, sc.category, sc.company_name`
  ).all(condoId, includeInactive ? 1 : 0) as any[];
  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = serviceContactSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = normalizeServiceContact(parsed.data);
  const result = db.prepare(
    `INSERT INTO service_contacts (
      condominium_id, category, company_name, contact_name, phone, whatsapp, email,
      website, address, service_scope, notes, contract_url, emergency_available,
      preferred, active, last_used_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    condoId,
    body.category,
    body.company_name,
    body.contact_name,
    body.phone,
    body.whatsapp,
    body.email,
    body.website,
    body.address,
    body.service_scope,
    body.notes,
    body.contract_url,
    body.emergency_available ? 1 : 0,
    body.preferred ? 1 : 0,
    body.active ? 1 : 0,
    body.last_used_at,
    req.user!.id,
  );
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'service_contact.create',
    target_type: 'service_contact',
    target_id: id,
    condominium_id: condoId,
    metadata: { category: body.category, preferred: body.preferred, emergency_available: body.emergency_available },
  });
  return ok(res, { id }, 201);
});

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = serviceContactSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const exists = db.prepare(
    `SELECT id FROM service_contacts WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId);
  if (!exists) return fail(res, 'not_found', 404);

  const body = normalizeServiceContact(parsed.data);
  db.prepare(
    `UPDATE service_contacts
     SET category = ?, company_name = ?, contact_name = ?, phone = ?, whatsapp = ?,
         email = ?, website = ?, address = ?, service_scope = ?, notes = ?,
         contract_url = ?, emergency_available = ?, preferred = ?, active = ?,
         last_used_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND condominium_id = ?`
  ).run(
    body.category,
    body.company_name,
    body.contact_name,
    body.phone,
    body.whatsapp,
    body.email,
    body.website,
    body.address,
    body.service_scope,
    body.notes,
    body.contract_url,
    body.emergency_available ? 1 : 0,
    body.preferred ? 1 : 0,
    body.active ? 1 : 0,
    body.last_used_at,
    id,
    condoId,
  );
  audit(req, {
    action: 'service_contact.update',
    target_type: 'service_contact',
    target_id: id,
    condominium_id: condoId,
    metadata: { category: body.category, active: body.active },
  });
  return ok(res, { id });
});

router.delete('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const exists = db.prepare(
    `SELECT id FROM service_contacts WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId);
  if (!exists) return fail(res, 'not_found', 404);
  db.prepare(
    `UPDATE service_contacts SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND condominium_id = ?`
  ).run(id, condoId);
  audit(req, {
    action: 'service_contact.deactivate',
    target_type: 'service_contact',
    target_id: id,
    condominium_id: condoId,
  });
  return ok(res, { id });
});

export default router;
