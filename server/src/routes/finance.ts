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

// Expense categories — broad enough to bucket anything a Brazilian condo
// actually spends on. Stored as the canonical English code; UI translates.
const EXPENSE_CATEGORIES = [
  'maintenance', 'utilities', 'cleaning', 'security', 'staff',
  'admin', 'infrastructure', 'amenity', 'insurance', 'tax',
  'reserve', 'other',
] as const;
const expenseSchema = z.object({
  amount_cents: z.number().int().positive(),
  currency: z.string().min(3).max(3).optional().default('BRL'),
  category: z.enum(EXPENSE_CATEGORIES),
  vendor: z.string().min(0).max(120).optional().nullable(),
  description: z.string().min(1).max(500),
  spent_at: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  receipt_url: z.string().url().max(2048).optional().nullable(),
  related_proposal_id: z.number().int().positive().optional().nullable(),
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

// ---------------------------------------------------------------------------
// Expenses (#12 — budget transparency).
// GET is open to all members (residents see where the money goes).
// POST/DELETE require board_admin.
// ---------------------------------------------------------------------------
router.get('/expenses', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  // Optional filters: ?since=2026-01-01 (limits history, default = 12 months).
  const sinceParam = String(req.query.since || '').trim();
  const since = sinceParam || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 10);
  })();

  const rows = db.prepare(
    `SELECT e.*, p.title AS related_proposal_title
     FROM expenses e
     LEFT JOIN proposals p ON p.id = e.related_proposal_id
     WHERE e.condominium_id = ?
       AND e.spent_at >= ?
     ORDER BY e.spent_at DESC, e.id DESC`
  ).all(condoId, since) as any[];

  // Aggregate totals so the resident view can render a category breakdown
  // without re-summing on the client every render.
  const totalsByCategory = db.prepare(
    `SELECT category, SUM(amount_cents) AS total_cents, COUNT(*) AS count
     FROM expenses
     WHERE condominium_id = ? AND spent_at >= ?
     GROUP BY category
     ORDER BY total_cents DESC`
  ).all(condoId, since);

  const totalCents = (rows as Array<{ amount_cents: number }>)
    .reduce((sum, r) => sum + (r.amount_cents || 0), 0);

  return ok(res, {
    since,
    expenses: rows,
    totals_by_category: totalsByCategory,
    total_cents: totalCents,
    currency: 'BRL',
  });
});

router.post('/expenses', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;

  // Normalize spent_at — accept both ISO datetime and YYYY-MM-DD.
  const spentAt = /^\d{4}-\d{2}-\d{2}$/.test(body.spent_at)
    ? `${body.spent_at}T00:00:00.000Z`
    : new Date(body.spent_at).toISOString();

  // If related_proposal_id is provided, check it belongs to the condo.
  if (body.related_proposal_id) {
    const ok = db.prepare(
      `SELECT 1 FROM proposals WHERE id = ? AND condominium_id = ?`
    ).get(body.related_proposal_id, condoId);
    if (!ok) return fail(res, 'related_proposal_not_in_condo', 400);
  }

  const result = db.prepare(
    `INSERT INTO expenses (
      condominium_id, amount_cents, currency, category, vendor,
      description, spent_at, receipt_url, related_proposal_id, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    condoId, body.amount_cents, body.currency, body.category, body.vendor || null,
    body.description, spentAt, body.receipt_url || null, body.related_proposal_id || null,
    req.user!.id,
  );
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'finance.expense_create',
    target_type: 'expense',
    target_id: id,
    condominium_id: condoId,
    metadata: { amount_cents: body.amount_cents, category: body.category, has_receipt: !!body.receipt_url },
  });
  return ok(res, { id, spent_at: spentAt }, 201);
});

router.delete('/expenses/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const exists = db.prepare(
    `SELECT id FROM expenses WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId);
  if (!exists) return fail(res, 'not_found', 404);

  db.prepare(`DELETE FROM expenses WHERE id = ?`).run(id);
  audit(req, {
    action: 'finance.expense_delete',
    target_type: 'expense',
    target_id: id,
    condominium_id: condoId,
  });
  return ok(res, { id });
});

export default router;
