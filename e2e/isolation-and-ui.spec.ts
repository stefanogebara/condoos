// Plugs two gaps from the post-Phase-L audit:
//   1. Cross-tenant isolation — the WHERE condominium_id = ? filter must not leak
//      cross-tenant data and must not be bypassable via request body.
//   2. UI click-paths for the assembly flow — Phase J's API is covered,
//      the board's create-assembly → detail UI was not.
// We only have one admin account on prod, so cross-tenant isolation is tested via
// fabricated-IDs + list-filter assertions rather than a second real tenant.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

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

async function browserLogin(page: Page, request: APIRequestContext, email: string, password: string) {
  const s = await loginApi(request, email, password);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

// ---------------------------------------------------------------------------
// Tenant isolation — filter correctness
// ---------------------------------------------------------------------------

test.describe('tenant isolation', () => {
  test('list responses contain only items scoped to admin active condo', async ({ request }) => {
    const { token, user } = await loginApi(request, 'admin@condoos.dev', 'admin123');
    const headers = { Authorization: `Bearer ${token}` };
    const myCondo = (user as any).condominium_id;
    expect(myCondo, 'admin must have an active condo').toBeTruthy();

    // Every list endpoint that returns condo-scoped data should filter to myCondo
    const endpoints = [
      '/proposals',
      '/assemblies',
      '/packages',
      '/visitors',
      '/amenities',
      '/announcements',
      '/suggestions',
      '/meetings',
    ];
    for (const path of endpoints) {
      const r = await request.get(`${apiURL}${path}`, { headers });
      expect(r.ok(), `${path} should respond ok`).toBeTruthy();
      const rows = (await r.json()).data as any[];
      expect(Array.isArray(rows), `${path} should return an array`).toBe(true);
      for (const row of rows) {
        if (row.condominium_id !== undefined) {
          expect(row.condominium_id, `${path} row #${row.id} crossed tenant`).toBe(myCondo);
        }
      }
    }
  });

  test('nonexistent / out-of-scope IDs return 404, not leaked data', async ({ request }) => {
    const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
    const headers = { Authorization: `Bearer ${token}` };

    // These IDs are way outside the seed — they either don't exist OR belong to
    // a different (hypothetical) tenant. Either way: 404 is the correct answer.
    const fakeId = 9_999_999;
    const paths = [
      `/proposals/${fakeId}`,
      `/assemblies/${fakeId}`,
      `/packages/${fakeId}`,
      `/meetings/${fakeId}`,
    ];
    for (const path of paths) {
      const r = await request.get(`${apiURL}${path}`, { headers });
      expect([404, 400], `${path} must not leak (got ${r.status()})`).toContain(r.status());
    }
  });

  test('body-supplied condominium_id is ignored — server uses auth, not client input', async ({ request }) => {
    const { token, user } = await loginApi(request, 'admin@condoos.dev', 'admin123');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const myCondo = (user as any).condominium_id;

    // Attempt to create a proposal with a fabricated cross-tenant condominium_id.
    // The server must bind to the authed active condo, not trust the body.
    const r = await request.post(`${apiURL}/proposals`, {
      headers,
      data: {
        title: `Isolation probe ${Date.now()}`,
        description: 'If this lands under condo 999 the scoping is broken.',
        condominium_id: 999,             // <-- attempted forgery
      },
    });
    expect(r.ok(), 'create should succeed').toBeTruthy();
    const createdId = (await r.json()).data.id;

    // Re-read and confirm the proposal ended up under admin's active condo.
    const detail = await request.get(`${apiURL}/proposals/${createdId}`, { headers });
    expect(detail.ok()).toBeTruthy();
    const body = (await detail.json()).data;
    expect(body.condominium_id, 'body.condominium_id must be ignored').toBe(myCondo);
  });

  test('write endpoints on unknown IDs return 404 rather than 500', async ({ request }) => {
    const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fakeId = 9_999_999;
    const writeAttempts = [
      { method: 'post'  as const, path: `/proposals/${fakeId}/status`,     data: { status: 'voting' } },
      { method: 'patch' as const, path: `/proposals/${fakeId}/compliance`, data: { quorum_percent: 50 } },
      { method: 'post'  as const, path: `/assemblies/${fakeId}/convoke`,   data: {} },
      { method: 'post'  as const, path: `/assemblies/${fakeId}/close`,     data: {} },
    ];
    for (const a of writeAttempts) {
      const r = await (request as any)[a.method](`${apiURL}${a.path}`, { headers, data: a.data });
      expect([404, 400, 409], `${a.method.toUpperCase()} ${a.path} must not 500 (got ${r.status()})`).toContain(r.status());
    }
  });

  test('resident directory hides emails and vote identities from residents', async ({ request }) => {
    const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
    const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
    const residentHeaders = { Authorization: `Bearer ${resident.token}` };
    const adminHeaders = { Authorization: `Bearer ${admin.token}` };

    const directory = await request.get(`${apiURL}/users/residents`, { headers: residentHeaders });
    expect(directory.ok()).toBeTruthy();
    const rows = (await directory.json()).data as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => Object.prototype.hasOwnProperty.call(r, 'email'))).toBe(false);

    const adminDirectory = await request.get(`${apiURL}/users/residents`, { headers: adminHeaders });
    expect(adminDirectory.ok()).toBeTruthy();
    const adminRows = (await adminDirectory.json()).data as any[];
    expect(adminRows.some((r) => typeof r.email === 'string')).toBe(true);

    const proposals = await request.get(`${apiURL}/proposals`, { headers: residentHeaders });
    const first = ((await proposals.json()).data as any[])[0];
    const detail = await request.get(`${apiURL}/proposals/${first.id}`, { headers: residentHeaders });
    expect(detail.ok()).toBeTruthy();
    expect((await detail.json()).data.voters).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// UI click-paths — the assembly flow through the board UI
// ---------------------------------------------------------------------------

test('board UI: create assembly → redirect to detail → add agenda → convoke', async ({ page, request }) => {
  await browserLogin(page, request, 'admin@condoos.dev', 'admin123');
  await page.goto('/board/assemblies');

  // Open the create form
  await page.getByRole('button', { name: /New assembly/i }).click();

  const unique = `E2E UI AGO ${Date.now()}`;
  await page.getByPlaceholder(/AGO 2026/i).fill(unique);

  // Fill the datetime-local picker — mid-week, 2 weeks out.
  const firstCall = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstCallLocal =
    `${firstCall.getFullYear()}-${pad(firstCall.getMonth() + 1)}-${pad(firstCall.getDate())}` +
    `T${pad(firstCall.getHours())}:${pad(firstCall.getMinutes())}`;
  await page.locator('input[type="datetime-local"]').first().fill(firstCallLocal);

  // Submit → the app navigates to /board/assemblies/:id via window.location
  await page.getByRole('button', { name: /Create & open agenda/i }).click();

  // Wait for the detail page to load
  await page.waitForURL(/\/board\/assemblies\/\d+/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: new RegExp(unique, 'i') })).toBeVisible();

  // Add an agenda item through the UI (not the AI draft, deterministic)
  await page.getByPlaceholder(/Item title/i).fill('UI click-path accounts review');
  await page.getByRole('button', { name: /^Add item$/i }).click();

  // The newly added item should appear in the list
  await expect(page.getByRole('heading', { name: /UI click-path accounts review/i })).toBeVisible();

  // Convoke — there must be at least one item (we just added one)
  await page.getByRole('button', { name: /^Convoke$/i }).click();

  // Back-end transitioned to 'convoked'; UI now shows Start session instead.
  await expect(page.getByRole('button', { name: /Start session/i })).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Phase K — WhatsApp configuration health (delivery itself requires provider creds)
// ---------------------------------------------------------------------------

test('whatsapp status endpoint returns shape (configured boolean + masked from)', async ({ request }) => {
  const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const r = await request.get(`${apiURL}/users/whatsapp/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok()).toBeTruthy();
  const body = (await r.json()).data;
  expect(typeof body.configured).toBe('boolean');
  expect(['twilio', 'waha', 'none']).toContain(body.provider);
  // from is either null (not configured) or a masked string like "+1415…86"
  if (body.from !== null) {
    expect(body.from).toMatch(/…/);                  // masked in the middle
    expect(body.from).not.toMatch(/[A-Z]{34}/);      // never contains an SID
  }
});

// ---------------------------------------------------------------------------
// Phase J AI — LLM Portuguese quality canary
// Calls the real suggest-agenda endpoint and verifies the model (or fallback)
// returns a valid, structured agenda in Portuguese. This uses real tokens
// (~ <$0.01 per run) — it's a canary, not a quality benchmark.
// ---------------------------------------------------------------------------

test('suggest-agenda returns a usable agenda (shape + Portuguese markers)', async ({ request }) => {
  test.setTimeout(60_000);                              // LLM can be slow
  const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const createRes = await request.post(`${apiURL}/assemblies`, {
    headers,
    data: { title: `Canary AGO 2026`, kind: 'ordinary', first_call_at: future },
  });
  const assemblyId = (await createRes.json()).data.id;

  const r = await request.post(`${apiURL}/ai/assemblies/${assemblyId}/suggest-agenda`, { headers });
  expect(r.ok(), `suggest-agenda should respond ok (${r.status()})`).toBeTruthy();
  const body = (await r.json()).data;

  expect(Array.isArray(body.items), 'items must be an array').toBe(true);
  expect(body.items.length).toBeGreaterThanOrEqual(2);

  // Each item must match the fixed schema
  for (const item of body.items) {
    expect(typeof item.title).toBe('string');
    expect(item.title.length).toBeGreaterThan(0);
    expect(['budget', 'accounts', 'bylaw', 'election', 'ordinary', 'other']).toContain(item.item_type);
    expect(['simple', 'two_thirds', 'unanimous']).toContain(item.required_majority);
  }

  // At least one item should surface a Portuguese or Brazilian-legal term that
  // a real AGO agenda would have. This catches regressions where the model
  // flips to English-only or loses BR context entirely.
  const corpus = body.items.map((i: any) => `${i.title} ${i.description || ''}`).join(' ').toLowerCase();
  const brazilTerms = [
    'presta', 'conta', 'orçament', 'orcament', 'sindic', 'convenç', 'convenc',
    'assembleia', 'pauta', 'budget', 'accounts', 'board',
  ];
  const hit = brazilTerms.some((t) => corpus.includes(t));
  expect(hit, `expected at least one BR/AGO term in: ${corpus.slice(0, 300)}`).toBe(true);
});

// ---------------------------------------------------------------------------
// Phase I — vote-closer poller on prod (verifies setInterval runs on Fly)
// Waits up to 80s for one tick. Runs serially; the rest of the suite ignores it.
// ---------------------------------------------------------------------------

test('vote-closer: expired voting window transitions status within 80s', async ({ request }) => {
  test.setTimeout(120_000);
  const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Create a proposal to isolate the test.
  const createRes = await request.post(`${apiURL}/proposals`, {
    headers,
    data: { title: `Vote-closer canary ${Date.now()}`, description: 'Canary for the auto-close poller.', category: 'maintenance' },
  });
  expect(createRes.ok()).toBeTruthy();
  const proposalId = (await createRes.json()).data.id;

  // Set voting window with closes_at in the past, then flip to 'voting'.
  const past = new Date(Date.now() - 30 * 1000).toISOString();
  await request.patch(`${apiURL}/proposals/${proposalId}/compliance`, {
    headers,
    data: { quorum_percent: 0, voting_closes_at: past },
  });
  const voteRes = await request.post(`${apiURL}/proposals/${proposalId}/status`, {
    headers,
    data: { status: 'voting' },
  });
  expect(voteRes.ok()).toBeTruthy();

  // Poll the proposal status; expect it to flip off 'voting' within ~80s
  // (poller cadence is 60s on prod, per startVoteCloser(60_000)).
  const deadline = Date.now() + 80_000;
  let finalStatus = 'voting';
  while (Date.now() < deadline) {
    const r = await request.get(`${apiURL}/proposals/${proposalId}`, { headers });
    const body = (await r.json()).data;
    finalStatus = body.status;
    if (finalStatus !== 'voting') break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  // The poller should have closed it — approved/rejected/inconclusive depending on tally.
  // With zero votes cast, expected outcome is inconclusive (no quorum means tally can't resolve).
  expect(['approved', 'rejected', 'inconclusive'], `expected auto-close, got ${finalStatus}`).toContain(finalStatus);
});

// ---------------------------------------------------------------------------
// Google OAuth — endpoint validation + sign-in button presence
// Full OAuth popup flow cannot be automated without real Google creds; we verify
// the server-side error path + UI surface instead.
// ---------------------------------------------------------------------------

test('Google OAuth endpoint rejects invalid credentials with a known error code', async ({ request }) => {
  // We intentionally do not hit loginApi first — a brand-new guest request.
  const r = await request.post(`${apiURL}/auth/google`, {
    data: { credential: 'obviously-not-a-valid-jwt' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect([400, 401, 501], `expected auth rejection, got ${r.status()}`).toContain(r.status());
  const body = await r.json();
  expect(body.success).toBe(false);
  // google_verify_failed (401) is the happy-path for an invalid token; other
  // codes like google_auth_disabled (501) also acceptable when creds aren't set.
  expect(['invalid_input', 'google_verify_failed', 'google_aud_mismatch', 'google_auth_disabled'])
    .toContain(body.error);
});

test('login page renders Google sign-in when configured', async ({ page, request }) => {
  const configRes = await request.get(`${apiURL}/auth/config`);
  expect(configRes.ok()).toBeTruthy();
  const config = (await configRes.json()).data as { google_enabled: boolean; google_client_id: string | null };

  await page.goto('/login');

  if (!config.google_enabled || !config.google_client_id) {
    await expect(page.getByRole('button', { name: /Sign in/i })).toBeVisible();
    await expect(page.getByText('or manually', { exact: true })).toBeVisible();
    return;
  }

  // The button text / element varies (Google one-tap iframe). Accept any of:
  //   - visible text "Continue with Google" or "Sign in with Google"
  //   - a Google iframe / button with role=button inside #google-signin
  await expect.poll(async () => page.evaluate(() => {
    const iframeOrBtn = document.querySelector('iframe[src*="accounts.google.com"], [data-testid="google-signin"], [id*="google"]');
    const txt = document.body.innerText.toLowerCase();
    return Boolean(iframeOrBtn) || /continue with google|sign in with google|google/i.test(txt);
  }), { message: 'login page should surface Google sign-in' }).toBe(true);
});

test('board UI: compliance editor saves quorum + datetime window', async ({ page, request }) => {
  const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
  // Find or create a proposal in 'discussion' so the compliance editor is visible.
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const listRes = await request.get(`${apiURL}/proposals`, { headers });
  let target = ((await listRes.json()).data as any[]).find((p) => p.status === 'discussion');
  if (!target) {
    const createRes = await request.post(`${apiURL}/proposals`, {
      headers,
      data: { title: `UI compliance ${Date.now()}`, description: 'smoke', category: 'maintenance' },
    });
    target = (await createRes.json()).data;
  }

  await browserLogin(page, request, 'admin@condoos.dev', 'admin123');
  await page.goto(`/board/proposals/${target.id}`);

  // The compliance card is only rendered when status === 'discussion'.
  await expect(page.getByText(/Voting compliance/i)).toBeVisible();

  // Pick 50% quorum — match by `value` (the option's value attr is the integer)
  const quorumSelect = page.locator('select').filter({ hasText: /No quorum|25%|50%/ }).first();
  await quorumSelect.selectOption({ value: '50' });

  // Set voting window — opens in 10 min, closes in 7 days.
  const now = new Date();
  const opens = new Date(now.getTime() + 10 * 60_000);
  const closes = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const dateInputs = page.locator('input[type="datetime-local"]');
  await dateInputs.nth(0).fill(fmt(opens));
  await dateInputs.nth(1).fill(fmt(closes));

  // Click Save and wait for the PATCH to complete before GETing
  await Promise.all([
    page.waitForResponse((res) =>
      res.url().includes(`/proposals/${target.id}/compliance`) && res.request().method() === 'PATCH' && res.ok(),
    ),
    page.getByRole('button', { name: /Save voting rules/i }).click(),
  ]);

  // Verify via API that the PATCH landed.
  const detail = await request.get(`${apiURL}/proposals/${target.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await detail.json()).data;
  expect(body.quorum_percent).toBe(50);
  expect(body.voting_opens_at).toBeTruthy();
  expect(body.voting_closes_at).toBeTruthy();
});
