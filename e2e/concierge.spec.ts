// Concierge / Porteiro role + today-view (#11).
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

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

test('Concierge API: porteiro notifies, resident approves, porteiro records arrival', async ({ request }) => {
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

  // Porteiro does not approve access in-app.
  const porteiro = await login(request, 'porteiro@condoos.dev', 'porteiro123');
  const porteiroHeaders = { Authorization: `Bearer ${porteiro.token}`, 'Content-Type': 'application/json' };
  const decide = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: porteiroHeaders,
    data: { decision: 'approved' },
  });
  expect(decide.status()).toBe(403);

  const notify = await request.post(`${apiURL}/concierge/notify`, {
    headers: porteiroHeaders,
    data: { target_type: 'visitor', target_id: visitorId, message_type: 'visitor_arrived' },
  });
  expect(notify.ok(), `notify failed: ${notify.status()} ${await notify.text()}`).toBeTruthy();

  // Resident approves from their app/API.
  const residentDecision = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: residentHeaders,
    data: { decision: 'approved' },
  });
  expect(residentDecision.ok(), `resident decide failed: ${residentDecision.status()} ${await residentDecision.text()}`).toBeTruthy();
  expect((await residentDecision.json()).data.status).toBe('approved');

  const arrived = await request.post(`${apiURL}/visitors/${visitorId}/arrived`, {
    headers: porteiroHeaders,
  });
  expect(arrived.ok(), `arrived failed: ${arrived.status()} ${await arrived.text()}`).toBeTruthy();
  expect((await arrived.json()).data.status).toBe('arrived');
});

test('Concierge API: porteiro creates an unlisted walk-up for resident approval', async ({ request }) => {
  const resident = await login(request, 'resident@condoos.dev', 'resident123');
  const porteiro = await login(request, 'porteiro@condoos.dev', 'porteiro123');
  const porteiroHeaders = { Authorization: `Bearer ${porteiro.token}`, 'Content-Type': 'application/json' };

  const walkup = await request.post(`${apiURL}/concierge/walkup`, {
    headers: porteiroHeaders,
    data: {
      resident_id: resident.user.id,
      visitor_name: `E2E Unlisted ${Date.now()}`,
      visitor_type: 'delivery',
      notes: 'Food delivery at front desk',
    },
  });
  expect(walkup.ok(), `walkup failed: ${walkup.status()} ${await walkup.text()}`).toBeTruthy();
  const visitorId = (await walkup.json()).data.id as number;

  const residentList = await request.get(`${apiURL}/visitors`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  const rows = (await residentList.json()).data as Array<{ id: number; status: string; visitor_type: string }>;
  expect(rows.find((r) => r.id === visitorId && r.status === 'pending' && r.visitor_type === 'delivery')).toBeTruthy();

  const approved = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' },
    data: { decision: 'approved' },
  });
  expect(approved.ok()).toBeTruthy();
});

test('Concierge API: porteiro can notify resident about an arriving visitor', async ({ request }) => {
  const resident = await login(request, 'resident@condoos.dev', 'resident123');
  const residentHeaders = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };
  const created = await request.post(`${apiURL}/visitors`, {
    headers: residentHeaders,
    data: {
      visitor_name: `E2E Notify ${Date.now()}`,
      visitor_type: 'guest',
      expected_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      pre_approve: true,
    },
  });
  expect(created.ok(), `create visitor failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const visitorId = (await created.json()).data.id;

  const concierge = await login(request, 'porteiro@condoos.dev', 'porteiro123');
  const notify = await request.post(`${apiURL}/concierge/notify`, {
    headers: { Authorization: `Bearer ${concierge.token}`, 'Content-Type': 'application/json' },
    data: { target_type: 'visitor', target_id: visitorId, message_type: 'visitor_arrived' },
  });
  expect(notify.ok(), `notify failed: ${notify.status()} ${await notify.text()}`).toBeTruthy();
  const body = (await notify.json()).data;
  expect(body.notified_user_id).toBe(resident.user.id);
});
