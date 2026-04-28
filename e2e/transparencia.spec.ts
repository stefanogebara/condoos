// Budget transparency (#12): admin logs expenses via /api/finance/expenses,
// residents read them. Same endpoint serves both — RBAC limits POST/DELETE.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

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
