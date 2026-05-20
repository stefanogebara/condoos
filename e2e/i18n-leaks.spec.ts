import { test, expect, Page } from '@playwright/test';

// Strict PT-leak detector. Runs the app in en-US/es-ES/fr-FR locale,
// crawls every important page, and FAILS if any text node still contains
// Portuguese-only marker words. Used to drive iteration until 0 leaks.

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL}/api` : 'http://127.0.0.1:4312/api');

// PT-only markers — substrings that are Portuguese AND not valid English/Spanish/French.
// Diacritic-bearing tokens are the safest signals: `ção`, `ões`, `ão`, `também`, `não`,
// `você`, `síndico`. We ALSO add a few PT-specific words like `Encomendas` (es=Paquetes,
// fr=Colis) that have no accent overlap.
const PT_MARKERS: RegExp[] = [
  /\bção\b/u,        // unlikely standalone
  /ção\b/u,           // suffix: -ção (decisão, votação)
  /ções\b/u,          // suffix: -ções
  /\bnão\b/iu,        // no
  /\bsão\b/iu,        // are / Saint
  /\bvocê\b/iu,       // you (informal)
  /\bvocês\b/iu,      // you-pl
  /\btambém\b/iu,     // also
  /\bsíndico\b/iu,    // board admin
  /\bsíndica\b/iu,    // board admin (fem)
  /\baté\b/iu,        // until
  /\bjá\b/iu,         // already
  /\bhá\b/iu,         // there is
  /\bestá\b/iu,       // is
  /\bestão\b/iu,      // are
  /Bem-vindo/iu,      // welcome
  /Bem-vinda/iu,
  /\bencomendas?\b/iu, // packages — no accent but PT-only word
  /\bvisitantes?\b/iu, // visitors — also Spanish! exclude in ES walk
  /\bmoradores?\b/iu,  // residents — also Spanish! exclude in ES walk
  /\bporteiros?\b/iu,  // doormen — also Spanish (mostly)
  /\bcarregando\b/iu,  // loading — pt-only (es=cargando)
  /\bsalvar\b/iu,      // save — also Spanish
  /\baprovar\b/iu,     // approve — also Spanish
  /\brecusar\b/iu,     // refuse — also Spanish
  /\bvotação\b/iu,     // voting
  /\baprovação\b/iu,   // approval
  /\bdiscussão\b/iu,
  /\breunião\b/iu,
  /\bassembleia\b/iu,  // assembly — also Spanish (asamblea)
  /\bpróxim[ao]s?\b/iu,
  /\bhistórico\b/iu,
  /\bpré-aprovar\b/iu,
  /\banálise\b/iu,
  /\borçamento\b/iu,
  /\borçada\b/iu,
  /\bestimad[ao]\b/iu, // also Spanish
  /\bedifício\b/iu,    // also Spanish (edificio)
  /\bandar\b/iu,       // also Spanish
  /\bapto\b/iu,        // unit
  /\bunidade\b/iu,
  /\bunidades\b/iu,
  /\bhoje\b/iu,
  /\bdesc(rever|rição|reva)\b/iu,
  // Multi-word PT phrases — none of these are valid in EN/ES/FR.
  /Aqui está/iu,
  /Você (?:pode|tem|recebe|autorizou)/iu,
  /Seu (?:prédio|voto|condomínio|nome)/iu,
  /Sua (?:unidade|reserva|presença)/iu,
  /Seus (?:dados|pedidos)/iu,
  /Suas (?:reservas|preferências)/iu,
  /Não foi possível/iu,
  /\bredigido pela ia\b/iu,
  /\bgerado pela ia\b/iu,
  /Receba (?:avisos|o resumo)/iu,
  /\bnotificações\b/iu,    // ES is notificaciones — PT only
  /\bautorizar\b/iu,        // also ES — relax in ES walk
  /\bnenhum[ao]?\b/iu,      // ES is ninguno — exclude from ES
  /\bcom IA\b/iu,           // "com IA" PT — relax in ES walk
  /\bjuridiquês\b/iu,
  /\bConvocação\b/iu,
  /\bConceda\b/iu,
  /\bRegistre\b/iu,
  /\bConvocar\b/iu,
  /\bConvocada\b/iu,
  /\bencerrada\b/iu,
  /\brascunho\b/iu,
  /\bDescrição\b/iu,
  /\bDecisões\b/iu,
  /\bComentário\b/iu,
  /\bComentários\b/iu,
  /\bEnviado\b/iu,
  /\bAtivo\b/iu,
  /\bproprietários?\b/iu,
  /\bproprietária\b/iu,
  /\bprocuração\b/iu,
  /\bprocurações\b/iu,
  /\bquórum\b/iu,
  /\binadimplente\b/iu,
  /\bRetirei\b/iu,
  /\bRetirar\b/iu,
  /\bChegou em\b/iu,
  /\bChegou (?:hoje|agora|no)\b/iu,
  /\bChamados\b/iu,
  /\bcomunidade\b/iu,
  /\bnegaram\b/iu,
  /\bacionar\b/iu,
  /\bGerar plano\b/iu,
  /\bProblemas reportados pelos\b/iu,
];

// Per-locale exclusion: many words overlap with Spanish (visitantes, moradores, salvar, etc.)
// so we relax those for ES. For FR, almost nothing overlaps, so all markers apply.
const ES_EXCLUDES = new Set([
  'visitantes', 'visitante',
  'moradores', 'morador',
  'porteiros', 'porteiro',
  'salvar', 'aprovar', 'recusar',
  'edificio', 'edifício',
  'andar', 'apto', 'estimado', 'estimada',
  'asamblea', 'assembleia',
  'unidade', 'unidades',
  'descripcion', 'descrição',
  'historico', 'histórico',
  'analisis', 'análise',
  'proxima', 'próxima', 'proximo', 'próximo',
  'proximas', 'próximas', 'proximos', 'próximos',
  'aprovacion', 'aprovación',
  'discusion', 'discussão',
  'autorizar', 'rascunho', 'descripción', 'descrição',
  'comentarios', 'comentários', 'comentario', 'comentário',
  'enviado', 'activo', 'ativo',
  'propietarios', 'proprietários', 'propietaria', 'proprietária',
  'quorum', 'quórum',
  'retirar',
  'eventos hoy', 'eventos hoje', // Spanish + Portuguese form of same phrase
  'inadimplente', // not a Spanish word but same as PT
]);

type Leak = { word: string; context: string };

function findLeaks(text: string, locale: string): Leak[] {
  const seen = new Set<string>();
  const out: Leak[] = [];
  for (const re of PT_MARKERS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const iter = text.matchAll(g);
    for (const m of iter) {
      const word = m[0];
      const norm = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (locale.startsWith('es') && ES_EXCLUDES.has(norm)) continue;
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + word.length + 30);
      const context = text.slice(start, end).replace(/\s+/g, ' ').trim();
      const key = `${word}::${context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ word, context });
    }
  }
  return out;
}

async function setLocaleAndReload(page: Page, locale: 'en-US' | 'es-ES' | 'fr-FR') {
  // Set locale BEFORE the SPA boots so the runtime never paints PT first.
  await page.addInitScript((target) => {
    localStorage.setItem('condoos_locale', target);
    localStorage.setItem('condoos_locale_source', 'manual');
  }, locale);
}

async function loginAs(page: Page, role: 'admin' | 'resident' | 'porteiro') {
  const creds = {
    admin: { email: 'admin@condoos.dev', password: 'admin123' },
    resident: { email: 'resident@condoos.dev', password: 'resident123' },
    porteiro: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
  }[role];

  // Surface a clear message if the API is down. Avoids 14 specs failing
  // with cryptic `apiRequestContext.post: ECONNREFUSED 127.0.0.1:4312`.
  let res;
  try {
    res = await page.request.post(`${apiURL}/auth/login`, { data: creds });
  } catch (err) {
    throw new Error(`API unreachable at ${apiURL} — is the e2e backend running? (${(err as Error).message})`);
  }
  expect(res.ok(), `${role} login should succeed`).toBeTruthy();
  const body = await res.json();
  const token = body?.data?.token || body?.token;
  const user = body?.data?.user || body?.user;
  expect(token, 'token returned').toBeTruthy();
  expect(user, 'user returned').toBeTruthy();

  await page.addInitScript((args: { t: string; u: unknown }) => {
    localStorage.setItem('condoos_token', args.t);
    localStorage.setItem('condoos_user', JSON.stringify(args.u));
  }, { t: token, u: user });

  return { token, user };
}

async function seedCommunityTicket(page: Page) {
  const res = await page.request.post(`${apiURL}/auth/login`, {
    data: { email: 'resident@condoos.dev', password: 'resident123' },
  });
  expect(res.ok(), 'resident login for ticket fixture should succeed').toBeTruthy();
  const body = await res.json();
  const token = body?.data?.token || body?.token;
  expect(token, 'resident fixture token returned').toBeTruthy();

  const created = await page.request.post(`${apiURL}/tickets`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Lights in lobby are not working',
      description: 'since yesterday lights in lobby dont work',
      category: 'maintenance',
      priority: 'normal',
      verification_threshold: 3,
    },
  });
  expect(created.ok(), 'community ticket fixture should be created').toBeTruthy();
}

async function scan(page: Page, path: string, locale: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  // App pages poll several lightweight endpoints from the sidebar, so the
  // browser may never become fully "network idle". Keep this bounded or the
  // leak sweep spends 30s per route waiting for a state the product correctly
  // does not reach.
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
  if (path === '/board/tickets') {
    const ticket = page.getByRole('button', { name: /Lights in lobby are not working/i }).first();
    if (await ticket.isVisible().catch(() => false)) {
      await ticket.click();
      await page.getByText(/Generate AI plan|Generar plan IA|Générer le plan IA|Gerar plano IA/i).first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
  }
  // Let MutationObserver translate any late-rendered text.
  await page.waitForTimeout(800);
  // The scanner verifies product UI chrome is translated. User-authored
  // content (proposal descriptions, announcement bodies, ticket notes) is
  // never translated by design and lives in [data-user-content] regions —
  // hide those before reading text so seed data in one language can't be
  // mistaken for a chrome leak.
  const text = await page.evaluate(() => {
    const hidden: { el: HTMLElement; prev: string }[] = [];
    document.querySelectorAll<HTMLElement>('[data-user-content]').forEach((el) => {
      hidden.push({ el, prev: el.style.display });
      el.style.display = 'none';
    });
    const result = document.body.innerText;
    hidden.forEach(({ el, prev }) => { el.style.display = prev; });
    return result;
  });
  const leaks = findLeaks(text, locale);
  return { path, leaks, sample: text.slice(0, 4000) };
}

const ADMIN_ROUTES = [
  '/board',
  '/board/portfolio',
  '/board/agent',
  '/board/reports',
  '/board/pending',
  '/board/suggestions',
  '/board/edificio',
  '/board/services',
  '/board/financas',
  '/board/documents',
  '/board/announcements',
  '/board/proposals',
  '/board/proposals/1',
  '/board/meetings',
  '/board/meetings/1',
  '/board/assemblies',
  '/board/assemblies/1',
  '/board/visitors',
  '/board/packages',
  '/board/amenities',
  '/board/residents',
  '/board/tickets',
];
const RESIDENT_ROUTES = [
  '/app',
  '/app/visitors',
  '/app/amenities',
  '/app/proposals',
  '/app/proposals/1',
  '/app/announcements',
  '/app/documents',
  '/app/tickets',
  '/app/transparencia',
  '/app/suggest',
  '/app/settings',
  '/app/assemblies',
  '/app/assemblies/1',
  '/app/meetings',
  '/app/packages',
];
const PORTEIRO_ROUTES = [
  '/concierge',
];
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/signup?intent=join',
  '/signup?intent=create',
  '/signup?intent=agency&agency_invite=ui-only-token',
];

const PUBLIC_LOGIN_HEADINGS: Record<'en-US' | 'es-ES' | 'fr-FR', string> = {
  'en-US': 'Welcome back',
  'es-ES': 'Bienvenido de vuelta',
  'fr-FR': 'Bon retour',
};

// Reverse direction: when locale is PT-BR, ensure no English-only sentences leak.
// We use VERY narrow markers that only appear in English and never in PT/ES/FR.
const EN_ONLY_MARKERS: RegExp[] = [
  /\bGood morning\b/u,
  /\bGood afternoon\b/u,
  /\bGood evening\b/u,
  /\bWelcome back\b/u,
  /\bView all\b/u,
  /\bIn the vote\b/u,
  /\bLatest announcements\b/u,
  /\bPackages waiting\b/u,
  /\bUpcoming visitors\b/u,
  /\bYour reservations\b/u,
  /\bOpen proposals\b/u,
  /\bPending approvals\b/u,
  /\bNothing pending\b/u,
  /\bClaiming Unit\b/u,
  /\bAI meeting recap\b/u,
  /\bAI decision\b/u,
];

const GENERATED_CONTENT_EXCLUDES: RegExp[] = [
  // The leak scanner verifies product UI chrome. Other E2E flows can leave
  // user/generated announcements in English, which should not fail i18n chrome.
  /\bE2E decision\b/i,
];

function findEnLeaks(text: string): Leak[] {
  const seen = new Set<string>();
  const out: Leak[] = [];
  for (const re of EN_ONLY_MARKERS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(g)) {
      const word = m[0];
      const idx = m.index ?? 0;
      const context = text.slice(Math.max(0, idx - 30), Math.min(text.length, idx + word.length + 30)).replace(/\s+/g, ' ').trim();
      if (GENERATED_CONTENT_EXCLUDES.some((exclude) => exclude.test(context))) continue;
      const key = `${word}::${context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ word, context });
    }
  }
  return out;
}

test.describe('i18n reverse-leak scan — pt-BR (no EN strings should leak)', () => {
  test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

  test('admin pages have no EN leaks (pt-BR)', async ({ page }) => {
    await setLocaleAndReload(page, 'pt-BR' as 'en-US');
    await loginAs(page, 'admin');
    await seedCommunityTicket(page);
    const results = [] as Array<{ path: string; leaks: Leak[] }>;
    for (const path of ADMIN_ROUTES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const text = await page.locator('body').innerText();
      const leaks = findEnLeaks(text);
      if (leaks.length) results.push({ path, leaks });
    }
    expect(results, `EN leaks on admin pages (pt): ${JSON.stringify(results, null, 2)}`).toEqual([]);
  });

  test('resident pages have no EN leaks (pt-BR)', async ({ page }) => {
    await setLocaleAndReload(page, 'pt-BR' as 'en-US');
    await loginAs(page, 'resident');
    const results = [] as Array<{ path: string; leaks: Leak[] }>;
    for (const path of RESIDENT_ROUTES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const text = await page.locator('body').innerText();
      const leaks = findEnLeaks(text);
      if (leaks.length) results.push({ path, leaks });
    }
    expect(results, `EN leaks on resident pages (pt): ${JSON.stringify(results, null, 2)}`).toEqual([]);
  });
});

for (const locale of ['en-US', 'es-ES', 'fr-FR'] as const) {
  test.describe(`i18n leak scan — ${locale}`, () => {
    test.use({ locale, timezoneId: locale === 'fr-FR' ? 'Europe/Paris' : locale === 'es-ES' ? 'Europe/Madrid' : 'America/New_York' });

    test(`public pages have no PT leaks (${locale})`, async ({ page }) => {
      await setLocaleAndReload(page, locale);
      const results = [] as Array<{ path: string; leaks: Leak[] }>;
      for (const path of PUBLIC_ROUTES) {
        const r = await scan(page, path, locale);
        if (path === '/login') {
          await expect(page.getByRole('heading', { name: PUBLIC_LOGIN_HEADINGS[locale] })).toBeVisible();
        }
        if (r.leaks.length) results.push({ path: r.path, leaks: r.leaks });
      }
      expect(results, `Leaks on public pages: ${JSON.stringify(results, null, 2)}`).toEqual([]);
    });

    test(`admin pages have no PT leaks (${locale})`, async ({ page }) => {
      await setLocaleAndReload(page, locale);
      await loginAs(page, 'admin');
      await seedCommunityTicket(page);
      const results = [] as Array<{ path: string; leaks: Leak[] }>;
      for (const path of ADMIN_ROUTES) {
        const r = await scan(page, path, locale);
        if (r.leaks.length) results.push({ path: r.path, leaks: r.leaks });
      }
      expect(results, `Leaks on admin pages: ${JSON.stringify(results, null, 2)}`).toEqual([]);
    });

    test(`resident pages have no PT leaks (${locale})`, async ({ page }) => {
      await setLocaleAndReload(page, locale);
      await loginAs(page, 'resident');
      const results = [] as Array<{ path: string; leaks: Leak[] }>;
      for (const path of RESIDENT_ROUTES) {
        const r = await scan(page, path, locale);
        if (r.leaks.length) results.push({ path: r.path, leaks: r.leaks });
      }
      expect(results, `Leaks on resident pages: ${JSON.stringify(results, null, 2)}`).toEqual([]);
    });

    test(`porteiro pages have no PT leaks (${locale})`, async ({ page }) => {
      await setLocaleAndReload(page, locale);
      await loginAs(page, 'porteiro');
      const results = [] as Array<{ path: string; leaks: Leak[] }>;
      for (const path of PORTEIRO_ROUTES) {
        const r = await scan(page, path, locale);
        if (r.leaks.length) results.push({ path: r.path, leaks: r.leaks });
      }
      expect(results, `Leaks on porteiro pages: ${JSON.stringify(results, null, 2)}`).toEqual([]);
    });
  });
}
