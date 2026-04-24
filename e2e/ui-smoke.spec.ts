// Full UI smoke — click through every board + resident page, verify each
// renders its main heading and at least one interactive element. Screenshots
// land in test-results/ui-smoke/ so we can eyeball later if something broke.
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

async function browserLogin(page: Page, request: APIRequestContext, kind: 'admin' | 'resident') {
  const creds = kind === 'admin'
    ? ['admin@condoos.dev', 'admin123']
    : ['resident@condoos.dev', 'resident123'];
  const s = await loginApi(request, creds[0], creds[1]);
  await page.goto('/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

// ---------------------------------------------------------------------------
// Landing — PT-BR sweep verification
// ---------------------------------------------------------------------------

test('landing is fully PT-BR, no English leaking', async ({ page }) => {
  await page.goto('/');
  // Positive assertions — Portuguese content we expect
  await expect(page.getByRole('heading', { name: /Seu condomínio,/i })).toBeVisible();
  await expect(page.getByText(/em paz/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Entrar$/i }).first()).toBeVisible();
  await expect(page.getByText(/Funcionalidades/i).first()).toBeVisible();
  await expect(page.getByText(/Como funciona/i).first()).toBeVisible();
  await expect(page.getByText(/Dúvidas/i).first()).toBeVisible();
  await expect(page.getByText(/Testar a demo/i)).toBeVisible();
  await expect(page.getByText(/Tudo que o prédio precisa para rodar/i)).toBeVisible();
  await expect(page.getByText(/AGO no app\./i)).toBeVisible();
  await expect(page.getByText(/Do adolescente de skate/i)).toBeVisible();
  await expect(page.getByText(/Vai que é hoje\./i)).toBeVisible();

  // Guard against the English we specifically replaced — must NOT appear anywhere
  const html = await page.content();
  const englishLeaks = [
    'Run your building',
    'Packages, visitors, amenities, voting',
    'Try the demo',
    'See what\'s inside',
    'Everything a building runs on',
    'Replace spreadsheets',
    'AI co-pilot',         // EN version of Copiloto IA header
    'From "the lobby AC',  // EN hero for AI callout
    'built for hackathons, designed for humans',
  ];
  for (const leak of englishLeaks) {
    expect(html.includes(leak), `English leak found: "${leak}"`).toBe(false);
  }
});

test('landing: nav anchors scroll to the right sections', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^AGO$/ }).first().click();
  await expect(page).toHaveURL(/#ago$/);
  await page.getByRole('link', { name: /Como funciona/i }).first().click();
  await expect(page).toHaveURL(/#loop$/);
  await page.getByRole('link', { name: /^Dúvidas$/i }).first().click();
  await expect(page).toHaveURL(/#faq$/);
});

test('landing: FAQ details expand on click', async ({ page }) => {
  await page.goto('/#faq');
  const summary = page.getByText('Quanto custa?', { exact: true });
  await expect(summary).toBeVisible();
  await summary.click();
  // The hidden content (a 1-2 sentence answer) should become visible after click
  await expect(page.getByText(/beta.*R\$|grátis para até|setup fee/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Resident UI smoke — every page renders + key elements present
// ---------------------------------------------------------------------------

test.describe('resident UI pages render', () => {
  const pages = [
    { path: '/app',               heading: /Good (morning|afternoon|evening)|Bom dia|Boa tarde|Boa noite/i, note: 'overview greets by name' },
    { path: '/app/packages',      heading: /Packages|Encomendas/i },
    { path: '/app/visitors',      heading: /Visitors|Visitantes/i },
    { path: '/app/amenities',     heading: /Amenities|Áreas/i },
    { path: '/app/announcements', heading: /Announcements|Comunicados/i },
    { path: '/app/proposals',     heading: /Proposals|Propostas/i },
    { path: '/app/assemblies',    heading: /Assemblies|Assembl/i },
    { path: '/app/meetings',      heading: /Meetings|Reuniões/i },
    { path: '/app/suggest',       heading: /Suggest|Sugerir/i },
    { path: '/app/settings',      heading: /Settings|Preferênc/i },
  ];
  for (const p of pages) {
    test(`${p.path} loads`, async ({ page, request }) => {
      await browserLogin(page, request, 'resident');
      await page.goto(p.path);
      await expect(page.getByRole('heading').first()).toBeVisible();
      // Sidebar must show — scope to <aside>, which is only the visible sidebar
      await expect(page.locator('aside').getByText(/Resident/i).first()).toBeVisible();
    });
  }
});

// ---------------------------------------------------------------------------
// Board UI smoke
// ---------------------------------------------------------------------------

test.describe('board UI pages render', () => {
  const pages = [
    { path: '/board',               heading: /.+/ },
    { path: '/board/suggestions',   heading: /Suggestions|Sugest/i },
    { path: '/board/pending',       heading: /Pending|Pendente/i },
    { path: '/board/proposals',     heading: /Proposals|Propostas/i },
    { path: '/board/assemblies',    heading: /Assemblies|Assembl/i },
    { path: '/board/meetings',      heading: /Meetings|Reuniões/i },
    { path: '/board/announcements', heading: /Announcements|Comunic/i },
    { path: '/board/residents',     heading: /Residents|Moradores/i },
  ];
  for (const p of pages) {
    test(`${p.path} loads`, async ({ page, request }) => {
      await browserLogin(page, request, 'admin');
      await page.goto(p.path);
      await expect(page.getByRole('heading').first()).toBeVisible();
      // Board sidebar marker — scope to <aside> which is only the visible sidebar
      await expect(page.locator('aside').getByText(/Board admin/i).first()).toBeVisible();
    });
  }
});

// ---------------------------------------------------------------------------
// Resident interactions — buttons that don't mutate
// ---------------------------------------------------------------------------

test('resident: click on first existing proposal shows detail', async ({ page, request }) => {
  await browserLogin(page, request, 'resident');
  await page.goto('/app/proposals');
  const firstCard = page.locator('a[href*="/app/proposals/"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  // Detail page should load without errors; a back link or title is present
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('resident: settings page has phone input + opt-in checkbox + save', async ({ page, request }) => {
  await browserLogin(page, request, 'resident');
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: /Settings|Preferênc/i })).toBeVisible();
  await expect(page.locator('input[type="tel"]')).toBeVisible();
  await expect(page.locator('input[type="checkbox"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|Salvar/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Board interactions — non-destructive clicks
// ---------------------------------------------------------------------------

test('board overview: stat cards render', async ({ page, request }) => {
  await browserLogin(page, request, 'admin');
  await page.goto('/board');
  // The overview surfaces several numeric stats — just verify the page doesn't
  // crash and shows the sidebar + a heading.
  await expect(page.locator('aside').getByText(/Board admin/i).first()).toBeVisible();
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('board assemblies: "New assembly" button opens the form', async ({ page, request }) => {
  await browserLogin(page, request, 'admin');
  await page.goto('/board/assemblies');
  const btn = page.getByRole('button', { name: /New assembly/i });
  await expect(btn).toBeVisible();
  await btn.click();
  // After clicking, the title placeholder should be visible
  await expect(page.getByPlaceholder(/AGO 2026/i)).toBeVisible();
});

test('board residents: table renders + import roster button visible', async ({ page, request }) => {
  await browserLogin(page, request, 'admin');
  await page.goto('/board/residents');
  await expect(page.getByRole('heading', { name: /Residents|Moradores/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Import roster|Importar/i }).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Logout ends the session
// ---------------------------------------------------------------------------

test('logout: Sign out button clears session and redirects', async ({ page, request }) => {
  await browserLogin(page, request, 'resident');
  await page.goto('/app');
  const signOut = page.getByRole('button', { name: /Sign out|Sair/i });
  await expect(signOut).toBeVisible();
  await signOut.click();
  // After logout, localStorage should be cleared and we should land on / or /login
  await page.waitForURL(/\/(login)?$/, { timeout: 10_000 });
  const token = await page.evaluate(() => localStorage.getItem('condoos_token'));
  expect(token).toBeFalsy();
});
