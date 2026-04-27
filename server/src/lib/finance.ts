import db from '../db';

interface FinanceError {
  ok: false;
  error: string;
  status: number;
  details?: Record<string, unknown>;
}

interface ScheduleRow {
  id: number;
  amount_cents: number;
  currency: string;
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
