import db from '../db';

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
  amount_cents: number;
  status: string;
}

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
  const currency = input.currency || schedule?.currency || 'BRL';
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
