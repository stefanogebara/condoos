import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { generateInvoices, recordPayment, unitInCondo, userCanSeeUnit } from '../lib/finance';

const router = Router();

const scheduleSchema = z.object({
  name: z.string().min(1).max(120),
  amount_cents: z.number().int().positive(),
  currency: z.string().min(3).max(3).default('BRL'),
  frequency: z.enum(['monthly', 'quarterly', 'annual', 'one_time']).default('monthly'),
  due_day: z.number().int().min(1).max(28).default(10),
});

const invoiceSchema = z.object({
  schedule_id: z.number().int().positive().optional(),
  amount_cents: z.number().int().positive().optional(),
  currency: z.string().min(3).max(3).optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  due_date: z.string().datetime().optional(),
  unit_ids: z.array(z.number().int().positive()).optional(),
  notes: z.string().max(500).optional(),
});

const paymentSchema = z.object({
  invoice_id: z.number().int().positive(),
  amount_cents: z.number().int().positive(),
  method: z.string().min(1).max(40).default('manual'),
  paid_at: z.string().datetime().optional(),
  reference: z.string().max(120).optional(),
});

router.get('/schedules', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT * FROM dues_schedules WHERE condominium_id = ? ORDER BY active DESC, created_at DESC`
  ).all(condoId);
  return ok(res, rows);
});

router.post('/schedules', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;
  const result = db.prepare(
    `INSERT INTO dues_schedules (condominium_id, name, amount_cents, currency, frequency, due_day)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(condoId, body.name, body.amount_cents, body.currency, body.frequency, body.due_day);
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'finance.schedule_create',
    target_type: 'dues_schedule',
    target_id: id,
    condominium_id: condoId,
    metadata: { amount_cents: body.amount_cents, frequency: body.frequency },
  });
  return ok(res, { id }, 201);
});

router.post('/invoices', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const result = generateInvoices({ condoId, ...parsed.data });
  if (!result.ok) return fail(res, result.error, result.status, result.details);

  audit(req, {
    action: 'finance.invoices_generate',
    target_type: 'invoice',
    condominium_id: condoId,
    metadata: { period: parsed.data.period, created_count: result.created_count, skipped_count: result.skipped_count },
  });
  return ok(res, {
    created_count: result.created_count,
    skipped_count: result.skipped_count,
    invoice_ids: result.invoice_ids,
    skipped_unit_ids: result.skipped_unit_ids,
  }, 201);
});

router.get('/statements/:unit_id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const unitId = Number(req.params.unit_id);
  if (!Number.isInteger(unitId) || unitId <= 0) return fail(res, 'invalid_unit_id', 400);
  if (!unitInCondo(unitId, condoId)) return fail(res, 'not_found', 404);
  if (!userCanSeeUnit(req.user!.id, req.user!.role, unitId, condoId)) return fail(res, 'forbidden', 403);

  const unit = db.prepare(
    `SELECT u.*, b.name AS building_name FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = ?`
  ).get(unitId);
  const invoices = db.prepare(
    `SELECT i.*,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
     FROM invoices i
     WHERE i.unit_id = ? AND i.condominium_id = ?
     ORDER BY i.due_date DESC, i.id DESC`
  ).all(unitId, condoId) as any[];
  const payments = db.prepare(
    `SELECT p.*
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE i.unit_id = ? AND i.condominium_id = ?
     ORDER BY p.paid_at DESC`
  ).all(unitId, condoId);
  const balance_cents = invoices.reduce((sum, invoice) => {
    if (invoice.status === 'void') return sum;
    return sum + Math.max(0, invoice.amount_cents - Number(invoice.paid_cents || 0));
  }, 0);
  return ok(res, { unit, invoices, payments, balance_cents });
});

router.post('/payments', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const result = recordPayment({
    condoId,
    ...parsed.data,
    created_by_user_id: req.user!.id,
  });
  if (!result.ok) return fail(res, result.error, result.status, result.details);

  audit(req, {
    action: 'finance.payment_create',
    target_type: 'payment',
    target_id: result.id,
    condominium_id: condoId,
    metadata: { invoice_id: result.invoice_id, amount_cents: parsed.data.amount_cents, duplicate: !!result.duplicate },
  });
  return ok(res, {
    id: result.id,
    invoice_id: result.invoice_id,
    invoice_status: result.invoice_status,
    duplicate: !!result.duplicate,
    remaining_cents: result.remaining_cents,
  }, result.duplicate ? 200 : 201);
});

export default router;
