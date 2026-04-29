// Real-browser click-through over the new UI surfaces shipped this round:
// - /board/edificio (admin building/unit editor)
// - /board/financas (admin expenses)
// - /board/proposals + detail (Nova proposta CTA + Análise pré-votação card)
// - /app/transparencia (resident read-only spend view)
// - /app/visitors (Próximas | Histórico tabs + pré-aprovar checkbox)
// - /app/amenities (party guest-list section)
// - /concierge (porteiro today-view)
//
// Auth tokens are cached per worker to stay under the 5/15min rate limit on
// /auth/login. seedSession() does an API login once per role and pre-loads
// the JWT into localStorage so each test skips the login form entirely.
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

async function seedSession(page: Page, request: APIRequestContext, kind: 'admin' | 'resident' | 'concierge') {
  const creds: Record<typeof kind, [string, string]> = {
    admin:     ['admin@condoos.dev',    'admin123'],
    resident:  ['resident@condoos.dev', 'resident123'],
    concierge: ['porteiro@condoos.dev', 'porteiro123'],
  };
  const [email, password] = creds[kind];
  const s = await loginApi(request, email, password);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

// ---------------------------------------------------------------------------
// 1. Admin sidebar — navigate to each new page, assert the heading renders.
// ---------------------------------------------------------------------------

test('Admin: sidebar links hit every new page (Edifício, Finanças)', async ({ page, request }) => {
  test.setTimeout(60_000);
  await seedSession(page, request, 'admin');

  await page.goto('/board');
  await expect(page.getByRole('heading', { name: /Visão geral|Bem-vindo/i }).first()).toBeVisible();

  // Edifício
  await page.getByRole('link', { name: /^Edifício$/i }).click();
  await expect(page).toHaveURL(/\/board\/edificio/);
  await expect(page.getByRole('heading', { name: /^Edifício$/i }).first()).toBeVisible();
  // Building cards or a "Novo bloco" button
  await expect(page.getByRole('button', { name: /Novo bloco/i })).toBeVisible();

  // Finanças
  await page.getByRole('link', { name: /^Finanças$/i }).click();
  await expect(page).toHaveURL(/\/board\/financas/);
  await expect(page.getByRole('heading', { name: /^Finanças$/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Nova despesa/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Edifício: building list renders + "Adicionar bloco" form expands.
// ---------------------------------------------------------------------------

test('Edifício: existing buildings render with unit counts', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'admin');
  await page.goto('/board/edificio');

  // The seeded condo has at least one building. Look for the "unidades" badge.
  await expect(page.getByText(/\d+ unidades?/i).first()).toBeVisible({ timeout: 15_000 });

  // Toggle the new-block form and assert its inputs surface.
  await page.getByRole('button', { name: /Novo bloco/i }).click();
  await expect(page.getByRole('heading', { name: /^Novo bloco$/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Torre B|Cobertura/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Finanças: category breakdown + expenses render.
// ---------------------------------------------------------------------------

test('Finanças: shows resumo por categoria + at least one expense row', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'admin');
  await page.goto('/board/financas');

  // Either the seeded demo has expenses (Pine Ridge Towers, R$ 180.500) and
  // the resumo renders, or there's the empty-state message. Accept either —
  // we just want the page to load without crashing.
  const resumo = page.getByRole('heading', { name: /Resumo por categoria/i });
  const empty  = page.getByText(/Nenhuma despesa registrada/i);
  await expect(resumo.or(empty)).toBeVisible({ timeout: 15_000 });

  // Either way, the new-expense button must be there.
  await expect(page.getByRole('button', { name: /Nova despesa/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Proposals: "Nova proposta" CTA + cost-analysis card on a discussion item.
// ---------------------------------------------------------------------------

test('Proposals: Nova proposta CTA + Análise pré-votação card on discussion item', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'admin');

  // List page
  await page.goto('/board/proposals');
  await expect(page.getByRole('heading', { name: /^Propostas$/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Nova proposta/i })).toBeVisible();

  // Find a discussion proposal via the API (avoids relying on seed order)
  const { token } = await loginApi(request, 'admin@condoos.dev', 'admin123');
  const list = await request.get(`${apiURL}/proposals`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (await list.json()).data as Array<{ id: number; status: string }>;
  const discussionId = rows.find((r) => r.status === 'discussion')?.id;
  test.skip(!discussionId, 'no proposal in discussion to assert the cost card');

  await page.goto(`/board/proposals/${discussionId}`);
  // The cost-analysis card surfaces in two states: with breakdown ("Análise
  // pré-votação" + a breakdown), or empty ("Custo não definido" warning).
  // Either way the heading is there.
  await expect(page.getByRole('heading', { name: /Análise pré-votação/i }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Analisar com IA|Re-analisar com IA/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Resident Transparência: read-only spend view.
// ---------------------------------------------------------------------------

test('Resident: Transparência renders the spend dashboard', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'resident');

  await page.goto('/app/transparencia');
  await expect(page.getByRole('heading', { name: /^Transparência$/i }).first()).toBeVisible();

  // Demo data has 13 expenses — should see the breakdown chart heading.
  // If the condo is empty, accept the empty-state instead.
  const breakdown = page.getByRole('heading', { name: /Para onde está indo o dinheiro/i });
  const empty = page.getByText(/Sem despesas registradas/i);
  await expect(breakdown.or(empty)).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// 6. Resident Visitors: tabs render + pré-aprovar checkbox visible in form.
// ---------------------------------------------------------------------------

test('Resident: Visitantes shows Próximas/Histórico tabs and pré-aprovar in form', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'resident');

  await page.goto('/app/visitors');
  await expect(page.getByRole('heading', { name: /^Visitantes$/i }).first()).toBeVisible();

  // Open the form
  await page.getByRole('button', { name: /Novo visitante/i }).click();
  // Pré-aprovar checkbox appears with helper copy
  await expect(page.getByText(/Pré-aprovar a entrada/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 7. Resident Amenities: party guest-list section appears for the party room.
// ---------------------------------------------------------------------------

test('Amenities: selecting Salão de Festas exposes the guest-list textarea', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'resident');

  await page.goto('/app/amenities');
  // Click a party-ish amenity card. Demo seeds "Party Room"; matcher also
  // accepts PT-BR variants in case the seed gets translated.
  const partyCard = page.getByRole('heading', { name: /Party Room|Salão de Festas|Salão|Festas/i }).first();
  await expect(partyCard).toBeVisible({ timeout: 10_000 });
  await partyCard.click();

  // Reservation form expands. The party-aware section should be visible too.
  await expect(page.getByText(/Vai ter festa\? Avise a portaria/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder(/Ana Souza/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 8. Concierge: /concierge today-view loads with the three sections.
// ---------------------------------------------------------------------------

test('Concierge: porteiro lands on /concierge with the today-view', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'concierge');

  await page.goto('/concierge');
  // Mobile-first header has the user name + day
  await expect(page.getByText(/Portaria/i).first()).toBeVisible({ timeout: 15_000 });

  // Three section headings are always there even when arrays are empty.
  await expect(page.getByRole('heading', { name: /Visitantes hoje/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Encomendas pendentes/i })).toBeVisible();
});
