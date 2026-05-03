// User settings: GET /users/me, PATCH profile fields (phone, whatsapp_opt_in,
// first_name, last_name), validation, and nothing-to-update guard.
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
// 1. GET /users/me returns expected profile fields
// ---------------------------------------------------------------------------

test('User settings: GET /users/me returns profile fields', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const h        = { Authorization: `Bearer ${resident.token}` };

  const res  = await request.get(`${apiURL}/users/me`, { headers: h });
  expect(res.ok()).toBeTruthy();
  const user = (await res.json()).data;
  expect(user).toHaveProperty('id');
  expect(user).toHaveProperty('email');
  expect(user).toHaveProperty('first_name');
  expect(user).toHaveProperty('last_name');
  expect(user).toHaveProperty('role');
  expect(user).toHaveProperty('phone');
  expect(user).toHaveProperty('whatsapp_opt_in');
});

// ---------------------------------------------------------------------------
// 2. PATCH phone + whatsapp_opt_in roundtrips correctly
// ---------------------------------------------------------------------------

test('User settings: PATCH phone + whatsapp_opt_in persists and roundtrips', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const h        = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const phone = '+5511999887766';
  const patchRes = await request.patch(`${apiURL}/users/me`, {
    headers: h,
    data: { phone, whatsapp_opt_in: true },
  });
  expect(patchRes.ok(), `patch failed: ${patchRes.status()} ${await patchRes.text()}`).toBeTruthy();
  const updated = (await patchRes.json()).data;
  expect(updated.phone).toBe(phone);
  expect(updated.whatsapp_opt_in).toBeTruthy();

  // Roundtrip via GET
  const getRes = await request.get(`${apiURL}/users/me`, { headers: h });
  const fetched = (await getRes.json()).data;
  expect(fetched.phone).toBe(phone);
  expect(fetched.whatsapp_opt_in).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 3. PATCH first_name + last_name roundtrips correctly
// ---------------------------------------------------------------------------

test('User settings: PATCH first_name and last_name roundtrips', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const h     = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const tag = Date.now();
  const patchRes = await request.patch(`${apiURL}/users/me`, {
    headers: h,
    data: { first_name: `AdmFirst${tag}`, last_name: `AdmLast${tag}` },
  });
  expect(patchRes.ok()).toBeTruthy();
  const updated = (await patchRes.json()).data;
  expect(updated.first_name).toBe(`AdmFirst${tag}`);
  expect(updated.last_name).toBe(`AdmLast${tag}`);
});

// ---------------------------------------------------------------------------
// 4. Invalid phone format is rejected
// ---------------------------------------------------------------------------

test('User settings: invalid phone format is rejected', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const h        = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const badRes = await request.patch(`${apiURL}/users/me`, {
    headers: h,
    data: { phone: 'not-a-phone!!!!' },
  });
  expect(badRes.status()).toBeGreaterThanOrEqual(400);
  expect((await badRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 5. Empty PATCH body (nothing to update) returns an error
// ---------------------------------------------------------------------------

test('User settings: empty PATCH body returns nothing_to_update error', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const h        = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const emptyRes = await request.patch(`${apiURL}/users/me`, { headers: h, data: {} });
  expect(emptyRes.status()).toBeGreaterThanOrEqual(400);
  expect((await emptyRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 6. Unauthenticated access is rejected
// ---------------------------------------------------------------------------

test('User settings: unauthenticated GET /users/me returns 401', async ({ request }) => {
  const res = await request.get(`${apiURL}/users/me`);
  expect(res.status()).toBe(401);
});
