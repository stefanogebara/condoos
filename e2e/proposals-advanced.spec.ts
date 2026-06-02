// Proposals advanced: voter eligibility change, compliance (quorum + window),
// validation guards, and locked-once-voting-opens enforcement.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { completeProposalReadiness } from './support/proposals';

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

async function createProposal(request: APIRequestContext, admH: Record<string, string>): Promise<number> {
  const r = await request.post(`${apiURL}/proposals`, {
    headers: admH,
    data: { title: `E2E Proposal ${Date.now()}`, description: 'Proposta para testes avançados com contexto suficiente para validação de prontidão.', estimated_cost: 1000 },
  });
  expect(r.ok(), `create proposal failed: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data.id as number;
}

// ---------------------------------------------------------------------------
// 1. Admin sets voter_eligibility → roundtrips on GET
// ---------------------------------------------------------------------------

test('Proposals: admin can change voter_eligibility to owners_only', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);

  const res = await request.patch(`${apiURL}/proposals/${propId}/eligibility`, {
    headers: admH,
    data: { voter_eligibility: 'owners_only' },
  });
  expect(res.ok(), `eligibility patch failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  expect((await res.json()).data.voter_eligibility).toBe('owners_only');

  // Verify the other valid values also work
  const res2 = await request.patch(`${apiURL}/proposals/${propId}/eligibility`, {
    headers: admH,
    data: { voter_eligibility: 'all' },
  });
  expect(res2.ok()).toBeTruthy();
  expect((await res2.json()).data.voter_eligibility).toBe('all');
});

// ---------------------------------------------------------------------------
// 2. Invalid eligibility value is rejected
// ---------------------------------------------------------------------------

test('Proposals: invalid voter_eligibility is rejected', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);

  const badRes = await request.patch(`${apiURL}/proposals/${propId}/eligibility`, {
    headers: admH,
    data: { voter_eligibility: 'only_me' },
  });
  expect(badRes.status()).toBeGreaterThanOrEqual(400);
  expect((await badRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 3. Resident cannot change eligibility (403)
// ---------------------------------------------------------------------------

test('Proposals: resident gets 403 trying to change eligibility', async ({ request }) => {
  const admin    = await loginApi(request, 'admin@condoos.dev',    'admin123');
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admH     = { Authorization: `Bearer ${admin.token}`,    'Content-Type': 'application/json' };
  const resH     = { Authorization: `Bearer ${resident.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);

  const res = await request.patch(`${apiURL}/proposals/${propId}/eligibility`, {
    headers: resH,
    data: { voter_eligibility: 'all' },
  });
  expect(res.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 4. Admin sets quorum_percent and voting window via PATCH /compliance
// ---------------------------------------------------------------------------

test('Proposals: admin sets compliance (quorum + voting window)', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);
  const opens  = new Date(Date.now() + 1 * 3600 * 1000).toISOString();
  const closes = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const res = await request.patch(`${apiURL}/proposals/${propId}/compliance`, {
    headers: admH,
    data: { quorum_percent: 51, voting_opens_at: opens, voting_closes_at: closes },
  });
  expect(res.ok(), `compliance patch failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const result = (await res.json()).data;
  expect(result.id).toBe(propId);
  expect(result.updated).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 5. Invalid quorum (> 100) is rejected
// ---------------------------------------------------------------------------

test('Proposals: quorum_percent > 100 is rejected', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);

  const badRes = await request.patch(`${apiURL}/proposals/${propId}/compliance`, {
    headers: admH,
    data: { quorum_percent: 150 },
  });
  expect(badRes.status()).toBeGreaterThanOrEqual(400);
  expect((await badRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 6. closes_before_opens is rejected
// ---------------------------------------------------------------------------

test('Proposals: voting closes before opens is rejected', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);
  const opens  = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const closes = new Date(Date.now() + 1 * 3600 * 1000).toISOString(); // closes BEFORE opens

  const badRes = await request.patch(`${apiURL}/proposals/${propId}/compliance`, {
    headers: admH,
    data: { voting_opens_at: opens, voting_closes_at: closes },
  });
  expect(badRes.status()).toBeGreaterThanOrEqual(400);
  expect((await badRes.json()).success).toBe(false);
});

// ---------------------------------------------------------------------------
// 7. Eligibility locked once proposal moves to voting status
// ---------------------------------------------------------------------------

test('Proposals: eligibility is locked once voting opens', async ({ request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const admH  = { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' };

  const propId = await createProposal(request, admH);

  // Advance to voting status
  await completeProposalReadiness(request, apiURL, admH, propId);
  const statusRes = await request.post(`${apiURL}/proposals/${propId}/status`, {
    headers: admH,
    data: { status: 'voting' },
  });
  expect(statusRes.ok(), `status change failed: ${statusRes.status()} ${await statusRes.text()}`).toBeTruthy();

  // Now eligibility PATCH should be rejected
  const lockedRes = await request.patch(`${apiURL}/proposals/${propId}/eligibility`, {
    headers: admH,
    data: { voter_eligibility: 'owners_only' },
  });
  expect(lockedRes.status()).toBeGreaterThanOrEqual(400);
  expect((await lockedRes.json()).success).toBe(false);
});
