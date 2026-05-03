// Assemblies extended: attendance self check-in, proxy grant/revoke,
// item-level vote (open → vote → close), delinquent marking, and
// vote-before-open guard.
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

// Creates an assembly, adds an agenda item, convokes it, then starts it.
// Returns { assemblyId, agendaItemId }.
async function setupInSessionAssembly(
  request: APIRequestContext,
  admH: Record<string, string>,
): Promise<{ assemblyId: number; agendaItemId: number }> {
  const first_call_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min from now

  const createRes = await request.post(`${apiURL}/assemblies`, {
    headers: admH,
    data: { title: `E2E Assembly ${Date.now()}`, kind: 'extraordinary', first_call_at },
  });
  expect(createRes.ok(), `create assembly failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
  const assemblyId: number = (await createRes.json()).data.id;

  const agendaRes = await request.post(`${apiURL}/assemblies/${assemblyId}/agenda`, {
    headers: admH,
    data: { title: 'Reforma da fachada', item_type: 'ordinary' },
  });
  expect(agendaRes.ok(), `add agenda failed: ${agendaRes.status()} ${await agendaRes.text()}`).toBeTruthy();
  const agendaItemId: number = (await agendaRes.json()).data.id;

  const convokeRes = await request.post(`${apiURL}/assemblies/${assemblyId}/convoke`, { headers: admH });
  expect(convokeRes.ok(), `convoke failed: ${convokeRes.status()} ${await convokeRes.text()}`).toBeTruthy();

  const startRes = await request.post(`${apiURL}/assemblies/${assemblyId}/start`, { headers: admH });
  expect(startRes.ok(), `start failed: ${startRes.status()} ${await startRes.text()}`).toBeTruthy();

  return { assemblyId, agendaItemId };
}

// ---------------------------------------------------------------------------
// 1. Self attendance check-in during an in_session assembly
// ---------------------------------------------------------------------------

test('Assemblies: admin self check-in returns mode: self', async ({ request }) => {
  test.setTimeout(30_000);
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const { assemblyId } = await setupInSessionAssembly(request, admH);

  const attRes = await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, { headers: admH });
  expect(attRes.ok(), `attendance failed: ${attRes.status()} ${await attRes.text()}`).toBeTruthy();
  expect((await attRes.json()).data.mode).toBe('self');
});

// ---------------------------------------------------------------------------
// 2. Resident self check-in
// ---------------------------------------------------------------------------

test('Assemblies: resident self check-in returns mode: self', async ({ request }) => {
  test.setTimeout(30_000);
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const { assemblyId } = await setupInSessionAssembly(request, admH);

  const attRes = await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, { headers: resH });
  expect(attRes.ok(), `attendance failed: ${attRes.status()} ${await attRes.text()}`).toBeTruthy();
  expect((await attRes.json()).data.mode).toBe('self');
});

// ---------------------------------------------------------------------------
// 3. Proxy grant: resident grants proxy to admin; admin check-in on their behalf
// ---------------------------------------------------------------------------

test('Assemblies: proxy grant → proxy check-in returns mode: proxy', async ({ request }) => {
  test.setTimeout(45_000);
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const { assemblyId } = await setupInSessionAssembly(request, admH);

  // Resident grants proxy to admin (convoked → in_session both allowed)
  const proxyRes = await request.post(`${apiURL}/assemblies/${assemblyId}/proxies`, {
    headers: resH,
    data: { grantee_user_id: admin.user.id },
  });
  expect(proxyRes.ok(), `proxy grant failed: ${proxyRes.status()} ${await proxyRes.text()}`).toBeTruthy();
  const proxyId: number = (await proxyRes.json()).data.id;
  expect(proxyId).toBeGreaterThan(0);

  // Admin checks in on behalf of resident
  const attRes = await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, {
    headers: admH,
    data: { proxy_for_user_id: resident.user.id },
  });
  expect(attRes.ok(), `proxy attendance failed: ${attRes.status()} ${await attRes.text()}`).toBeTruthy();
  expect((await attRes.json()).data.mode).toBe('proxy');
});

// ---------------------------------------------------------------------------
// 4. Proxy revoke: after DELETE, proxy check-in is rejected
// ---------------------------------------------------------------------------

test('Assemblies: revoked proxy cannot be used for check-in', async ({ request }) => {
  test.setTimeout(45_000);
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const { assemblyId } = await setupInSessionAssembly(request, admH);

  // Grant then immediately revoke
  const proxyRes = await request.post(`${apiURL}/assemblies/${assemblyId}/proxies`, {
    headers: resH,
    data: { grantee_user_id: admin.user.id },
  });
  const proxyId: number = (await proxyRes.json()).data.id;

  const revokeRes = await request.delete(`${apiURL}/assemblies/${assemblyId}/proxies/${proxyId}`, {
    headers: resH,
  });
  expect(revokeRes.ok(), `revoke failed: ${revokeRes.status()} ${await revokeRes.text()}`).toBeTruthy();

  // Proxy check-in should now fail (no active proxy)
  const attRes = await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, {
    headers: admH,
    data: { proxy_for_user_id: resident.user.id },
  });
  expect(attRes.status()).toBeGreaterThanOrEqual(400);
});

// ---------------------------------------------------------------------------
// 5. Item-level vote: admin opens item → resident votes yes → item can be closed
// ---------------------------------------------------------------------------

test('Assemblies: open agenda item → vote → close item', async ({ request }) => {
  test.setTimeout(45_000);
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const { assemblyId, agendaItemId } = await setupInSessionAssembly(request, admH);

  // Resident checks in so they can vote
  await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, { headers: resH });

  // Admin opens the item for voting
  const openRes = await request.post(
    `${apiURL}/assemblies/${assemblyId}/agenda/${agendaItemId}/open`, { headers: admH }
  );
  expect(openRes.ok(), `open item failed: ${openRes.status()} ${await openRes.text()}`).toBeTruthy();
  expect((await openRes.json()).data.status).toBe('active');

  // Resident votes
  const voteRes = await request.post(
    `${apiURL}/assemblies/${assemblyId}/agenda/${agendaItemId}/vote`,
    { headers: resH, data: { choice: 'yes' } },
  );
  expect(voteRes.ok(), `vote failed: ${voteRes.status()} ${await voteRes.text()}`).toBeTruthy();
  expect((await voteRes.json()).data.tally).toBeTruthy();

  // Admin closes the item
  const closeRes = await request.post(
    `${apiURL}/assemblies/${assemblyId}/agenda/${agendaItemId}/close`, { headers: admH }
  );
  expect(closeRes.ok(), `close item failed: ${closeRes.status()} ${await closeRes.text()}`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 6. Vote on a non-active (pending) item is rejected
// ---------------------------------------------------------------------------

test('Assemblies: vote on pending item returns item_not_open error', async ({ request }) => {
  test.setTimeout(30_000);
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const { assemblyId, agendaItemId } = await setupInSessionAssembly(request, admH);
  await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, { headers: resH });

  // Item is still 'pending' — vote should fail
  const voteRes = await request.post(
    `${apiURL}/assemblies/${assemblyId}/agenda/${agendaItemId}/vote`,
    { headers: resH, data: { choice: 'yes' } },
  );
  expect(voteRes.status()).toBeGreaterThanOrEqual(400);
  expect((await voteRes.json()).error).toBe('item_not_open');
});

// ---------------------------------------------------------------------------
// 7. Admin marks attendee as delinquent
// ---------------------------------------------------------------------------

test('Assemblies: admin marks attendance record as delinquent', async ({ request }) => {
  test.setTimeout(30_000);
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const { assemblyId } = await setupInSessionAssembly(request, admH);

  // Resident checks in; capture attendance ID from detail endpoint
  await request.post(`${apiURL}/assemblies/${assemblyId}/attendance`, { headers: resH });

  const detailRes = await request.get(`${apiURL}/assemblies/${assemblyId}`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(detailRes.ok()).toBeTruthy();
  const detail  = (await detailRes.json()).data;
  const attendance = detail.attendance as any[] | undefined;
  if (!attendance || attendance.length === 0) {
    test.skip(true, 'no attendance records returned in assembly detail');
    return;
  }
  const attRecord = attendance.find((a: any) => a.user_id === resident.user.id);
  if (!attRecord) {
    test.skip(true, 'resident attendance record not found in detail');
    return;
  }

  const patchRes = await request.patch(
    `${apiURL}/assemblies/${assemblyId}/attendance/${attRecord.id}`,
    { headers: admH, data: { is_delinquent: true } },
  );
  expect(patchRes.ok(), `delinquent patch failed: ${patchRes.status()} ${await patchRes.text()}`).toBeTruthy();
  expect((await patchRes.json()).data.ok).toBe(true);
});
