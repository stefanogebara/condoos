// Visitors: pre-approve future visitors (#9) + history surfaces past entries (#8).
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

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
