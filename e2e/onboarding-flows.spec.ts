// E2E coverage for the onboarding wizards — first-run experience for new users.
// Both flows need a fresh user with no active membership, so these tests rely on
// /api/auth/dev-register (gated by E2E_REGISTER_SECRET on the server). If the
// secret isn't configured locally, the suite skips so we don't pretend to pass.
//
// Cleanup is handled by server/scripts/cleanup-test-pollution.js, which we
// extended to remove condos starting with "E2E " and users starting with
// "e2e+" so artifacts created here don't accumulate in prod.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');
const E2E_SECRET = process.env.E2E_REGISTER_SECRET || '';

type Session = { token: string; user: any };

async function devRegister(request: APIRequestContext, suffix: string): Promise<Session> {
  const email = `e2e+${suffix}-${Date.now()}@condoos.test`;
  const r = await request.post(`${apiURL}/auth/dev-register`, {
    headers: { 'x-e2e-secret': E2E_SECRET, 'Content-Type': 'application/json' },
    data: { email, password: 'e2etest123', first_name: 'E2E', last_name: suffix },
  });
  expect(r.ok(), `dev-register failed: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data as Session;
}

async function loadSession(page: Page, s: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

test.skip(!E2E_SECRET, 'E2E_REGISTER_SECRET not set — onboarding wizard tests need a fresh-user endpoint');

// ---------------------------------------------------------------------------
// 1b. Create-building API path for a no-unit admin (professional síndico)
// ---------------------------------------------------------------------------

test('Onboarding API: no-unit admin can create a building and access scoped routes', async ({ request }) => {
  const r = await request.post(`${apiURL}/auth/dev-register`, {
    headers: { 'x-e2e-secret': E2E_SECRET, 'Content-Type': 'application/json' },
    data: { email: `e2e+nounit-${Date.now()}@condoos.test`, password: 'e2etest123' },
  });
  expect(r.ok()).toBeTruthy();
  const { token } = (await r.json()).data as { token: string };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Create a condo WITHOUT ownerUnitNumber — this is the professional-síndico path.
  const created = await request.post(`${apiURL}/onboarding/create-building`, {
    headers,
    data: {
      condoName: `E2E NoUnit ${Date.now()}`,
      address: 'Rua Teste 100',
      buildingName: 'Torre',
      floors: 2,
      unitsPerFloor: 2,
      // ownerUnitNumber omitted → no user_unit row
    },
  });
  expect(created.ok(), `create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const out = (await created.json()).data;
  expect(out.condoId).toBeGreaterThan(0);
  expect(out.inviteCode).toMatch(/^[A-Z2-9]{6}$/);

  // The admin should have NO active membership (no user_unit row).
  const me = await request.get(`${apiURL}/onboarding/me`, { headers });
  expect(((await me.json()).data as any[]).length).toBe(0);

  // …but they should still be able to hit a scoped route — requireActiveMembership
  // has a special branch for board_admin with users.condominium_id set.
  const proposals = await request.get(`${apiURL}/proposals`, { headers });
  expect(proposals.ok(), `proposals 403'd a no-unit admin: ${proposals.status()}`).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 1. Create-building wizard — fresh user → 3 steps → invite code shown
// ---------------------------------------------------------------------------

test('Onboarding: create-building wizard renders invite code and dashboard route', async ({ page, request }) => {
  test.setTimeout(45_000);
  const session = await devRegister(request, 'create');
  await loadSession(page, session);

  await page.goto('/onboarding/create');

  // Step 1 — Building name + address
  // Form pre-fills with "Vila Nova Residences" — replace with E2E-tagged name so
  // the cleanup script can find and delete it.
  const condoName = `E2E Condo ${Date.now()}`;
  const nameInput = page.locator('input').nth(0);
  await nameInput.fill(condoName);
  await expect(page.getByRole('heading', { name: /Como o prédio se chama|What's your building called/i })).toBeVisible();
  await page.getByRole('button', { name: /^Continuar$|^Continue$/i }).click();

  // Step 2 — Floors + units + owner unit
  await expect(page.getByRole('heading', { name: /Estrutura e sua unidade|Structure & your unit/i })).toBeVisible();
  await page.locator('input[type="number"]').nth(0).fill('5');
  await page.locator('input[type="number"]').nth(1).fill('3');
  // Owner unit — text input with the example placeholder
  const ownerInput = page.getByPlaceholder(/801|PH-1|Cobertura/);
  await ownerInput.fill('301');
  await page.getByRole('button', { name: /^Continuar$|^Continue$/i }).click();

  // Step 3 — Preferences (defaults are fine) → submit
  await expect(page.getByRole('heading', { name: /Preferências|Preferences/i })).toBeVisible();
  await page.getByRole('button', { name: /Criar prédio|Create building/i }).click();

  // Step 4 — Success card with invite code
  await expect(page.getByRole('heading', { name: /Tudo pronto|You're in/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Código de convite|Invite code/i)).toBeVisible();
  // Invite code is a 6-character A-Z2-9 string in a font-mono div
  const codeEl = page.locator('div.font-mono').filter({ hasText: /^[A-Z2-9]{6}$/ }).first();
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.textContent() || '').trim();
  expect(code, `expected 6-char invite code; got "${code}"`).toMatch(/^[A-Z2-9]{6}$/);

  // Verify via API that the new user is now board_admin of the condo
  const meRes = await request.get(`${apiURL}/onboarding/me`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const memberships = (await meRes.json()).data as any[];
  const active = memberships.find((m) => m.status === 'active' && m.condo_name === condoName);
  expect(active, 'expected active membership in newly-created condo').toBeTruthy();
});

// ---------------------------------------------------------------------------
// 2. Join-building wizard — fresh user → enter code → pick unit → submit
// ---------------------------------------------------------------------------

test('Onboarding: join wizard claims a unit using the demo invite code', async ({ page, request }) => {
  test.setTimeout(45_000);

  // Pull the demo condo's invite code from the seeded board admin so the test
  // doesn't hard-code "DEMO123" (which would silently break if the seed changes).
  const adminLogin = await request.post(`${apiURL}/auth/login`, {
    data: { email: 'admin@condoos.dev', password: 'admin123' },
  });
  expect(adminLogin.ok(), `admin login failed: ${adminLogin.status()}`).toBeTruthy();
  const adminToken = (await adminLogin.json()).data.token;
  const codeRes = await request.get(`${apiURL}/onboarding/my-invite-code`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(codeRes.ok()).toBeTruthy();
  const inviteCode = (await codeRes.json()).data.invite_code as string;
  expect(inviteCode, 'demo condo must expose an invite code').toBeTruthy();

  // Fresh joiner
  const session = await devRegister(request, 'join');
  await loadSession(page, session);

  await page.goto('/onboarding/join');

  // Step 1 — invite code
  await expect(page.getByRole('heading', { name: /Insira o código de convite|Enter your invite code/i })).toBeVisible();
  await page.locator('input').first().fill(inviteCode);
  await page.getByRole('button', { name: /^Continuar$|^Continue$/i }).click();

  // Step 2 — building found → pick a unit + relationship
  await expect(page.getByText(/Prédio encontrado|Building found/i)).toBeVisible({ timeout: 10_000 });
  // Click the first available unit tile (font-mono unit number)
  await page.locator('button:has(div.font-mono)').first().click();
  // Pick "Inquilino" — relationship buttons render label + hint sub-line, so
  // target by the visible hint rather than an exact-name role match.
  await page.locator('button', { hasText: /Alugo a unidade|I rent this unit/ }).first().click();

  // Submit — demo condo has require_approval = true → membership lands in pending
  await page.getByRole('button', { name: /Pedir entrada|Entrar agora|Request to join|Join now/i }).click();

  // Step 3 — request-sent confirmation OR /app redirect (auto-approved)
  // The seeded demo has require_approval = 1, so we expect "Pedido enviado"
  await expect(page.getByRole('heading', { name: /Pedido enviado|Request sent|Tudo pronto|You're in/i })).toBeVisible({ timeout: 15_000 });

  // Verify via API that the membership exists
  const meRes = await request.get(`${apiURL}/onboarding/me`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const memberships = (await meRes.json()).data as any[];
  expect(memberships.length, 'expected at least one membership for the joiner').toBeGreaterThanOrEqual(1);
  const claim = memberships[0];
  expect(['pending', 'active']).toContain(claim.status);
  expect(claim.relationship).toBe('tenant');
});
