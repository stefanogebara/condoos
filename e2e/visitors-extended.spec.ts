// Visitors extended: concierge/admin decide (approve/deny), arrived transition,
// access-control for residents on decide endpoint.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

async function createPendingVisitor(
  request: APIRequestContext,
  residentToken: string,
): Promise<number> {
  const h = { Authorization: `Bearer ${residentToken}`, 'Content-Type': 'application/json' };
  const r = await request.post(`${apiURL}/visitors`, {
    headers: h,
    data: { visitor_name: `E2E Visitor ${Date.now()}`, visitor_type: 'guest', pre_approve: false },
  });
  expect(r.ok(), `create visitor failed: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data.id as number;
}

// ---------------------------------------------------------------------------
// 1. Admin approves a pending visitor
// ---------------------------------------------------------------------------

test('Visitors: admin approves a pending visitor → status becomes approved', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const visitorId = await createPendingVisitor(request, resident.token);

  const decideRes = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: admH,
    data: { decision: 'approved' },
  });
  expect(decideRes.ok(), `decide failed: ${decideRes.status()} ${await decideRes.text()}`).toBeTruthy();
  const result = (await decideRes.json()).data;
  expect(result.status).toBe('approved');
  expect(result.id).toBe(visitorId);
});

// ---------------------------------------------------------------------------
// 2. Admin denies a pending visitor
// ---------------------------------------------------------------------------

test('Visitors: admin denies a pending visitor → status becomes denied', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const visitorId = await createPendingVisitor(request, resident.token);

  const decideRes = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: admH,
    data: { decision: 'denied' },
  });
  expect(decideRes.ok()).toBeTruthy();
  expect((await decideRes.json()).data.status).toBe('denied');
});

// ---------------------------------------------------------------------------
// 3. Resident cannot decide (403)
// ---------------------------------------------------------------------------

test('Visitors: resident gets 403 trying to decide on a visitor', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const visitorId = await createPendingVisitor(request, resident.token);

  const decideRes = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: resH,
    data: { decision: 'approved' },
  });
  expect(decideRes.status()).toBe(403);

  // keep admin token used so linter doesn't complain
  expect(admin.user.role).toBe('board_admin');
});

// ---------------------------------------------------------------------------
// 4. Invalid decision value is rejected
// ---------------------------------------------------------------------------

test('Visitors: invalid decision value returns an error', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const visitorId = await createPendingVisitor(request, resident.token);

  const badRes = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: admH,
    data: { decision: 'maybe' },
  });
  expect(badRes.status()).toBeGreaterThanOrEqual(400);
  expect((await badRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 5. Admin marks a visitor as arrived
// ---------------------------------------------------------------------------

test('Visitors: admin marks an approved visitor as arrived', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Create + approve, then mark arrived
  const visitorId = await createPendingVisitor(request, resident.token);
  await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: admH,
    data: { decision: 'approved' },
  });

  const arrivedRes = await request.post(`${apiURL}/visitors/${visitorId}/arrived`, {
    headers: admH,
  });
  expect(arrivedRes.ok(), `arrived failed: ${arrivedRes.status()} ${await arrivedRes.text()}`).toBeTruthy();
  expect((await arrivedRes.json()).data.status).toBe('arrived');
});

// ---------------------------------------------------------------------------
// 6. Concierge can also decide and mark arrived
// ---------------------------------------------------------------------------

test('Visitors: seeded porteiro can decide and mark arrived', async ({ request }) => {
  const porteiro = await loginApi(request, 'porteiro@condoos.dev', 'porteiro123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const porH     = { Authorization: `Bearer ${porteiro.token}`, 'Content-Type': 'application/json' };

  const visitorId = await createPendingVisitor(request, resident.token);

  const decideRes = await request.post(`${apiURL}/visitors/${visitorId}/decide`, {
    headers: porH,
    data: { decision: 'approved' },
  });
  expect(decideRes.ok()).toBeTruthy();
  expect((await decideRes.json()).data.status).toBe('approved');

  const arrivedRes = await request.post(`${apiURL}/visitors/${visitorId}/arrived`, { headers: porH });
  expect(arrivedRes.ok()).toBeTruthy();
  expect((await arrivedRes.json()).data.status).toBe('arrived');
});
