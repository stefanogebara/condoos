import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

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

function unitInCondo(unitId: number, condoId: number): boolean {
  return !!db.prepare(
    `SELECT 1
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE u.id = ? AND b.condominium_id = ?`
  ).get(unitId, condoId);
}

function userCanSeeUnit(req: AuthedRequest, unitId: number, condoId: number): boolean {
  if (req.user!.role === 'board_admin') return true;
  return !!db.prepare(
    `SELECT 1
     FROM user_unit uu
     JOIN units u ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE uu.user_id = ? AND uu.unit_id = ? AND uu.status = 'active' AND b.condominium_id = ?`
  ).get(req.user!.id, unitId, condoId);
}

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
  const body = parsed.data;

  const schedule = body.schedule_id
    ? db.prepare(`SELECT * FROM dues_schedules WHERE id = ? AND condominium_id = ? AND active = 1`)
        .get(body.schedule_id, condoId) as any
    : null;
  if (body.schedule_id && !schedule) return fail(res, 'schedule_not_found', 404);

  const amount = body.amount_cents || schedule?.amount_cents;
  if (!amount) return fail(res, 'missing_amount_cents', 400);
  const currency = body.currency || schedule?.currency || 'BRL';
  const dueDate = body.due_date || `${body.period}-10T12:00:00.000Z`;

  let units = db.prepare(
    `SELECT u.id
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ?
     ORDER BY b.name, u.number`
  ).all(condoId) as Array<{ id: number }>;
  if (body.unit_ids?.length) {
    const allowed = new Set(units.map((u) => u.id));
    if (body.unit_ids.some((id) => !allowed.has(id))) return fail(res, 'unit_not_in_condo', 400);
    units = body.unit_ids.map((id) => ({ id }));
  }

  const created: number[] = [];
  const skipped: number[] = [];
  const tx = db.transaction(() => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO invoices (condominium_id, unit_id, schedule_id, amount_cents, currency, period, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const unit of units) {
      const result = insert.run(
        condoId,
        unit.id,
        schedule?.id || null,
        amount,
        currency,
        body.period,
        dueDate,
        body.notes || null,
      );
      if (result.changes > 0) created.push(Number(result.lastInsertRowid));
      else skipped.push(unit.id);
    }
  });
  tx();

  audit(req, {
    action: 'finance.invoices_generate',
    target_type: 'invoice',
    condominium_id: condoId,
    metadata: { period: body.period, created_count: created.length, skipped_count: skipped.length },
  });
  return ok(res, { created_count: created.length, skipped_count: skipped.length, invoice_ids: created, skipped_unit_ids: skipped }, 201);
});

router.get('/statements/:unit_id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const unitId = Number(req.params.unit_id);
  if (!Number.isInteger(unitId) || unitId <= 0) return fail(res, 'invalid_unit_id', 400);
  if (!unitInCondo(unitId, condoId)) return fail(res, 'not_found', 404);
  if (!userCanSeeUnit(req, unitId, condoId)) return fail(res, 'forbidden', 403);

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
  const body = parsed.data;
  const invoice = db.prepare(
    `SELECT * FROM invoices WHERE id = ? AND condominium_id = ?`
  ).get(body.invoice_id, condoId) as any;
  if (!invoice) return fail(res, 'invoice_not_found', 404);
  if (invoice.status === 'void') return fail(res, 'invoice_void', 409);

  const result = db.prepare(
    `INSERT INTO payments (condominium_id, invoice_id, amount_cents, method, paid_at, reference, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    condoId,
    invoice.id,
    body.amount_cents,
    body.method,
    body.paid_at || new Date().toISOString(),
    body.reference || null,
    req.user!.id,
  );
  const paid = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE invoice_id = ?`
  ).get(invoice.id) as { total: number };
  if (paid.total >= invoice.amount_cents) {
    db.prepare(`UPDATE invoices SET status='paid', updated_at=CURRENT_TIMESTAMP WHERE id = ?`).run(invoice.id);
  }
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'finance.payment_create',
    target_type: 'payment',
    target_id: id,
    condominium_id: condoId,
    metadata: { invoice_id: invoice.id, amount_cents: body.amount_cents },
  });
  return ok(res, { id, invoice_id: invoice.id, invoice_status: paid.total >= invoice.amount_cents ? 'paid' : invoice.status }, 201);
});

export default router;
