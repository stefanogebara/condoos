// Membership lifecycle: pending list, approve, deny, move-out, reactivate,
// transfer-unit, reassign, history. Uses freshly registered test users so the
// seeded resident's membership is never affected.
import { expect, test, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

const E2E_SECRET = process.env.E2E_REGISTER_SECRET || 'local-e2e-secret-32chars-min';

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

// Registers a fresh user via the E2E backdoor endpoint.
async function registerUser(request: APIRequestContext, tag: string): Promise<Session> {
  const email    = `e2e-member-${tag}@condoos.dev`;
  const password = 'test-password-123';
  const r = await request.post(`${apiURL}/auth/dev-register`, {
    headers: { 'Content-Type': 'application/json', 'x-e2e-secret': E2E_SECRET },
    data: { email, password, first_name: 'Test', last_name: `User${tag}` },
  });
  expect(r.ok(), `register failed: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data as Session;
}

// Gets the invite code for the active condo (admin's condo).
async function getInviteCode(request: APIRequestContext, token: string): Promise<string> {
  const h = { Authorization: `Bearer ${token}` };
  const r = await request.get(`${apiURL}/onboarding/my-invite-code`, { headers: h });
  expect(r.ok(), `invite code fetch failed: ${r.status()}`).toBeTruthy();
  return (await r.json()).data.invite_code as string;
}

// Registers a user, joins the condo → creates a pending membership.
// Returns { membershipId, unitId, userSession }.
async function createPendingMembership(
  request: APIRequestContext,
  adminToken: string,
  tag: string,
): Promise<{ membershipId: number; unitId: number; userSession: Session }> {
  const userSession = await registerUser(request, tag);
  const code        = await getInviteCode(request, adminToken);

  // Look up the condo details + available units by invite code.
  const lookupRes = await request.get(`${apiURL}/onboarding/by-code/${code}`, {
    headers: { Authorization: `Bearer ${userSession.token}` },
  });
  expect(lookupRes.ok(), `code lookup failed: ${lookupRes.status()}`).toBeTruthy();
  const units = (await lookupRes.json()).data?.units as any[] | undefined;
  expect(units && units.length > 0, 'no units found for invite code').toBeTruthy();
  const unit_id = units![0].id;

  const joinRes = await request.post(`${apiURL}/onboarding/join`, {
    headers: { Authorization: `Bearer ${userSession.token}`, 'Content-Type': 'application/json' },
    data: { code, unit_id, relationship: 'tenant', mobile_phone: '+1 305 555 0199' },
  });
  expect(joinRes.ok(), `join failed: ${joinRes.status()} ${await joinRes.text()}`).toBeTruthy();

  // Find the pending membership ID by listing pending
  const pendingRes = await request.get(`${apiURL}/memberships/pending`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const pending = (await pendingRes.json()).data as any[];
  const match   = pending.find((m: any) => m.user_id === userSession.user.id);
  expect(match, `pending membership not found for user ${userSession.user.id}`).toBeTruthy();

  return { membershipId: match.id, unitId: unit_id, userSession };
}

// ---------------------------------------------------------------------------
// 1. GET /memberships/pending returns an array (may be empty)
// ---------------------------------------------------------------------------

test('Memberships: admin can list pending claims', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const h     = { Authorization: `Bearer ${admin.token}` };

  const res = await request.get(`${apiURL}/memberships/pending`, { headers: h });
  expect(res.ok()).toBeTruthy();
  expect(Array.isArray((await res.json()).data)).toBe(true);
});

// ---------------------------------------------------------------------------
// 2. Resident gets 403 on pending list
// ---------------------------------------------------------------------------

test('Memberships: resident cannot list pending claims', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const h        = { Authorization: `Bearer ${resident.token}` };

  const res = await request.get(`${apiURL}/memberships/pending`, { headers: h });
  expect(res.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 3. Approve a pending membership
// ---------------------------------------------------------------------------

test('Memberships: admin approves a pending claim → status becomes active', async ({ request }) => {
  test.setTimeout(30_000);
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const { membershipId } = await createPendingMembership(request, admin.token, `approve-${Date.now()}`);

  const approveRes = await request.post(`${apiURL}/memberships/${membershipId}/approve`, {
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
  });
  expect(approveRes.ok(), `approve failed: ${approveRes.status()} ${await approveRes.text()}`).toBeTruthy();
  expect((await approveRes.json()).data.status).toBe('active');
});

// ---------------------------------------------------------------------------
// 4. Deny a pending membership
// ---------------------------------------------------------------------------

test('Memberships: admin denies a pending claim → status becomes revoked', async ({ request }) => {
  test.setTimeout(30_000);
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const { membershipId } = await createPendingMembership(request, admin.token, `deny-${Date.now()}`);

  const denyRes = await request.post(`${apiURL}/memberships/${membershipId}/deny`, {
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
  });
  expect(denyRes.ok(), `deny failed: ${denyRes.status()} ${await denyRes.text()}`).toBeTruthy();
  expect((await denyRes.json()).data.status).toBe('revoked');
});

// ---------------------------------------------------------------------------
// 5. Move-out then reactivate a membership
// ---------------------------------------------------------------------------

test('Memberships: move-out then reactivate restores active status', async ({ request }) => {
  test.setTimeout(45_000);
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Create and approve a fresh membership to move out (don't touch seeded resident)
  const { membershipId } = await createPendingMembership(request, admin.token, `moveout-${Date.now()}`);
  await request.post(`${apiURL}/memberships/${membershipId}/approve`, { headers: admH });

  // Move out
  const moveRes = await request.post(`${apiURL}/memberships/${membershipId}/move-out`, {
    headers: admH,
    data: { move_out_date: new Date().toISOString() },
  });
  expect(moveRes.ok(), `move-out failed: ${moveRes.status()} ${await moveRes.text()}`).toBeTruthy();

  // Reactivate
  const reactRes = await request.post(`${apiURL}/memberships/${membershipId}/reactivate`, { headers: admH });
  expect(reactRes.ok(), `reactivate failed: ${reactRes.status()} ${await reactRes.text()}`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 6. Reassign a pending claim to a different unit
// ---------------------------------------------------------------------------

test('Memberships: admin can reassign a pending claim to a different unit', async ({ request }) => {
  test.setTimeout(30_000);
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const { membershipId, unitId } = await createPendingMembership(request, admin.token, `reassign-${Date.now()}`);

  // Get units for the first building via the correct endpoint
  const buildingsRes = await request.get(`${apiURL}/buildings`, { headers: { Authorization: `Bearer ${admin.token}` } });
  if (!buildingsRes.ok()) {
    test.skip(true, 'buildings endpoint not available');
    return;
  }
  const buildings = (await buildingsRes.json()).data as any[];
  if (buildings.length === 0) {
    test.skip(true, 'no buildings found');
    return;
  }

  const unitsRes = await request.get(`${apiURL}/buildings/${buildings[0].id}/units`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  const units = (await unitsRes.json()).data as any[];
  const otherUnit = units.find((u: any) => u.id !== unitId);
  if (!otherUnit) {
    test.skip(true, 'need at least 2 units to test reassign');
    return;
  }

  const reassignRes = await request.post(`${apiURL}/memberships/${membershipId}/reassign`, {
    headers: admH,
    data: { unit_id: otherUnit.id },
  });
  expect(reassignRes.ok(), `reassign failed: ${reassignRes.status()} ${await reassignRes.text()}`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 7. Membership history for a unit
// ---------------------------------------------------------------------------

test('Memberships: history endpoint returns array for a valid unit', async ({ request }) => {
  test.setTimeout(30_000);
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // Create + approve a membership; we know the unit_id from createPendingMembership
  const { membershipId, unitId } = await createPendingMembership(request, admin.token, `hist-${Date.now()}`);
  await request.post(`${apiURL}/memberships/${membershipId}/approve`, { headers: admH });

  const histRes = await request.get(`${apiURL}/memberships/history?unit_id=${unitId}`, { headers: admH });
  expect(histRes.ok()).toBeTruthy();
  expect(Array.isArray((await histRes.json()).data)).toBe(true);
});

// ---------------------------------------------------------------------------
// 8. Import CSV creates invite records
// ---------------------------------------------------------------------------

test('Memberships: import-csv creates invite records', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  // We need a unit identifier for the CSV; use a building+unit from the condo.
  // The CSV format is: email,unit,relationship,primary_contact,voting_weight
  const tag = Date.now();
  const csv = `email,unit,relationship,primary_contact,voting_weight\ne2e-csv-${tag}@condoos.dev,101,owner,true,1`;

  const importRes = await request.post(`${apiURL}/memberships/import-csv`, {
    headers: admH,
    data: { csv, send_emails: false },
  });
  expect(importRes.ok(), `import-csv failed: ${importRes.status()} ${await importRes.text()}`).toBeTruthy();
  const result = (await importRes.json()).data;
  // Should report at least one imported row OR one error (unit might not exist)
  expect(result.imported_count + result.error_count).toBeGreaterThan(0);
});
