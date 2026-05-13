import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };

async function loginApi(request: APIRequestContext): Promise<Session> {
  const res = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'admin@condoos.dev', password: 'admin123' },
  });
  expect(res.ok(), `login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

async function installSession(page: Page, session: Session) {
  await page.addInitScript((args: { token: string; user: unknown }) => {
    localStorage.setItem('condoos_token', args.token);
    localStorage.setItem('condoos_user', JSON.stringify(args.user));
  }, { token: session.token, user: session.user });
}

test('admin sees vendor scorecards from dispatches, work orders, and expenses', async ({ request, page }) => {
  const admin = await loginApi(request);
  const headers = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };
  const tag = Date.now();
  const vendorName = `E2E Scorecard Vendor ${tag}`;

  const contactRes = await request.post(`${apiURL}/service-contacts`, {
    headers,
    data: {
      category: 'general_maintenance',
      company_name: vendorName,
      email: `scorecard-${tag}@vendors.test`,
      preferred: true,
    },
  });
  expect(contactRes.ok(), `contact create failed: ${contactRes.status()} ${await contactRes.text()}`).toBeTruthy();
  const contactId: number = (await contactRes.json()).data.id;

  const ticketRes = await request.post(`${apiURL}/tickets`, {
    headers,
    data: {
      title: `E2E Scorecard Ticket ${tag}`,
      description: 'Seeded to prove Operations vendor scorecards render from real history.',
      category: 'general_maintenance',
      priority: 'normal',
    },
  });
  expect(ticketRes.ok()).toBeTruthy();
  const ticketId: number = (await ticketRes.json()).data.id;

  const dispatchRes = await request.post(`${apiURL}/tickets/${ticketId}/dispatch`, {
    headers,
    data: {
      service_contact_id: contactId,
      channel: 'email',
      message: 'Please confirm your availability.',
    },
  });
  expect(dispatchRes.ok(), `dispatch failed: ${dispatchRes.status()} ${await dispatchRes.text()}`).toBeTruthy();
  const dispatchId: number = (await dispatchRes.json()).data.id;

  const respondedRes = await request.post(`${apiURL}/tickets/${ticketId}/dispatches/${dispatchId}/responded`, {
    headers,
    data: { response_summary: 'Confirmed availability for tomorrow morning.' },
  });
  expect(respondedRes.ok()).toBeTruthy();

  const workOrderRes = await request.post(`${apiURL}/tickets/${ticketId}/work-order`, {
    headers,
    data: {
      service_contact_id: contactId,
      title: `E2E Scorecard Work ${tag}`,
      status: 'scheduled',
      scheduled_for: '2026-05-14 09:30',
      estimated_amount_cents: 42_000,
    },
  });
  expect(workOrderRes.ok()).toBeTruthy();

  const expenseRes = await request.post(`${apiURL}/finance/expenses`, {
    headers,
    data: {
      amount_cents: 42_000,
      currency: 'USD',
      category: 'maintenance',
      vendor: vendorName,
      description: `E2E Scorecard Expense ${tag}`,
      spent_at: '2026-05-14',
    },
  });
  expect(expenseRes.ok(), `expense failed: ${expenseRes.status()} ${await expenseRes.text()}`).toBeTruthy();

  const listRes = await request.get(`${apiURL}/service-contacts?include_inactive=1`, { headers });
  expect(listRes.ok()).toBeTruthy();
  const rows = (await listRes.json()).data as any[];
  const scorecard = rows.find((row) => row.id === contactId);
  expect(scorecard).toBeTruthy();
  expect(scorecard.dispatches_total).toBe(1);
  expect(scorecard.dispatches_responded).toBe(1);
  expect(scorecard.work_orders_total).toBe(1);
  expect(scorecard.work_orders_open).toBe(1);
  expect(scorecard.expense_total_cents).toBe(42_000);

  await installSession(page, admin);
  await page.goto('/board/services', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Vendor intelligence|Inteligência de fornecedores|Inteligencia de proveedores/i })).toBeVisible();
  const vendorRow = page.getByTestId(`service-contact-${contactId}`);
  await expect(vendorRow.getByRole('heading', { name: vendorName })).toBeVisible();
  await expect(vendorRow.getByText('Scorecard', { exact: true })).toBeVisible();
  await expect(vendorRow.getByText('100%')).toBeVisible();
  await expect(vendorRow.getByText(/420/).first()).toBeVisible();
});
