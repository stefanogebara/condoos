// Concierge / Porteiro role + today-view (#11).
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

async function login(request: APIRequestContext, email: string, password: string) {
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data as { token: string; user: { id: number; role: string } };
}

test('Concierge API: seeded porteiro can hit /concierge/today', async ({ request }) => {
  const session = await login(request, 'porteiro@condoos.dev', 'porteiro123');
  expect(session.user.role).toBe('concierge');

  const headers = { Authorization: `Bearer ${session.token}` };
  const today = await request.get(`${apiURL}/concierge/today`, { headers });
  expect(today.ok(), `today failed: ${today.status()} ${await today.text()}`).toBeTruthy();
  const body = (await today.json()).data;
  expect(body).toHaveProperty('visitors');
  expect(body).toHaveProperty('packages');
  expect(body).toHaveProperty('parties');
  expect(Array.isArray(body.visitors)).toBeTruthy();
});

test('Concierge API: residents cannot hit /concierge/today', async ({ request }) => {
  const session = await login(request, 'resident@condoos.dev', 'resident123');
  const headers = { Authorization: `Bearer ${session.token}` };

  const blocked = await request.get(`${apiURL}/concierge/today`, { headers });
  expect(blocked.status()).toBe(403);
});

test('Concierge API: admin can list staff and the seeded porteiro shows up', async ({ request }) => {
  const session = await login(request, 'admin@condoos.dev', 'admin123');
  const headers = { Authorization: `Bearer ${session.token}` };

  const list = await request.get(`${apiURL}/concierge/staff`, { headers });
  expect(list.ok()).toBeTruthy();
  const rows = (await list.json()).data as Array<{ email: string }>;
  expect(rows.find((r) => r.email === 'porteiro@condoos.dev')).toBeTruthy();
});

test('Concierge API: porteiro can mark a pending visitor approved', async ({ request }) => {
  // Resident creates a NON-pre-approved walk-up visitor for today.
  const resident = await login(request, 'resident@condoos.dev', 'resident123');
  const residentHeaders = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };
  const expected = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const created = await request.post(`${apiURL}/visitors`, {
    headers: residentHeaders,
    data: {
      visitor_name: `E2E Walk-up ${Date.now()}`,
      visitor_type: 'guest',
      expected_at: expected,
      // pre_approve omitted → status=pending
    },
  });
  expect(created.ok()).toBeTruthy();
  const visitorId = (await created.json()).data.id as number;

  // Porteiro decides — should succeed (#11 widened the role guard).
  const porteiro = await login(request, 'porteiro@condoos.dev', 'porteiro123');
  const porteiroHeaders = { Authorization: `Bearer ${porteiro.token}`, 'Content-Type': 'application/json' };
  const decide = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: porteiroHeaders,
    data: { decision: 'approved' },
  });
  expect(decide.ok(), `decide failed: ${decide.status()} ${await decide.text()}`).toBeTruthy();
  expect((await decide.json()).data.status).toBe('approved');
});
