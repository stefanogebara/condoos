// Plugs two gaps from the post-Phase-L audit:
//   1. Cross-tenant isolation — the WHERE condominium_id = ? filter must not leak
//      cross-tenant data and must not be bypassable via request body.
//   2. UI click-paths for the assembly flow — Phase J's API is covered,
//      the board's create-assembly → detail UI was not.
// We only have one admin account on prod, so cross-tenant isolation is tested via
// fabricated-IDs + list-filter assertions rather than a second real tenant.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL || 'http://127.0.0.1:4312/api';

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
  await page.goto('/');
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

  // Pick 50% quorum
  const quorumSelect = page.locator('select').filter({ hasText: /No quorum|25%|50%/ }).first();
  await quorumSelect.selectOption({ label: '50%' });

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

  await page.getByRole('button', { name: /Save voting rules/i }).click();

  // Verify via API that the PATCH landed.
  const detail = await request.get(`${apiURL}/proposals/${target.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await detail.json()).data;
  expect(body.quorum_percent).toBe(50);
  expect(body.voting_opens_at).toBeTruthy();
  expect(body.voting_closes_at).toBeTruthy();
});
