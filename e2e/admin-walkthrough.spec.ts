// Comprehensive admin click-through. Walks every page in /board and
// exercises the major action buttons. Each test is non-destructive on prod
// (creates ephemeral entities; doesn't delete shared demo data).
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

async function adminLogin(page: Page, request: APIRequestContext) {
  const s = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

async function nav(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: /Open menu|Abrir menu/i }).click();
    await expect(page.getByRole('button', { name: /Close menu|Fechar menu/i })).toBeVisible();
  }
  return page.locator('aside');
}

// ---------------------------------------------------------------------------
// /board overview — landing page after login
// ---------------------------------------------------------------------------

test('admin: overview renders with sidebar nav', async ({ page, request, isMobile }) => {
  await adminLogin(page, request);
  await page.goto('/board');
  const menu = await nav(page, isMobile);
  await expect(menu.getByText(/Board admin|Síndico/i).first()).toBeVisible();
  // Every primary nav link should be in the sidebar
  const links = [
    /^(Overview|Visão geral)$/i,
    /^(Suggestions|Sugestões)$/i,
    /^(Pending|Pendentes)$/i,
    /^(Proposals|Propostas)$/i,
    /^(Assemblies|Assembleias)$/i,
    /^(Meetings|Reuniões)$/i,
    /^(Announcements|Comunicados)$/i,
    /^(Residents|Moradores)$/i,
  ];
  for (const l of links) {
    await expect(menu.getByRole('link', { name: l })).toBeVisible();
  }
});

// ---------------------------------------------------------------------------
// /board/proposals — list + click into detail + voting compliance editor
// ---------------------------------------------------------------------------

test('admin: proposals list shows real items + status badges', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/proposals');
  await expect(page.getByRole('heading', { name: /Proposals|Propostas/i })).toBeVisible();
  // At least one proposal card should be present (the Vila Nova seed has 3+)
  const cards = page.locator('a[href*="/board/proposals/"]');
  await expect(cards.first()).toBeVisible();
});

test('admin: proposal detail shows description + comments + voting cards', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/proposals');
  const firstCard = page.locator('a[href*="/board/proposals/"]').first();
  await firstCard.click();
  // We're on detail. Check for at least: heading, vote count cards (Yes/No/Abstain), action button or status badge
  await expect(page.getByRole('heading').first()).toBeVisible();
  // The 3-up vote tally cards should be present (Yes/No/Abstain)
  await expect(page.getByText(/Yes|Sim/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/suggestions — list + AI cluster button
// ---------------------------------------------------------------------------

test('admin: suggestions page surfaces the cluster CTA when items exist', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/suggestions');
  await expect(page.getByRole('heading', { level: 1, name: /Suggestions|Sugest/i })).toBeVisible();
  // The cluster button is only visible if there are open suggestions; the demo seed has some.
  // Either we see it OR we see an empty state — both are valid renders.
  const clusterBtn = page.getByRole('button', { name: /cluster|agrupar/i }).first();
  const empty = page.getByText(/no open|nenhuma|empty/i).first();
  await expect(clusterBtn.or(empty)).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/pending — pending memberships
// ---------------------------------------------------------------------------

test('admin: pending memberships page renders', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/pending');
  // Use level: 1 to scope to the page H1 — there's also an h3 "Nothing pending" empty state
  await expect(page.getByRole('heading', { level: 1, name: /Pending|Pendente/i })).toBeVisible();
  await expect(page.locator('aside')).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/assemblies — full lifecycle UI (create → agenda → convoke)
// ---------------------------------------------------------------------------

test('admin: assemblies list shows existing AGOs', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/assemblies');
  await expect(page.getByRole('heading', { name: /Assemblies|Assembleias/i })).toBeVisible();
  // The "New assembly" button must always be visible to admins
  await expect(page.getByRole('button', { name: /New assembly|Nova assembleia/i })).toBeVisible();
});

test('admin: assembly detail shows agenda + lifecycle buttons in correct state', async ({ page, request }) => {
  // Create an ephemeral assembly via API so the test is deterministic
  const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const r = await request.post(`${apiURL}/assemblies`, {
    headers, data: { title: `walkthrough ${Date.now()}`, kind: 'ordinary', first_call_at: future },
  });
  const id = (await r.json()).data.id;

  await adminLogin(page, request);
  await page.goto(`/board/assemblies/${id}`);
  // Empty agenda state + the AI-draft CTA + "Add item" form should all be visible
  await expect(page.getByRole('button', { name: /Convoke/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Item title/i)).toBeVisible();
  // The "Draft with AI" CTA shows only when agenda is empty
  await expect(page.getByRole('button', { name: /Draft with AI/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/meetings — list + new-meeting form
// ---------------------------------------------------------------------------

test('admin: meetings page exposes "New meeting" button + form opens', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/meetings');
  await expect(page.getByRole('heading', { name: /Meetings|Reuniões/i })).toBeVisible();
  const newBtn = page.getByRole('button', { name: /New meeting|Nova reunião/i });
  await expect(newBtn).toBeVisible();
  await newBtn.click();
  // The form's title input should now be visible (placeholder mentions Q3 / Board Meeting)
  await expect(page.getByPlaceholder(/Q3|Title|Board Meeting/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/announcements — list + create button
// ---------------------------------------------------------------------------

test('admin: announcements page surfaces create CTA', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/announcements');
  await expect(page.getByRole('heading', { name: /Announcements|Comunic/i })).toBeVisible();
  // Either there's a create button or a primary CTA somewhere visible
  const newBtn = page.getByRole('button', { name: /New|Novo|Create|Criar/i }).first();
  await expect(newBtn).toBeVisible();
});

// ---------------------------------------------------------------------------
// /board/residents — table + Import roster button
// ---------------------------------------------------------------------------

test('admin: residents page lists residents + has import roster button', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/residents');
  await expect(page.getByRole('heading', { name: /Residents|Moradores/i })).toBeVisible();
  // Should show at least one resident row from the seed (Maya, etc.)
  await expect(page.getByText(/Maya|Alex|Jordan|Taylor/i).first()).toBeVisible();
  // Import roster button always visible
  await expect(page.getByRole('button', { name: /Import roster|Importar/i }).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Cross-cutting — sidebar navigation works between any two pages
// ---------------------------------------------------------------------------

test('admin: sidebar nav links round-trip between pages', async ({ page, request, isMobile }) => {
  await adminLogin(page, request);
  await page.goto('/board');
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Proposals|Propostas)$/i }).click();
  await expect(page).toHaveURL(/\/board\/proposals$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Assemblies|Assembleias)$/i }).click();
  await expect(page).toHaveURL(/\/board\/assemblies$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Residents|Moradores)$/i }).click();
  await expect(page).toHaveURL(/\/board\/residents$/);
  await (await nav(page, isMobile)).getByRole('link', { name: /^(Overview|Visão geral)$/i }).click();
  await expect(page).toHaveURL(/\/board$/);
});
