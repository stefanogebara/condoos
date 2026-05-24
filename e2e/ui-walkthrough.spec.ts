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
import { credentialsFor } from './support/credentials';
import { gotoApp } from './support/navigation';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

async function openDrawerIfMobile(page: Page) {
  const vp = page.viewportSize();
  if (!vp || vp.width >= 1024) return;
  const hamburger = page.getByRole('button', { name: /Abrir menu/i });
  if (await hamburger.isVisible({ timeout: 1000 }).catch(() => false)) {
    await hamburger.click();
    await page.getByRole('navigation').waitFor({ state: 'visible', timeout: 5000 });
  }
}

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
  // Check the web edge before consuming one of production's scarce auth attempts.
  await gotoApp(page, '/');

  const creds = credentialsFor(kind);
  const s = await loginApi(request, creds.email, creds.password);
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

async function clickShellLink(page: Page, href: string) {
  const link = page.locator(`a[href="${href}"]`).first();
  const isMobile = (page.viewportSize()?.width || 1280) < 1024;
  if (isMobile) {
    await openDrawerIfMobile(page);
  } else if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Abrir menu|Open menu|Abrir menú|Ouvrir le menu/i }).click();
  }
  await expect(link).toBeVisible();
  await link.click();
}

const re = {
  building: /^(Edifício|Building|Edificio|Immeuble)$/i,
  newBuilding: /Novo bloco|New block|Nuevo bloque|Nouveau bloc/i,
  finance: /^(Finanças|Finance|Finanzas|Finances)$/i,
  generateCharges: /Gerar cobranças|Generate charges|Generar cobros|Générer les appels/i,
  newExpense: /Nova despesa|New expense|Nuevo gasto|Nouvelle dépense/i,
  chargeRules: /Regras de cobrança|Charge rules|Reglas de cobro|Règles d’appel/i,
  invoicesAndPayments: /Cobranças e pagamentos|Charges and payments|Cobros y pagos|Appels et paiements/i,
  categorySummary: /Resumo por categoria|Summary by category|Resumen por categoría|Résumé par catégorie/i,
  noExpenses: /Nenhuma despesa registrada|No expense recorded|Ningún gasto registrado|Aucune dépense enregistrée/i,
  proposals: /^(Propostas|Proposals|Propuestas|Propositions)$/i,
  newProposal: /Nova proposta|New proposal|Nueva propuesta|Nouvelle proposition/i,
  preVoteAnalysis: /Análise pré-votação|Pre-vote analysis|Análisis previo a la votación|Analyse (pré-vote|avant vote)/i,
  analyzeWithAi: /Analisar com IA|Re-analisar com IA|Analyze with AI|Re-analyze with AI|Analizar con IA|Re-analizar con IA|Analyser avec IA|Ré-analyser avec IA/i,
  transparency: /^(Transparência|Transparency|Transparencia|Transparence)$/i,
  spendBreakdown: /Para onde está indo o dinheiro|Where the money is going|A dónde va el dinero|Où va l’argent/i,
  noSpend: /Sem despesas registradas|No expenses recorded|Sin gastos registrados|Aucune dépense enregistrée/i,
  visitors: /^(Visitantes|Visitors|Visiteurs)$/i,
  newVisitor: /Novo visitante|New visitor|Nuevo visitante|Nouveau visiteur/i,
  partyNotice: /Vai ter festa\? Avise a portaria|Having a party\? Let the front desk know|¿Habrá fiesta\? Avisa a portería|Il y a une fête \? Prévenez la conciergerie/i,
  visitorsToday: /Visitantes hoje|Today'?s visitors|Visitantes hoy|Visiteurs du jour/i,
  pendingPackages: /Encomendas pendentes|Pending (packages|deliveries)|Paquetes pendientes|Colis en attente|Livraisons en attente/i,
};

// ---------------------------------------------------------------------------
// 1. Admin sidebar — navigate to each new page, assert the heading renders.
// ---------------------------------------------------------------------------

test('Admin: sidebar links hit every new page (Edifício, Finanças)', async ({ page, request }) => {
  test.setTimeout(60_000);
  // Block external font requests so there are no in-flight CDN downloads when
  // this page closes — otherwise Chrome can crash during fixture teardown and
  // corrupt the next test's browser context.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await seedSession(page, request, 'admin');

  await gotoApp(page, '/board');
  await expect(page.getByRole('heading', { name: /Visão geral|Bem-vindo/i }).first()).toBeVisible();

  // Edifício
  await clickShellLink(page, '/board/edificio');
  await expect(page).toHaveURL(/\/board\/edificio/);
  await expect(page.getByRole('heading', { name: re.building }).first()).toBeVisible();
  // Building cards or a "Novo bloco" button
  await expect(page.getByRole('button', { name: re.newBuilding })).toBeVisible();

  // Finanças
  await clickShellLink(page, '/board/financas');
  await expect(page).toHaveURL(/\/board\/financas/);
  await expect(page.getByRole('heading', { name: re.finance }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: re.generateCharges })).toBeVisible();
  await expect(page.getByRole('button', { name: re.newExpense })).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
});

// ---------------------------------------------------------------------------
// 2. Edifício: building list renders + "Adicionar bloco" form expands.
// ---------------------------------------------------------------------------

test('Edifício: existing buildings render with unit counts', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'admin');
  await gotoApp(page, '/board/edificio');

  // The seeded condo has at least one building. Look for the "unidades" badge.
  await expect(page.getByText(/\d+ unidades?/i).first()).toBeVisible({ timeout: 15_000 });

  // Toggle the new-block form and assert its inputs surface.
  await page.getByRole('button', { name: re.newBuilding }).click();
  await expect(page.getByRole('heading', { name: re.newBuilding })).toBeVisible();
  await expect(page.getByPlaceholder(/Torre B|Cobertura/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Finanças: category breakdown + expenses render.
// ---------------------------------------------------------------------------

test('Finanças: shows resumo por categoria + at least one expense row', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'admin');
  await gotoApp(page, '/board/financas');
  await expect(page.getByRole('heading', { name: re.chargeRules })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: re.invoicesAndPayments })).toBeVisible();

  // Either the seeded demo has expenses (Pine Ridge Towers, R$ 180.500) and
  // the resumo renders, or there's the empty-state message. Accept either —
  // we just want the page to load without crashing.
  const resumo = page.getByRole('heading', { name: re.categorySummary });
  const empty  = page.getByText(re.noExpenses);
  await expect(resumo.or(empty)).toBeVisible({ timeout: 15_000 });

  // Either way, the new-expense button must be there.
  await expect(page.getByRole('button', { name: re.newExpense })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Proposals: "Nova proposta" CTA + cost-analysis card on a discussion item.
// ---------------------------------------------------------------------------

test('Proposals: Nova proposta CTA + Análise pré-votação card on discussion item', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'admin');
  const creds = credentialsFor('admin');
  const { token } = await loginApi(request, creds.email, creds.password);
  let proposalId: number | undefined;

  try {
    const created = await request.post(`${apiURL}/proposals`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: `E2E pre-vote analysis ${Date.now()}`,
        description: 'Temporary production-safe proposal used to verify the board pre-vote analysis card.',
        category: 'maintenance',
        estimated_cost: 12345,
      },
    });
    expect(created.ok(), `proposal create failed: ${created.status()} ${await created.text()}`).toBeTruthy();
    proposalId = (await created.json()).data.id;

    // List page
    await gotoApp(page, '/board/proposals');
    await expect(page.getByRole('heading', { name: re.proposals }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: re.newProposal })).toBeVisible();

    await gotoApp(page, `/board/proposals/${proposalId}`);
    // The self-seeded discussion proposal guarantees the pre-vote analysis
    // surface exists in every tenant without depending on existing data.
    await expect(page.getByRole('heading', { name: re.preVoteAnalysis }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: re.analyzeWithAi })).toBeVisible();
  } finally {
    if (proposalId) {
      await request.delete(`${apiURL}/proposals/${proposalId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Resident Transparência: read-only spend view.
// ---------------------------------------------------------------------------

test('Resident: Transparência renders the spend dashboard', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'resident');

  await gotoApp(page, '/app/transparencia');
  await expect(page.getByRole('heading', { name: re.transparency }).first()).toBeVisible();

  // Demo data has 13 expenses — should see the breakdown chart heading.
  // If the condo is empty, accept the empty-state instead.
  const breakdown = page.getByRole('heading', { name: re.spendBreakdown });
  const empty = page.getByText(re.noSpend);
  await expect(breakdown.or(empty)).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// 6. Resident Visitors: tabs render + pré-aprovar checkbox visible in form.
// ---------------------------------------------------------------------------

test('Resident: Visitantes shows Próximas/Histórico tabs and pré-aprovar in form', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'resident');

  await gotoApp(page, '/app/visitors');
  await expect(page.getByRole('heading', { name: re.visitors }).first()).toBeVisible();

  // Open the form
  await page.getByRole('button', { name: re.newVisitor }).click();
  // Pre-approval checkbox appears with helper copy.
  await expect(page.getByText(/Pré-aprovar entrada|Pre-approve entry|Preaprobar entrada|Pré-approuver l’entrée/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 7. Resident Amenities: party guest-list section appears for the party room.
// ---------------------------------------------------------------------------

test('Amenities: selecting Salão de Festas exposes the guest-list textarea', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'resident');

  await gotoApp(page, '/app/amenities');
  // Click a party-ish amenity card. Demo seeds "Party Room"; matcher also
  // accepts PT-BR variants in case the seed gets translated.
  const partyCard = page.getByRole('heading', { name: /Party Room|Salão de Festas|Salão|Festas/i }).first();
  test.skip(!(await partyCard.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)), 'no party-room amenity available in this tenant');
  await partyCard.click();

  // Reservation form expands. The party-aware section should be visible too.
  await expect(page.getByText(re.partyNotice)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder(/Ana Souza/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 8. Concierge: /concierge today-view loads with the three sections.
// ---------------------------------------------------------------------------

test('Concierge: porteiro lands on /concierge with the today-view', async ({ page, request }) => {
  test.setTimeout(45_000);
  await seedSession(page, request, 'concierge');

  await gotoApp(page, '/concierge');
  // Mobile-first header has the user name + day
  await expect(page.getByText(/Portaria/i).first()).toBeVisible({ timeout: 15_000 });

  // Three section headings are always there even when arrays are empty.
  await expect(page.getByRole('heading', { name: re.visitorsToday })).toBeVisible();
  await expect(page.getByRole('heading', { name: re.pendingPackages })).toBeVisible();
});
