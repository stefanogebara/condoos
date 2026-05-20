import db from '../db';
import { defaultCurrencyForCondo } from './condo-settings';

interface FinanceError {
  ok: false;
  error: string;
  status: number;
  details?: Record<string, unknown>;
}

interface ScheduleRow {
  id: number;
  condominium_id: number;
  name: string;
  amount_cents: number;
  currency: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  due_day: number;
  active: number;
  created_at: string;
}

interface InvoiceRow {
  id: number;
  condominium_id?: number;
  unit_id?: number;
  amount_cents: number;
  currency?: string;
  status: string;
}

interface PaymentProofRow {
  id: number;
  condominium_id: number;
  invoice_id: number;
  resident_user_id: number;
  file_id: number;
  amount_cents: number;
  method: string;
  reference: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  payment_id: number | null;
  created_at: string;
  updated_at: string;
}

export const FINANCE_EXPENSE_CATEGORIES = [
  'maintenance', 'utilities', 'cleaning', 'security', 'staff',
  'admin', 'infrastructure', 'amenity', 'insurance', 'tax',
  'reserve', 'other',
] as const;

export type FinanceExpenseCategory = typeof FINANCE_EXPENSE_CATEGORIES[number];

export interface InvoiceGenerationInput {
  condoId: number;
  schedule_id?: number;
  amount_cents?: number;
  currency?: string;
  period: string;
  due_date?: string;
  unit_ids?: number[];
  notes?: string;
}

export interface InvoiceGenerationSuccess {
  ok: true;
  created_count: number;
  skipped_count: number;
  invoice_ids: number[];
  skipped_unit_ids: number[];
}

export interface PaymentInput {
  condoId: number;
  invoice_id: number;
  amount_cents: number;
  method: string;
  paid_at?: string;
  reference?: string;
  created_by_user_id: number;
}

export interface PaymentSuccess {
  ok: true;
  id: number;
  invoice_id: number;
  invoice_status: string;
  duplicate?: boolean;
  remaining_cents?: number;
}

export interface PaymentProofInput {
  condoId: number;
  invoice_id: number;
  resident_user_id: number;
  file_id: number;
  amount_cents: number;
  method: string;
  reference?: string;
  note?: string;
}

export interface PaymentProofSuccess {
  ok: true;
  id: number;
  invoice_id: number;
  status: 'pending' | 'approved' | 'rejected';
  payment_id?: number | null;
  remaining_cents?: number;
}

export interface BudgetTargetInput {
  category: FinanceExpenseCategory;
  amount_cents: number;
  notes?: string | null;
}

export interface BudgetTargetWriteInput {
  condoId: number;
  month: string;
  currency?: string;
  targets: BudgetTargetInput[];
}

export interface BudgetCategorySummary {
  category: FinanceExpenseCategory;
  budget_cents: number;
  actual_cents: number;
  variance_cents: number;
  expense_count: number;
  receipt_count: number;
  receipt_coverage_percent: number;
  currency: string;
  notes: string | null;
}

export interface BudgetSummary {
  month: string;
  currency: string;
  total_budget_cents: number;
  total_actual_cents: number;
  variance_cents: number;
  expense_count: number;
  receipt_count: number;
  receipt_coverage_percent: number;
  over_budget_category_count: number;
  categories: BudgetCategorySummary[];
}

export interface BudgetTargetWriteSuccess {
  ok: true;
  month: string;
  saved_count: number;
  deleted_count: number;
}

export interface ScheduledInvoiceGenerationResult {
  period: string;
  schedule_count: number;
  created_count: number;
  skipped_count: number;
  invoice_ids: number[];
  skipped_unit_ids: number[];
  errors: Array<{ schedule_id: number; error: string }>;
}

export function unitInCondo(unitId: number, condoId: number): boolean {
  return !!db.prepare(
    `SELECT 1
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE u.id = ? AND b.condominium_id = ?`
  ).get(unitId, condoId);
}

export function userCanSeeUnit(userId: number, role: string, unitId: number, condoId: number): boolean {
  if (role === 'board_admin') return true;
  return !!db.prepare(
    `SELECT 1
     FROM user_unit uu
     JOIN units u ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE uu.user_id = ? AND uu.unit_id = ? AND uu.status = 'active' AND b.condominium_id = ?`
  ).get(userId, unitId, condoId);
}

function assertMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('invalid_month');
}

function monthBounds(month: string) {
  assertMonth(month);
  const [year, monthNum] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0)).toISOString();
  return { start, end };
}

function coveragePercent(receiptCount: number, expenseCount: number) {
  if (expenseCount <= 0) return 0;
  return Math.round((receiptCount / expenseCount) * 100);
}

export function upsertBudgetTargets(input: BudgetTargetWriteInput): BudgetTargetWriteSuccess | FinanceError {
  try {
    assertMonth(input.month);
  } catch {
    return { ok: false, error: 'invalid_month', status: 400 };
  }
  const currency = (input.currency || defaultCurrencyForCondo(input.condoId)).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'invalid_currency', status: 400 };

  let saved = 0;
  let deleted = 0;
  const write = db.transaction((targets: BudgetTargetInput[]) => {
    for (const target of targets) {
      if (!FINANCE_EXPENSE_CATEGORIES.includes(target.category)) {
        throw new Error('invalid_budget_category');
      }
      const amount = Math.max(0, Math.round(Number(target.amount_cents || 0)));
      if (amount <= 0) {
        const result = db.prepare(
          `DELETE FROM budget_targets
           WHERE condominium_id = ? AND month = ? AND category = ?`
        ).run(input.condoId, input.month, target.category);
        deleted += Number(result.changes || 0);
        continue;
      }
      db.prepare(
        `INSERT INTO budget_targets (condominium_id, month, category, amount_cents, currency, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(condominium_id, month, category)
         DO UPDATE SET amount_cents = excluded.amount_cents,
                       currency = excluded.currency,
                       notes = excluded.notes,
                       updated_at = CURRENT_TIMESTAMP`
      ).run(
        input.condoId,
        input.month,
        target.category,
        amount,
        currency,
        target.notes?.trim() || null,
      );
      saved += 1;
    }
  });

  try {
    write(input.targets || []);
  } catch (err) {
    if ((err as Error).message === 'invalid_budget_category') {
      return { ok: false, error: 'invalid_budget_category', status: 400 };
    }
    throw err;
  }

  return { ok: true, month: input.month, saved_count: saved, deleted_count: deleted };
}

export function getBudgetSummary(condoId: number, month: string): BudgetSummary {
  const { start, end } = monthBounds(month);
  const actualRows = db.prepare(
    `SELECT category,
            SUM(amount_cents) AS actual_cents,
            COUNT(*) AS expense_count,
            SUM(CASE WHEN receipt_url IS NOT NULL OR receipt_file_id IS NOT NULL THEN 1 ELSE 0 END) AS receipt_count,
            COALESCE(MAX(currency), 'BRL') AS currency
     FROM expenses
     WHERE condominium_id = ?
       AND spent_at >= ?
       AND spent_at < ?
     GROUP BY category`
  ).all(condoId, start, end) as Array<{
    category: FinanceExpenseCategory;
    actual_cents: number;
    expense_count: number;
    receipt_count: number;
    currency: string;
  }>;
  const targetRows = db.prepare(
    `SELECT category, amount_cents, currency, notes
     FROM budget_targets
     WHERE condominium_id = ? AND month = ?`
  ).all(condoId, month) as Array<{
    category: FinanceExpenseCategory;
    amount_cents: number;
    currency: string;
    notes: string | null;
  }>;

  const actualByCategory = new Map(actualRows.map((row) => [row.category, row]));
  const targetByCategory = new Map(targetRows.map((row) => [row.category, row]));
  const fallbackCurrency = targetRows[0]?.currency || actualRows[0]?.currency || defaultCurrencyForCondo(condoId);

  const categories = FINANCE_EXPENSE_CATEGORIES.map((category) => {
    const actual = actualByCategory.get(category);
    const target = targetByCategory.get(category);
    const actualCents = Number(actual?.actual_cents || 0);
    const budgetCents = Number(target?.amount_cents || 0);
    const expenseCount = Number(actual?.expense_count || 0);
    const receiptCount = Number(actual?.receipt_count || 0);
    return {
      category,
      budget_cents: budgetCents,
      actual_cents: actualCents,
      variance_cents: budgetCents - actualCents,
      expense_count: expenseCount,
      receipt_count: receiptCount,
      receipt_coverage_percent: coveragePercent(receiptCount, expenseCount),
      currency: target?.currency || actual?.currency || fallbackCurrency,
      notes: target?.notes || null,
    };
  });

  const totalBudget = categories.reduce((sum, row) => sum + row.budget_cents, 0);
  const totalActual = categories.reduce((sum, row) => sum + row.actual_cents, 0);
  const expenseCount = categories.reduce((sum, row) => sum + row.expense_count, 0);
  const receiptCount = categories.reduce((sum, row) => sum + row.receipt_count, 0);

  return {
    month,
    currency: fallbackCurrency,
    total_budget_cents: totalBudget,
    total_actual_cents: totalActual,
    variance_cents: totalBudget - totalActual,
    expense_count: expenseCount,
    receipt_count: receiptCount,
    receipt_coverage_percent: coveragePercent(receiptCount, expenseCount),
    over_budget_category_count: categories.filter((row) => row.budget_cents > 0 && row.actual_cents > row.budget_cents).length,
    categories,
  };
}

function existingInvoice(unitId: number, period: string, scheduleId?: number): { id: number } | undefined {
  if (scheduleId) {
    return db.prepare(
      `SELECT id FROM invoices WHERE unit_id = ? AND period = ? AND schedule_id = ?`
    ).get(unitId, period, scheduleId) as { id: number } | undefined;
  }
  return db.prepare(
    `SELECT id FROM invoices WHERE unit_id = ? AND period = ? AND schedule_id IS NULL`
  ).get(unitId, period) as { id: number } | undefined;
}

export function generateInvoices(input: InvoiceGenerationInput): InvoiceGenerationSuccess | FinanceError {
  const schedule = input.schedule_id
    ? db.prepare(`SELECT * FROM dues_schedules WHERE id = ? AND condominium_id = ? AND active = 1`)
        .get(input.schedule_id, input.condoId) as ScheduleRow | undefined
    : null;
  if (input.schedule_id && !schedule) return { ok: false, error: 'schedule_not_found', status: 404 };

  const amount = input.amount_cents || schedule?.amount_cents;
  if (!amount) return { ok: false, error: 'missing_amount_cents', status: 400 };
  const currency = input.currency || schedule?.currency || defaultCurrencyForCondo(input.condoId);
  const dueDate = input.due_date || `${input.period}-10T12:00:00.000Z`;

  let units = db.prepare(
    `SELECT u.id
     FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ?
     ORDER BY b.name, u.number`
  ).all(input.condoId) as Array<{ id: number }>;
  if (input.unit_ids?.length) {
    const allowed = new Set(units.map((u) => u.id));
    if (input.unit_ids.some((id) => !allowed.has(id))) {
      return { ok: false, error: 'unit_not_in_condo', status: 400 };
    }
    units = input.unit_ids.map((id) => ({ id }));
  }

  const created: number[] = [];
  const skipped: number[] = [];
  const tx = db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO invoices (condominium_id, unit_id, schedule_id, amount_cents, currency, period, due_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const unit of units) {
      if (existingInvoice(unit.id, input.period, schedule?.id)) {
        skipped.push(unit.id);
        continue;
      }
      const result = insert.run(
        input.condoId,
        unit.id,
        schedule?.id || null,
        amount,
        currency,
        input.period,
        dueDate,
        input.notes || null,
      );
      created.push(Number(result.lastInsertRowid));
    }
  });
  tx();

  return {
    ok: true,
    created_count: created.length,
    skipped_count: skipped.length,
    invoice_ids: created,
    skipped_unit_ids: skipped,
  };
}

function periodForDate(asOf: Date): string {
  return asOf.toISOString().slice(0, 7);
}

function monthIndexFromPeriod(period: string): number {
  const [year, month] = period.split('-').map(Number);
  return year * 12 + (month - 1);
}

function monthIndexFromDate(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function shouldGenerateForPeriod(schedule: ScheduleRow, period: string): boolean {
  if (schedule.frequency === 'one_time') return false;
  if (schedule.frequency === 'monthly') return true;

  const current = monthIndexFromPeriod(period);
  const anchor = monthIndexFromDate(schedule.created_at) ?? current;
  const elapsed = current - anchor;
  if (elapsed < 0) return false;
  if (schedule.frequency === 'quarterly') return elapsed % 3 === 0;
  if (schedule.frequency === 'annual') return elapsed % 12 === 0;
  return false;
}

function dueDateForPeriod(period: string, dueDay: number): string {
  const day = String(Math.min(Math.max(Number(dueDay) || 10, 1), 28)).padStart(2, '0');
  return `${period}-${day}T12:00:00.000Z`;
}

export function generateScheduledInvoices(asOf = new Date()): ScheduledInvoiceGenerationResult {
  const period = periodForDate(asOf);
  const schedules = db.prepare(
    `SELECT *
     FROM dues_schedules
     WHERE active = 1 AND frequency != 'one_time'
     ORDER BY condominium_id ASC, id ASC`
  ).all() as ScheduleRow[];

  const summary: ScheduledInvoiceGenerationResult = {
    period,
    schedule_count: 0,
    created_count: 0,
    skipped_count: 0,
    invoice_ids: [],
    skipped_unit_ids: [],
    errors: [],
  };

  for (const schedule of schedules) {
    if (!shouldGenerateForPeriod(schedule, period)) continue;
    summary.schedule_count += 1;
    const result = generateInvoices({
      condoId: schedule.condominium_id,
      schedule_id: schedule.id,
      period,
      due_date: dueDateForPeriod(period, schedule.due_day),
      notes: `Auto-generated from schedule: ${schedule.name}`,
    });
    if (!result.ok) {
      summary.errors.push({ schedule_id: schedule.id, error: result.error });
      continue;
    }
    summary.created_count += result.created_count;
    summary.skipped_count += result.skipped_count;
    summary.invoice_ids.push(...result.invoice_ids);
    summary.skipped_unit_ids.push(...result.skipped_unit_ids);
  }

  return summary;
}

export function startScheduledInvoiceGenerator(intervalMs = 6 * 60 * 60_000): NodeJS.Timeout {
  const run = () => {
    try {
      const summary = generateScheduledInvoices();
      if (summary.created_count > 0 || summary.errors.length > 0) {
        console.log(
          `[finance] scheduled invoices period=${summary.period} schedules=${summary.schedule_count} created=${summary.created_count} skipped=${summary.skipped_count} errors=${summary.errors.length}`,
        );
      }
    } catch (err) {
      console.warn('[finance] scheduled invoice generation failed:', (err as Error)?.message || err);
    }
  };
  run();
  return setInterval(run, intervalMs);
}

function paidCents(invoiceId: number): number {
  const paid = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE invoice_id = ?`
  ).get(invoiceId) as { total: number };
  return Number(paid.total || 0);
}

function invoiceRemainingCents(invoice: InvoiceRow): number {
  return Math.max(0, Number(invoice.amount_cents || 0) - paidCents(invoice.id));
}

function readyPaymentProofFile(fileId: number, condoId: number, userId: number): { id: number } | undefined {
  return db.prepare(
    `SELECT id
     FROM files
     WHERE id = ?
       AND condominium_id = ?
       AND uploaded_by_user_id = ?
       AND purpose = 'payment_proof'
       AND visibility = 'board_only'
       AND status = 'ready'
       AND target_type IS NULL
       AND target_id IS NULL`
  ).get(fileId, condoId, userId) as { id: number } | undefined;
}

export function recordPayment(input: PaymentInput): PaymentSuccess | FinanceError {
  const invoice = db.prepare(
    `SELECT * FROM invoices WHERE id = ? AND condominium_id = ?`
  ).get(input.invoice_id, input.condoId) as InvoiceRow | undefined;
  if (!invoice) return { ok: false, error: 'invoice_not_found', status: 404 };
  if (invoice.status === 'void') return { ok: false, error: 'invoice_void', status: 409 };

  const reference = input.reference?.trim() || null;
  if (reference) {
    const duplicate = db.prepare(
      `SELECT id FROM payments WHERE invoice_id = ? AND reference = ? ORDER BY id ASC LIMIT 1`
    ).get(invoice.id, reference) as { id: number } | undefined;
    if (duplicate) {
      const remaining = Math.max(0, invoice.amount_cents - paidCents(invoice.id));
      return {
        ok: true,
        id: duplicate.id,
        invoice_id: invoice.id,
        invoice_status: remaining === 0 ? 'paid' : invoice.status,
        duplicate: true,
        remaining_cents: remaining,
      };
    }
  }

  const beforePaid = paidCents(invoice.id);
  const remaining = Math.max(0, invoice.amount_cents - beforePaid);
  if (remaining <= 0 || invoice.status === 'paid') {
    return { ok: false, error: 'invoice_already_paid', status: 409, details: { remaining_cents: remaining } };
  }
  if (input.amount_cents > remaining) {
    return { ok: false, error: 'payment_exceeds_balance', status: 409, details: { remaining_cents: remaining } };
  }

  const tx = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO payments (condominium_id, invoice_id, amount_cents, method, paid_at, reference, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.condoId,
      invoice.id,
      input.amount_cents,
      input.method,
      input.paid_at || new Date().toISOString(),
      reference,
      input.created_by_user_id,
    );

    const afterPaid = beforePaid + input.amount_cents;
    const status = afterPaid >= invoice.amount_cents ? 'paid' : invoice.status;
    db.prepare(`UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, invoice.id);

    return {
      id: Number(result.lastInsertRowid),
      invoice_status: status,
      remaining_cents: Math.max(0, invoice.amount_cents - afterPaid),
    };
  });

  const result = tx();
  return {
    ok: true,
    id: result.id,
    invoice_id: invoice.id,
    invoice_status: result.invoice_status,
    remaining_cents: result.remaining_cents,
  };
}

export function submitPaymentProof(input: PaymentProofInput): PaymentProofSuccess | FinanceError {
  const invoice = db.prepare(
    `SELECT * FROM invoices WHERE id = ? AND condominium_id = ?`
  ).get(input.invoice_id, input.condoId) as InvoiceRow | undefined;
  if (!invoice) return { ok: false, error: 'invoice_not_found', status: 404 };
  if (invoice.status === 'void') return { ok: false, error: 'invoice_void', status: 409 };
  if (!invoice.unit_id || !userCanSeeUnit(input.resident_user_id, 'resident', invoice.unit_id, input.condoId)) {
    return { ok: false, error: 'forbidden', status: 403 };
  }
  const fileAlreadyUsed = db.prepare(
    `SELECT id FROM payment_proofs WHERE file_id = ? LIMIT 1`
  ).get(input.file_id) as { id: number } | undefined;
  if (fileAlreadyUsed) return { ok: false, error: 'payment_proof_file_already_used', status: 409 };
  const file = readyPaymentProofFile(input.file_id, input.condoId, input.resident_user_id);
  if (!file) return { ok: false, error: 'invalid_payment_proof_file', status: 400 };

  const remaining = invoiceRemainingCents(invoice);
  if (remaining <= 0 || invoice.status === 'paid') {
    return { ok: false, error: 'invoice_already_paid', status: 409, details: { remaining_cents: remaining } };
  }
  if (input.amount_cents > remaining) {
    return { ok: false, error: 'payment_proof_exceeds_balance', status: 409, details: { remaining_cents: remaining } };
  }

  const result = db.prepare(
    `INSERT INTO payment_proofs (
      condominium_id, invoice_id, resident_user_id, file_id, amount_cents,
      method, reference, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.condoId,
    invoice.id,
    input.resident_user_id,
    file.id,
    input.amount_cents,
    input.method || 'transfer',
    input.reference?.trim() || null,
    input.note?.trim() || null,
  );
  const id = Number(result.lastInsertRowid);
  db.prepare(`UPDATE files SET target_type = 'payment_proof', target_id = ? WHERE id = ?`).run(id, file.id);
  return { ok: true, id, invoice_id: invoice.id, status: 'pending', remaining_cents: remaining };
}

export function approvePaymentProof(input: {
  condoId: number;
  proof_id: number;
  reviewer_user_id: number;
}): PaymentProofSuccess | FinanceError {
  const proof = db.prepare(
    `SELECT * FROM payment_proofs WHERE id = ? AND condominium_id = ?`
  ).get(input.proof_id, input.condoId) as PaymentProofRow | undefined;
  if (!proof) return { ok: false, error: 'payment_proof_not_found', status: 404 };
  if (proof.status !== 'pending') return { ok: false, error: 'payment_proof_already_reviewed', status: 409 };
  if (proof.resident_user_id === input.reviewer_user_id) {
    return { ok: false, error: 'cannot_approve_own_payment_proof', status: 403 };
  }

  const payment = recordPayment({
    condoId: input.condoId,
    invoice_id: proof.invoice_id,
    amount_cents: proof.amount_cents,
    method: proof.method || 'proof',
    reference: proof.reference || `proof-${proof.id}`,
    created_by_user_id: input.reviewer_user_id,
  });
  if (!payment.ok) return payment;

  db.prepare(
    `UPDATE payment_proofs
     SET status = 'approved',
         reviewed_by_user_id = ?,
         reviewed_at = ?,
         payment_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(input.reviewer_user_id, new Date().toISOString(), payment.id, proof.id);

  return {
    ok: true,
    id: proof.id,
    invoice_id: proof.invoice_id,
    status: 'approved',
    payment_id: payment.id,
    remaining_cents: payment.remaining_cents,
  };
}

export function rejectPaymentProof(input: {
  condoId: number;
  proof_id: number;
  reviewer_user_id: number;
  reason?: string;
}): PaymentProofSuccess | FinanceError {
  const proof = db.prepare(
    `SELECT * FROM payment_proofs WHERE id = ? AND condominium_id = ?`
  ).get(input.proof_id, input.condoId) as PaymentProofRow | undefined;
  if (!proof) return { ok: false, error: 'payment_proof_not_found', status: 404 };
  if (proof.status !== 'pending') return { ok: false, error: 'payment_proof_already_reviewed', status: 409 };
  if (proof.resident_user_id === input.reviewer_user_id) {
    return { ok: false, error: 'cannot_reject_own_payment_proof', status: 403 };
  }

  db.prepare(
    `UPDATE payment_proofs
     SET status = 'rejected',
         reviewed_by_user_id = ?,
         reviewed_at = ?,
         rejection_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(input.reviewer_user_id, new Date().toISOString(), input.reason?.trim() || null, proof.id);

  return { ok: true, id: proof.id, invoice_id: proof.invoice_id, status: 'rejected', payment_id: null };
}
