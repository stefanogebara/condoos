// Concierge staff management: admin invites porteiro, staff list, duplicate guard,
// validation, and resident access control.
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

// ---------------------------------------------------------------------------
// 1. Admin invites a concierge → appears in staff list
// ---------------------------------------------------------------------------

test('Concierge staff: admin invites porteiro → staff list includes them', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const tag   = Date.now();
  const email = `porteiro-e2e-${tag}@condoos.dev`;

  const inviteRes = await request.post(`${apiURL}/concierge/invite`, {
    headers: admH,
    data: { email, first_name: 'E2E', last_name: 'Porteiro', password: 'porteiro12345' },
  });
  expect(inviteRes.ok(), `invite failed: ${inviteRes.status()} ${await inviteRes.text()}`).toBeTruthy();
  const invited = (await inviteRes.json()).data;
  expect(invited.role).toBe('concierge');
  expect(invited.email).toBe(email);
  expect(invited.id).toBeGreaterThan(0);

  // Verify they appear in the staff list
  const staffRes = await request.get(`${apiURL}/concierge/staff`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(staffRes.ok()).toBeTruthy();
  const staff = (await staffRes.json()).data as any[];
  expect(staff.some((s: any) => s.email === email)).toBe(true);
});

// ---------------------------------------------------------------------------
// 2. Duplicate email is rejected with 409
// ---------------------------------------------------------------------------

test('Concierge staff: duplicate email returns 409', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const email = `porteiro-dup-${Date.now()}@condoos.dev`;

  await request.post(`${apiURL}/concierge/invite`, {
    headers: admH,
    data: { email, first_name: 'First', last_name: 'Dup', password: 'porteiro12345' },
  });

  const dupRes = await request.post(`${apiURL}/concierge/invite`, {
    headers: admH,
    data: { email, first_name: 'Second', last_name: 'Dup', password: 'porteiro67890' },
  });
  expect(dupRes.status()).toBe(409);
  expect((await dupRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 3. Missing required fields returns 400
// ---------------------------------------------------------------------------

test('Concierge staff: missing email or password returns 400', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // No email
  const noEmail = await request.post(`${apiURL}/concierge/invite`, {
    headers: admH,
    data: { first_name: 'Test', password: 'porto123' },
  });
  expect(noEmail.status()).toBeGreaterThanOrEqual(400);

  // No password
  const noPass = await request.post(`${apiURL}/concierge/invite`, {
    headers: admH,
    data: { email: `no-pass-${Date.now()}@condoos.dev`, first_name: 'Test' },
  });
  expect(noPass.status()).toBeGreaterThanOrEqual(400);
});

// ---------------------------------------------------------------------------
// 4. Resident cannot invite or see staff list (403)
// ---------------------------------------------------------------------------

test('Concierge staff: resident gets 403 on invite and staff list', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const inviteRes = await request.post(`${apiURL}/concierge/invite`, {
    headers: resH,
    data: { email: `blocked-${Date.now()}@condoos.dev`, first_name: 'Hacker', password: 'hh1234' },
  });
  expect(inviteRes.status()).toBe(403);

  const staffRes = await request.get(`${apiURL}/concierge/staff`, { headers: resH });
  expect(staffRes.status()).toBe(403);
});
