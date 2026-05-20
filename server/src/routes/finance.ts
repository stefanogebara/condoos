import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, requireActiveMembership, requireBoardCapability, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import {
  approvePaymentProof,
  FINANCE_EXPENSE_CATEGORIES,
  getBudgetSummary,
  generateInvoices,
  recordPayment,
  rejectPaymentProof,
  submitPaymentProof,
  upsertBudgetTargets,
  unitInCondo,
  userCanSeeUnit,
} from '../lib/finance';
import { assertFileReadyForUse, attachFileToTarget, fileDownloadPath } from '../lib/files';
import { defaultCurrencyForCondo } from '../lib/condo-settings';

const router = Router();

const scheduleSchema = z.object({
  name: z.string().min(1).max(120),
  amount_cents: z.number().int().positive(),
  currency: z.string().min(3).max(3).optional(),
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

const paymentProofSchema = z.object({
  invoice_id: z.number().int().positive(),
  amount_cents: z.number().int().positive(),
  method: z.string().min(1).max(40).default('transfer'),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  file_id: z.number().int().positive(),
});

const paymentProofRejectSchema = z.object({
  reason: z.string().max(500).optional(),
});

const budgetMonthSchema = z.string().regex(/^\d{4}-\d{2}$/);

const budgetTargetsBulkSchema = z.object({
  month: budgetMonthSchema,
  currency: z.string().min(3).max(3).optional(),
  targets: z.array(z.object({
    category: z.enum(FINANCE_EXPENSE_CATEGORIES),
    amount_cents: z.number().int().min(0),
    notes: z.string().max(500).optional().nullable(),
  })).max(FINANCE_EXPENSE_CATEGORIES.length),
});

const expenseSchema = z.object({
  amount_cents: z.number().int().positive(),
  currency: z.string().min(3).max(3).optional(),
  category: z.enum(FINANCE_EXPENSE_CATEGORIES),
  vendor: z.string().min(0).max(120).optional().nullable(),
  description: z.string().min(1).max(500),
  admin_explanation: z.string().max(800).optional().nullable(),
  spent_at: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  // Audit M1 — restrict to https:// to block file:/javascript:/internal-IP
  // URLs that previously matched z.string().url() and were stored verbatim.
  receipt_url: z.string().url().max(2048).refine(
    (u) => u.startsWith('https://'),
    { message: 'must_be_https_url' },
  ).optional().nullable(),
  receipt_file_id: z.number().int().positive().optional().nullable(),
  related_proposal_id: z.number().int().positive().optional().nullable(),
});

router.get('/schedules', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT * FROM dues_schedules WHERE condominium_id = ? ORDER BY active DESC, created_at DESC`
  ).all(condoId);
  return ok(res, rows);
});

router.post('/schedules', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;
  const currency = (body.currency || defaultCurrencyForCondo(condoId)).toUpperCase();
  const result = db.prepare(
    `INSERT INTO dues_schedules (condominium_id, name, amount_cents, currency, frequency, due_day)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(condoId, body.name, body.amount_cents, currency, body.frequency, body.due_day);
  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'finance.schedule_create',
    target_type: 'dues_schedule',
    target_id: id,
    condominium_id: condoId,
    metadata: { amount_cents: body.amount_cents, currency, frequency: body.frequency },
  });
  return ok(res, { id }, 201);
});

router.get('/receivables', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const today = new Date().toISOString();

  const unitRows = db.prepare(
    `SELECT u.id AS unit_id,
            u.number AS unit_number,
            b.name AS building_name,
            GROUP_CONCAT(DISTINCT TRIM(users.first_name || ' ' || users.last_name)) AS resident_names
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     LEFT JOIN user_unit uu ON uu.unit_id = u.id AND uu.status = 'active'
     LEFT JOIN users ON users.id = uu.user_id
     WHERE b.condominium_id = ?
     GROUP BY u.id
     ORDER BY b.name, CASE WHEN u.floor IS NULL THEN 9999 ELSE u.floor END, u.number`
  ).all(condoId) as Array<{
    unit_id: number;
    unit_number: string;
    building_name: string;
    resident_names: string | null;
  }>;

  const invoiceRows = db.prepare(
    `SELECT i.*,
            u.number AS unit_number,
            b.name AS building_name,
            ds.name AS schedule_name,
            COALESCE(SUM(p.amount_cents), 0) AS paid_cents,
            GROUP_CONCAT(DISTINCT TRIM(users.first_name || ' ' || users.last_name)) AS resident_names
     FROM invoices i
     JOIN units u ON u.id = i.unit_id
     JOIN buildings b ON b.id = u.building_id
     LEFT JOIN dues_schedules ds ON ds.id = i.schedule_id
     LEFT JOIN payments p ON p.invoice_id = i.id
     LEFT JOIN user_unit uu ON uu.unit_id = u.id AND uu.status = 'active'
     LEFT JOIN users ON users.id = uu.user_id
     WHERE i.condominium_id = ?
     GROUP BY i.id
     ORDER BY i.due_date ASC, b.name, u.number`
  ).all(condoId) as Array<any>;

  const units = unitRows.map((row) => ({
    ...row,
    resident_names: row.resident_names || '',
    open_cents: 0,
    overdue_cents: 0,
    open_invoice_count: 0,
    overdue_invoice_count: 0,
    oldest_due_date: null as string | null,
  }));
  const byUnit = new Map(units.map((u) => [u.unit_id, u]));

  const invoices = invoiceRows.map((invoice) => {
    const paid = Number(invoice.paid_cents || 0);
    const remaining = Math.max(0, Number(invoice.amount_cents || 0) - paid);
    const isOpen = invoice.status !== 'void' && remaining > 0;
    const isOverdue = isOpen && new Date(invoice.due_date).getTime() < new Date(today).getTime();
    const unit = byUnit.get(invoice.unit_id);
    if (unit && isOpen) {
      unit.open_cents += remaining;
      unit.open_invoice_count += 1;
      if (!unit.oldest_due_date || invoice.due_date < unit.oldest_due_date) unit.oldest_due_date = invoice.due_date;
      if (isOverdue) {
        unit.overdue_cents += remaining;
        unit.overdue_invoice_count += 1;
      }
    }
    return {
      id: invoice.id,
      unit_id: invoice.unit_id,
      unit_number: invoice.unit_number,
      building_name: invoice.building_name,
      resident_names: invoice.resident_names || '',
      schedule_id: invoice.schedule_id,
      schedule_name: invoice.schedule_name,
      amount_cents: Number(invoice.amount_cents || 0),
      paid_cents: paid,
      remaining_cents: remaining,
      currency: invoice.currency,
      period: invoice.period,
      due_date: invoice.due_date,
      status: isOverdue ? 'overdue' : invoice.status,
      raw_status: invoice.status,
      notes: invoice.notes,
      created_at: invoice.created_at,
    };
  });

  const openInvoices = invoices.filter((invoice) => invoice.raw_status !== 'void' && invoice.remaining_cents > 0);
  const overdueInvoices = openInvoices.filter((invoice) => invoice.status === 'overdue');

  return ok(res, {
    total_open_cents: openInvoices.reduce((sum, invoice) => sum + invoice.remaining_cents, 0),
    overdue_cents: overdueInvoices.reduce((sum, invoice) => sum + invoice.remaining_cents, 0),
    open_invoice_count: openInvoices.length,
    overdue_invoice_count: overdueInvoices.length,
    unit_count: units.length,
    units,
    invoices,
  });
});

router.post('/invoices', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const result = generateInvoices({
    condoId,
    ...parsed.data,
    currency: parsed.data.currency || defaultCurrencyForCondo(condoId),
  });
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
  const payment_proofs = db.prepare(
    `SELECT pp.*,
            f.original_filename AS file_name,
            f.content_type AS file_content_type,
            f.size_bytes AS file_size_bytes
     FROM payment_proofs pp
     JOIN invoices i ON i.id = pp.invoice_id
     LEFT JOIN files f ON f.id = pp.file_id
     WHERE i.unit_id = ? AND pp.condominium_id = ?
       AND (? = 'board_admin' OR pp.resident_user_id = ?)
     ORDER BY pp.created_at DESC, pp.id DESC`
  ).all(unitId, condoId, req.user!.role, req.user!.id);
  const balance_cents = invoices.reduce((sum, invoice) => {
    if (invoice.status === 'void') return sum;
    return sum + Math.max(0, invoice.amount_cents - Number(invoice.paid_cents || 0));
  }, 0);
  return ok(res, { unit, invoices, payments, payment_proofs, balance_cents });
});

router.post('/payments', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
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

router.get('/payment-proofs', requireAuth, requireActiveMembership, requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const status = String(req.query.status || '').trim();
  const statusClause = ['pending', 'approved', 'rejected'].includes(status) ? `AND pp.status = ?` : '';
  const params: any[] = [condoId];
  if (statusClause) params.push(status);
  if (req.user!.role !== 'board_admin') params.push(req.user!.id);

  const rows = db.prepare(
    `SELECT pp.*,
            i.amount_cents AS invoice_amount_cents,
            i.currency,
            i.period,
            i.due_date,
            u.number AS unit_number,
            b.name AS building_name,
            TRIM(submitter.first_name || ' ' || submitter.last_name) AS resident_name,
            TRIM(reviewer.first_name || ' ' || reviewer.last_name) AS reviewer_name,
            f.original_filename AS file_name,
            f.content_type AS file_content_type,
            f.size_bytes AS file_size_bytes
     FROM payment_proofs pp
     JOIN invoices i ON i.id = pp.invoice_id
     JOIN units u ON u.id = i.unit_id
     JOIN buildings b ON b.id = u.building_id
     JOIN users submitter ON submitter.id = pp.resident_user_id
     LEFT JOIN users reviewer ON reviewer.id = pp.reviewed_by_user_id
     LEFT JOIN files f ON f.id = pp.file_id
     WHERE pp.condominium_id = ?
       ${statusClause}
       ${req.user!.role === 'board_admin' ? '' : 'AND pp.resident_user_id = ?'}
     ORDER BY CASE pp.status WHEN 'pending' THEN 0 ELSE 1 END, pp.created_at DESC, pp.id DESC`
  ).all(...params);

  return ok(res, rows);
});

router.post('/payment-proofs', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const parsed = paymentProofSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const result = submitPaymentProof({
    condoId,
    ...parsed.data,
    resident_user_id: req.user!.id,
  });
  if (!result.ok) return fail(res, result.error, result.status, result.details);
  audit(req, {
    action: 'finance.payment_proof_submit',
    target_type: 'payment_proof',
    target_id: result.id,
    condominium_id: condoId,
    metadata: { invoice_id: result.invoice_id, amount_cents: parsed.data.amount_cents },
  });
  return ok(res, result, 201);
});

router.post('/payment-proofs/:id/approve', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_payment_proof_id', 400);
  const result = approvePaymentProof({ condoId, proof_id: id, reviewer_user_id: req.user!.id });
  if (!result.ok) return fail(res, result.error, result.status, result.details);
  audit(req, {
    action: 'finance.payment_proof_approve',
    target_type: 'payment_proof',
    target_id: id,
    condominium_id: condoId,
    metadata: { invoice_id: result.invoice_id, payment_id: result.payment_id },
  });
  return ok(res, result);
});

router.post('/payment-proofs/:id/reject', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const parsed = paymentProofRejectSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_payment_proof_id', 400);
  const result = rejectPaymentProof({
    condoId,
    proof_id: id,
    reviewer_user_id: req.user!.id,
    reason: parsed.data.reason,
  });
  if (!result.ok) return fail(res, result.error, result.status, result.details);
  audit(req, {
    action: 'finance.payment_proof_reject',
    target_type: 'payment_proof',
    target_id: id,
    condominium_id: condoId,
    metadata: { invoice_id: result.invoice_id },
  });
  return ok(res, result);
});

router.get('/budget-summary', requireAuth, requireActiveMembership, requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const month = String(req.query.month || '').trim() || new Date().toISOString().slice(0, 7);
  const parsed = budgetMonthSchema.safeParse(month);
  if (!parsed.success) return fail(res, 'invalid_month', 400);
  const condoId = getActiveCondoId(req);
  return ok(res, getBudgetSummary(condoId, parsed.data));
});

router.post('/budget-targets/bulk', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const parsed = budgetTargetsBulkSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const result = upsertBudgetTargets({
    condoId,
    ...parsed.data,
    currency: parsed.data.currency || defaultCurrencyForCondo(condoId),
  });
  if (!result.ok) return fail(res, result.error, result.status, result.details);
  audit(req, {
    action: 'finance.budget_targets_update',
    target_type: 'budget_targets',
    condominium_id: condoId,
    metadata: { month: result.month, saved_count: result.saved_count, deleted_count: result.deleted_count },
  });
  return ok(res, result);
});

// ---------------------------------------------------------------------------
// Expenses (#12 — budget transparency).
// GET is open to all members (residents see where the money goes).
// POST/DELETE require board_admin.
// ---------------------------------------------------------------------------
router.get('/expenses', requireAuth, requireActiveMembership, requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  // Optional filters: ?since=2026-01-01 (limits history, default = 12 months).
  const sinceParam = String(req.query.since || '').trim();
  const since = sinceParam || (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    return d.toISOString().slice(0, 10);
  })();

  const rows = db.prepare(
    `SELECT e.*, p.title AS related_proposal_title,
            f.original_filename AS receipt_file_name,
            f.content_type AS receipt_content_type,
            f.size_bytes AS receipt_size_bytes
     FROM expenses e
     LEFT JOIN proposals p ON p.id = e.related_proposal_id
     LEFT JOIN files f ON f.id = e.receipt_file_id
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
    currency: defaultCurrencyForCondo(condoId),
  });
});

router.post('/expenses', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;
  const currency = (body.currency || defaultCurrencyForCondo(condoId)).toUpperCase();

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

  const receiptFile = body.receipt_file_id
    ? assertFileReadyForUse({ fileId: body.receipt_file_id, condoId, purpose: 'receipt' })
    : null;
  if (body.receipt_file_id && !receiptFile) return fail(res, 'invalid_receipt_file', 400);
  if (receiptFile && receiptFile.visibility !== 'residents') return fail(res, 'file_visibility_mismatch', 400);
  const receiptUrl = receiptFile ? fileDownloadPath(receiptFile.id) : body.receipt_url || null;

  // Audit H-N2 — POST was non-idempotent. A double-click or a network retry
  // booked duplicate expenses (this happened during the audit itself: two
  // identical "audit dup test" rows). Dedupe within a 60s window on the
  // tuple (condo, amount, description, spent_at, created_by) and return the
  // existing row's id. Retries still get a 200, callers don't need to add
  // an Idempotency-Key header. Use SQLite's datetime() so the comparison
  // works regardless of how created_at is formatted (CURRENT_TIMESTAMP
  // stores "YYYY-MM-DD HH:MM:SS" UTC; mixing that with an ISO string from
  // JS would make the lexicographic compare unreliable because ' ' < 'T').
  const recent = db.prepare(
    `SELECT id, spent_at FROM expenses
     WHERE condominium_id = ?
       AND amount_cents = ?
       AND description = ?
       AND spent_at = ?
       AND created_by_user_id = ?
       AND datetime(created_at) >= datetime('now', '-60 seconds')
     LIMIT 1`
  ).get(condoId, body.amount_cents, body.description, spentAt, req.user!.id) as { id: number; spent_at: string } | undefined;
  if (recent) {
    return ok(res, { id: recent.id, spent_at: recent.spent_at, deduped: true }, 200);
  }

  const result = db.prepare(
    `INSERT INTO expenses (
      condominium_id, amount_cents, currency, category, vendor,
      description, admin_explanation, spent_at, receipt_url, receipt_file_id, related_proposal_id, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    condoId, body.amount_cents, currency, body.category, body.vendor || null,
    body.description, body.admin_explanation?.trim() || null, spentAt, receiptUrl, receiptFile?.id || null, body.related_proposal_id || null,
    req.user!.id,
  );
  const id = Number(result.lastInsertRowid);
  if (receiptFile) attachFileToTarget(receiptFile.id, 'expense', id);
  audit(req, {
    action: 'finance.expense_create',
    target_type: 'expense',
    target_id: id,
    condominium_id: condoId,
    metadata: { amount_cents: body.amount_cents, currency, category: body.category, has_receipt: !!receiptUrl },
  });
  return ok(res, { id, spent_at: spentAt }, 201);
});

router.delete('/expenses/:id', requireAuth, requireRole('board_admin'), requireBoardCapability('finance'), (req: AuthedRequest, res) => {
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
