// Visitors: pre-approve future visitors (#9) + history surfaces past entries (#8).
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

async function residentToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'resident@condoos.dev', password: 'resident123' },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).data.token;
}

test('Visitors API: pre_approve=true sets status=approved + decided_at', async ({ request }) => {
  const token = await residentToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const created = await request.post(`${apiURL}/visitors`, {
    headers,
    data: {
      visitor_name: `E2E Pre-Approve ${Date.now()}`,
      visitor_type: 'guest',
      expected_at: tomorrow,
      notes: 'Babá. Sábado à tarde.',
      pre_approve: true,
    },
  });
  expect(created.ok()).toBeTruthy();
  const body = (await created.json()).data;
  expect(body.status).toBe('approved');

  // Lookup via list — same status comes back.
  const list = await request.get(`${apiURL}/visitors`, { headers });
  const rows = (await list.json()).data as Array<{ id: number; status: string; decided_at: string | null }>;
  const found = rows.find((r) => r.id === body.id);
  expect(found, 'pre-approved visitor missing from list').toBeTruthy();
  expect(found!.status).toBe('approved');
  expect(found!.decided_at).toBeTruthy();
});

test('Visitors API: pre_approve=false keeps status=pending (legacy flow)', async ({ request }) => {
  const token = await residentToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const created = await request.post(`${apiURL}/visitors`, {
    headers,
    data: {
      visitor_name: `E2E Pending ${Date.now()}`,
      visitor_type: 'delivery',
      // No expected_at — open-ended request.
    },
  });
  expect(created.ok()).toBeTruthy();
  const body = (await created.json()).data;
  expect(body.status).toBe('pending');
});

test('Visitors API: party guest list is approved and visible to concierge', async ({ request }) => {
  const token = await residentToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const created = await request.post(`${apiURL}/visitors`, {
    headers,
    data: {
      visitor_name: `E2E Party ${Date.now()}`,
      visitor_type: 'guest',
      expected_at: null,
      expected_guests: 3,
      guest_list: 'Ana Souza\nBruno Lima\nCarla Ferreira',
      notes: 'Birthday list',
      pre_approve: true,
    },
  });
  expect(created.ok(), `party create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const party = (await created.json()).data;
  expect(party.status).toBe('approved');

  const conciergeLogin = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
  });
  expect(conciergeLogin.ok()).toBeTruthy();
  const conciergeToken = (await conciergeLogin.json()).data.token;
  const todayRes = await request.get(`${apiURL}/concierge/today`, {
    headers: { Authorization: `Bearer ${conciergeToken}` },
  });
  expect(todayRes.ok()).toBeTruthy();
  const todayBody = (await todayRes.json()).data;
  expect(todayBody.parties.some((p: any) => String(p.id) === `visitor-${party.id}` && p.guest_list.includes('Ana Souza'))).toBe(true);
});

test('Visitors API: recurring visitor surfaces on matching weekday for concierge', async ({ request }) => {
  const token = await residentToken(request);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const weekday = new Date().getDay();
  const created = await request.post(`${apiURL}/visitors`, {
    headers,
    data: {
      visitor_name: `E2E Recurring ${Date.now()}`,
      visitor_type: 'service',
      expected_at: null,
      recurring_days: [weekday],
      recurring_until: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      pre_approve: true,
    },
  });
  expect(created.ok(), `recurring create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const body = (await created.json()).data;
  expect(body.status).toBe('approved');

  const conciergeLogin = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
  });
  expect(conciergeLogin.ok()).toBeTruthy();
  const conciergeToken = (await conciergeLogin.json()).data.token;
  const todayRes = await request.get(`${apiURL}/concierge/today`, {
    headers: { Authorization: `Bearer ${conciergeToken}` },
  });
  expect(todayRes.ok()).toBeTruthy();
  const todayBody = (await todayRes.json()).data;
  expect(todayBody.visitors.some((v: any) => v.id === body.id && v.recurring_days === String(weekday))).toBe(true);
});
