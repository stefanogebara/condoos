// Budget transparency (#12): admin logs expenses via /api/finance/expenses,
// residents read them. Same endpoint serves both — RBAC limits POST/DELETE.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'admin@condoos.dev', password: 'admin123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.token;
}

async function residentToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'resident@condoos.dev', password: 'resident123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.token;
}

test('Finance API: admin can create + list + delete expenses', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const created = await request.post(`${apiURL}/finance/expenses`, {
    headers,
    data: {
      amount_cents: 1_500_00,
      category: 'maintenance',
      vendor: 'E2E Manutenção SA',
      description: `E2E Despesa ${Date.now()}`,
      spent_at: new Date().toISOString().slice(0, 10),
    },
  });
  expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const id = (await created.json()).data.id as number;

  const list = await request.get(`${apiURL}/finance/expenses`, { headers });
  expect(list.ok()).toBeTruthy();
  const body = (await list.json()).data as {
    expenses: Array<{ id: number; description: string }>;
    totals_by_category: Array<{ category: string; total_cents: number }>;
    total_cents: number;
  };
  expect(body.expenses.find((e) => e.id === id)).toBeTruthy();
  expect(body.total_cents).toBeGreaterThanOrEqual(1_500_00);
  expect(body.totals_by_category.length).toBeGreaterThanOrEqual(1);

  // Cleanup
  const del = await request.delete(`${apiURL}/finance/expenses/${id}`, { headers });
  expect(del.ok()).toBeTruthy();
});

test('Finance API: resident can list expenses (read-only) but cannot create', async ({ request }) => {
  const adminH = { Authorization: `Bearer ${await adminToken(request)}`, 'Content-Type': 'application/json' };
  // Seed a fresh expense so the resident definitely sees something.
  const seed = await request.post(`${apiURL}/finance/expenses`, {
    headers: adminH,
    data: {
      amount_cents: 99_900,
      category: 'utilities',
      description: `E2E Conta ${Date.now()}`,
      spent_at: new Date().toISOString().slice(0, 10),
    },
  });
  expect(seed.ok()).toBeTruthy();
  const seedId = (await seed.json()).data.id as number;

  const residentH = { Authorization: `Bearer ${await residentToken(request)}`, 'Content-Type': 'application/json' };
  const list = await request.get(`${apiURL}/finance/expenses`, { headers: residentH });
  expect(list.ok(), `resident GET blocked: ${list.status()}`).toBeTruthy();
  const body = (await list.json()).data as { expenses: Array<{ id: number }> };
  expect(body.expenses.find((e) => e.id === seedId)).toBeTruthy();

  // Resident cannot POST — should hit the role guard.
  const tryCreate = await request.post(`${apiURL}/finance/expenses`, {
    headers: residentH,
    data: {
      amount_cents: 100,
      category: 'other',
      description: 'Sneaky',
      spent_at: new Date().toISOString().slice(0, 10),
    },
  });
  expect(tryCreate.status()).toBeGreaterThanOrEqual(400);
  expect(tryCreate.status()).toBeLessThan(500);

  // Clean the seeded expense
  await request.delete(`${apiURL}/finance/expenses/${seedId}`, { headers: adminH });
});

test('Finance API: admin can create dues, generate receivables, and record payment', async ({ request }) => {
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const tag = Date.now();

  const before = await request.get(`${apiURL}/finance/receivables`, { headers });
  expect(before.ok(), `receivables failed: ${before.status()} ${await before.text()}`).toBeTruthy();
  const beforeBody = (await before.json()).data as {
    units: Array<{ unit_id: number; unit_number: string }>;
  };
  const unit = beforeBody.units[0];
  expect(unit?.unit_id, 'seed condo needs at least one unit').toBeTruthy();

  const schedule = await request.post(`${apiURL}/finance/schedules`, {
    headers,
    data: {
      name: `E2E Dues ${tag}`,
      amount_cents: 123_45,
      currency: 'BRL',
      frequency: 'monthly',
      due_day: 8,
    },
  });
  expect(schedule.ok(), `schedule failed: ${schedule.status()} ${await schedule.text()}`).toBeTruthy();
  const scheduleId = (await schedule.json()).data.id as number;

  const invoices = await request.post(`${apiURL}/finance/invoices`, {
    headers,
    data: {
      schedule_id: scheduleId,
      period: '2099-01',
      due_date: '2099-01-08T12:00:00.000Z',
      unit_ids: [unit.unit_id],
      notes: `E2E generated ${tag}`,
    },
  });
  expect(invoices.ok(), `invoice generation failed: ${invoices.status()} ${await invoices.text()}`).toBeTruthy();
  const invoiceBody = (await invoices.json()).data as { created_count: number; invoice_ids: number[] };
  expect(invoiceBody.created_count).toBe(1);
  const invoiceId = invoiceBody.invoice_ids[0];

  const receivables = await request.get(`${apiURL}/finance/receivables`, { headers });
  expect(receivables.ok()).toBeTruthy();
  const receivablesBody = (await receivables.json()).data as {
    total_open_cents: number;
    invoices: Array<{ id: number; remaining_cents: number; schedule_name: string | null }>;
  };
  const invoice = receivablesBody.invoices.find((row) => row.id === invoiceId);
  expect(invoice?.remaining_cents).toBe(123_45);
  expect(invoice?.schedule_name).toContain(`E2E Dues ${tag}`);

  const payment = await request.post(`${apiURL}/finance/payments`, {
    headers,
    data: {
      invoice_id: invoiceId,
      amount_cents: 123_45,
      method: 'manual',
      reference: `E2E-${tag}`,
      paid_at: '2099-01-09T12:00:00.000Z',
    },
  });
  expect(payment.ok(), `payment failed: ${payment.status()} ${await payment.text()}`).toBeTruthy();
  const paymentBody = (await payment.json()).data as { invoice_status: string; remaining_cents: number };
  expect(paymentBody.invoice_status).toBe('paid');
  expect(paymentBody.remaining_cents).toBe(0);
});
