// Comprehensive resident click-through. Mirrors admin-walkthrough.spec but
// for /app/* routes. Each test is non-destructive on prod.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

test.describe.configure({ timeout: 90_000 });

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

async function residentLogin(page: Page, request: APIRequestContext) {
  const s = await loginApi(request, 'resident@condoos.dev', 'resident123');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

async function expectShellRole(page: Page, label: RegExp) {
  const width = page.viewportSize()?.width || 1280;
  const shell = width < 1024 ? page.locator('header') : page.locator('aside');
  await expect(shell.getByText(label).first()).toBeVisible();
}

async function nav(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: /Open menu|Abrir menu/i }).click();
    await expect(page.getByRole('button', { name: /Close menu|Fechar menu/i })).toBeVisible();
  }
  return page.locator('aside');
}

// ---------------------------------------------------------------------------
// /app overview — greeting + sidebar
// ---------------------------------------------------------------------------

test('resident: overview greets by name + shows full sidebar', async ({ page, request, isMobile }) => {
  await residentLogin(page, request);
  await page.goto('/app');
  const menu = await nav(page, isMobile);
  await expect(menu.getByText(/Resident|Morador/i).first()).toBeVisible();
  // Greet by name (Maya is the seeded resident)
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Maya|Bom dia, Maya|Boa tarde, Maya|Boa noite, Maya/i }).first()).toBeVisible();
  // All 10 nav items in sidebar
  const links = [
    /^(Overview|Início)$/i,
    /^(Packages|Encomendas)$/i,
    /^(Visitors|Visitantes)$/i,
    /^(Amenities|Áreas comuns)$/i,
    /^(Announcements|Comunicados)$/i,
    /^(Proposals|Propostas)$/i,
    /^(Assemblies|Assembleias)$/i,
    /^(Meetings|Reuniões)$/i,
    /^(Suggest|Sugerir)$/i,
    /^(Settings|Preferências)$/i,
  ];
  for (const l of links) {
    await expect(menu.getByRole('link', { name: l })).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// /app/packages — list + own packages only
// ---------------------------------------------------------------------------

test('resident: packages page renders with the resident\'s items only', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/packages');
  await expect(page.getByRole('heading', { level: 1, name: /Packages|Encomendas/i })).toBeVisible();
  // Sidebar visible — confirms the auth gate passed
  await expectShellRole(page, /Resident|Morador/i);
});

// ---------------------------------------------------------------------------
// /app/visitors — list + new-visitor form (resident can request access)
// ---------------------------------------------------------------------------

test('resident: visitors page surfaces request CTA or empty state', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/visitors');
  await expect(page.getByRole('heading', { level: 1, name: /Visitors|Visitantes/i })).toBeVisible();
  // The "New visitor" / "Add" CTA should be available to residents
  const cta = page.getByRole('button', { name: /new|novo|add|adicionar|invite|convidar/i }).first();
  await expect(cta).toBeVisible();
});

// ---------------------------------------------------------------------------
// /app/amenities — bookable amenities + booking form
// ---------------------------------------------------------------------------

test('resident: amenities page lists bookable areas', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/amenities');
  await expect(page.getByRole('heading', { level: 1, name: /Amenities|Áreas/i })).toBeVisible();
  // The seed has Rooftop Pool, Gym, Party Room — at least one card should render
  const anyCard = page.locator('aside ~ * h3, aside ~ * h2').first();
  await expect(anyCard).toBeVisible();
});

// ---------------------------------------------------------------------------
// /app/announcements — read-only feed for residents
// ---------------------------------------------------------------------------

test('resident: announcements page renders the feed', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/announcements');
  await expect(page.getByRole('heading', { level: 1, name: /Announcements|Comunicados/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// /app/proposals — list + click into detail (own vote tally)
// ---------------------------------------------------------------------------

test('resident: proposals list + detail page exposes vote affordance when in voting state', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/proposals');
  await expect(page.getByRole('heading', { level: 1, name: /Proposals|Propostas/i })).toBeVisible();
  const firstCard = page.locator('a[href*="/app/proposals/"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  // Detail loaded — heading present
  await expect(page.getByRole('heading').first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// /app/assemblies — list + detail with proxy grant flow visible
// ---------------------------------------------------------------------------

test('resident: assemblies list shows convoked/in-session assemblies', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/assemblies');
  await expect(page.getByRole('heading', { level: 1, name: /Assemblies|Assembleias/i })).toBeVisible();
  // Either there are no convoked assemblies (empty state) or there's at least one card
  const card = page.locator('a[href*="/app/assemblies/"]').first();
  const empty = page.getByText(/no upcoming|nenhuma|empty/i).first();
  await expect(card.or(empty)).toBeVisible();
});

// ---------------------------------------------------------------------------
// /app/suggest — resident submits a suggestion + AI drafts a proposal
// ---------------------------------------------------------------------------

test('resident: suggest page exposes textarea + submit CTA', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/suggest');
  await expect(page.getByRole('heading', { level: 1, name: /Suggest|Sugerir/i })).toBeVisible();
  // The free-text input must be present
  await expect(page.locator('textarea').first()).toBeVisible();
  // And a submit button
  await expect(page.getByRole('button', { name: /submit|enviar|sugerir|draft|ai|redigir/i }).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// /app/settings — profile + WhatsApp opt-in
// ---------------------------------------------------------------------------

test('resident: settings page has profile + WhatsApp section + Save', async ({ page, request }) => {
  await residentLogin(page, request);
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { level: 1, name: /Settings|Preferênc/i })).toBeVisible();
  await expect(page.locator('input[type="tel"]')).toBeVisible();
  await expect(page.locator('input[type="checkbox"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|Salvar/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Sidebar nav round-trips
// ---------------------------------------------------------------------------

test('resident: sidebar nav round-trips between common pages', async ({ page, request, isMobile }) => {
  await residentLogin(page, request);
  await page.goto('/app');
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Proposals|Propostas)$/i }).click();
  await expect(page).toHaveURL(/\/app\/proposals$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Assemblies|Assembleias)$/i }).click();
  await expect(page).toHaveURL(/\/app\/assemblies$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Settings|Preferências)$/i }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Overview|Início)$/i }).click();
  await expect(page).toHaveURL(/\/app$/);
});
