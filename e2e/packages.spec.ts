// Packages: admin logs, resident views and picks up, double-pickup protection,
// scoping (resident only sees own packages), auth gates.
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
// 1. Admin logs a package for the resident → resident sees it in their list
// ---------------------------------------------------------------------------

test('Packages: admin logs package → resident sees it in their list', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}` };

  // Log a package addressed to the resident
  const createRes = await request.post(`${apiURL}/packages`, {
    headers: admH,
    data: {
      recipient_id: resident.user.id,
      carrier:      'Correios',
      description:  `E2E Pacote ${Date.now()}`,
    },
  });
  expect(createRes.ok(), `log package failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
  const pkgId: number = (await createRes.json()).data.id;
  expect(pkgId).toBeGreaterThan(0);

  // Resident sees the package in their list
  const listRes = await request.get(`${apiURL}/packages`, { headers: resH });
  expect(listRes.ok()).toBeTruthy();
  const list = (await listRes.json()).data as any[];
  const found = list.find((p: any) => p.id === pkgId);
  expect(found, `package ${pkgId} not found in resident list`).toBeTruthy();
  expect(found.status).toBe('waiting');
  expect(found.carrier).toBe('Correios');
});

// ---------------------------------------------------------------------------
// 2. Resident marks their package as picked up
// ---------------------------------------------------------------------------

test('Packages: resident can pick up their own package', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/packages`, {
    headers: admH,
    data: { recipient_id: resident.user.id, carrier: 'DHL', description: `E2E Pickup ${Date.now()}` },
  });
  const pkgId: number = (await createRes.json()).data.id;

  const pickupRes = await request.post(`${apiURL}/packages/${pkgId}/pickup`, { headers: resH });
  expect(pickupRes.ok(), `pickup failed: ${pickupRes.status()} ${await pickupRes.text()}`).toBeTruthy();
  const result = (await pickupRes.json()).data;
  expect(result.status).toBe('picked_up');
});

// ---------------------------------------------------------------------------
// 3. Double-pickup is rejected (package already picked up)
// ---------------------------------------------------------------------------

test('Packages: double-pickup returns an error', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/packages`, {
    headers: admH,
    data: { recipient_id: resident.user.id, carrier: 'FedEx', description: `E2E Double ${Date.now()}` },
  });
  const pkgId: number = (await createRes.json()).data.id;

  // First pickup — should succeed
  await request.post(`${apiURL}/packages/${pkgId}/pickup`, { headers: resH });

  // Second pickup — should fail (409 Conflict or 400)
  const double = await request.post(`${apiURL}/packages/${pkgId}/pickup`, { headers: resH });
  expect(double.status()).toBeGreaterThanOrEqual(400);
  expect((await double.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 4. Resident cannot log a package (admin-only)
// ---------------------------------------------------------------------------

test('Packages: resident gets 403 trying to log a package', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const createRes = await request.post(`${apiURL}/packages`, {
    headers: resH,
    data: { recipient_id: admin.user.id, carrier: 'UPS', description: 'Tentativa não autorizada' },
  });
  expect(createRes.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 5. Scoping: admin sees packages for all residents; resident sees only their own
// ---------------------------------------------------------------------------

test('Packages: admin sees all packages; resident sees only their own', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH  = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH  = { Authorization: `Bearer ${resident.token}` };

  // Log a package for the resident and one for the admin
  const resPkg = await request.post(`${apiURL}/packages`, {
    headers: admH,
    data: { recipient_id: resident.user.id, carrier: 'Sedex', description: `E2E Scope Resident ${Date.now()}` },
  });
  const admPkg = await request.post(`${apiURL}/packages`, {
    headers: admH,
    data: { recipient_id: admin.user.id, carrier: 'Sedex', description: `E2E Scope Admin ${Date.now()}` },
  });
  const resPkgId: number = (await resPkg.json()).data.id;
  const admPkgId: number = (await admPkg.json()).data.id;

  // Admin sees both
  const adminList = (await (await request.get(`${apiURL}/packages`, { headers: admH })).json()).data as any[];
  const adminIds  = adminList.map((p: any) => p.id);
  expect(adminIds).toContain(resPkgId);
  expect(adminIds).toContain(admPkgId);

  // Resident sees only their own
  const resList = (await (await request.get(`${apiURL}/packages`, { headers: resH })).json()).data as any[];
  const resIds  = resList.map((p: any) => p.id);
  expect(resIds).toContain(resPkgId);
  expect(resIds).not.toContain(admPkgId);
});
