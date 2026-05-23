// Real-Chrome smoke run that visits every authenticated page and clicks
// every visible, non-destructive button. Captures console errors, page
// errors, and a full-page screenshot per route. Reports a single matrix
// at the end so failures are easy to triage.
//
// Buttons whose label matches DESTRUCTIVE_LABELS are skipped because we
// don't want to actually delete a unit, deny a visitor, reset a form, etc.
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Role = 'admin' | 'resident' | 'porteiro';

const RESIDENT_ROUTES = [
  '/app',
  '/app/visitors',
  '/app/amenities',
  '/app/proposals',
  '/app/announcements',
  '/app/transparencia',
  '/app/suggest',
  '/app/settings',
  '/app/assemblies',
  '/app/meetings',
  '/app/packages',
];

const ADMIN_ROUTES = [
  '/board',
  '/board/edificio',
  '/board/financas',
  '/board/announcements',
  '/board/proposals',
  '/board/meetings',
  '/board/visitors',
  '/board/packages',
  '/board/amenities',
  '/board/residents',
  '/board/suggestions',
  '/board/pending',
  '/board/assemblies',
];

const PORTEIRO_ROUTES = ['/concierge'];

const ROUTES_BY_ROLE: Record<Role, string[]> = {
  admin: ADMIN_ROUTES,
  resident: RESIDENT_ROUTES,
  porteiro: PORTEIRO_ROUTES,
};

// Match by visible label OR aria-label / title. Case-insensitive substring.
const DESTRUCTIVE_LABELS = [
  'apagar', 'delete', 'eliminar', 'supprimer',
  'desativar', 'deactivate', 'desactivar', 'désactiver',
  'remover', 'remove',
  'negar', 'deny', 'denegar', 'refuser',
  'recusar', 'rejeitar', 'reject', 'rechazar', 'rejeter',
  'sair', 'sign out', 'cerrar sesión', 'se déconnecter',
  'revogar', 'revoke', 'revocar', 'révoquer',
  'cancelar', 'cancel', 'annuler',
  'enviar', 'send', 'submit', 'envoyer',
  // Status-changing actions that mutate global state for this fixture
  'encerrar', 'close session', 'cerrar', 'clore',
  'publicar decisão', 'publish decision',
];

async function loginAs(page: Page, role: Role): Promise<void> {
  const creds = {
    admin: { email: 'admin@condoos.dev', password: 'admin123' },
    resident: { email: 'resident@condoos.dev', password: 'resident123' },
    porteiro: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
  }[role];
  const res = await page.request.post(`${apiURL}/auth/login`, { data: creds });
  expect(res.ok(), `${role} login`).toBeTruthy();
  const body = await res.json();
  await page.addInitScript((args: { t: string; u: unknown }) => {
    localStorage.setItem('condoos_token', args.t);
    localStorage.setItem('condoos_user', JSON.stringify(args.u));
  }, { t: body.data.token, u: body.data.user });
}

function isDestructive(label: string): boolean {
  const lower = label.toLowerCase().trim();
  if (!lower) return false;
  return DESTRUCTIVE_LABELS.some((bad) => lower.includes(bad));
}

type ClickReport = {
  route: string;
  buttons: number;
  clicked: number;
  skipped: string[];
  errors: string[];
};

async function clickAllButtons(page: Page, route: string): Promise<ClickReport> {
  const report: ClickReport = { route, buttons: 0, clicked: 0, skipped: [], errors: [] };

  // Capture page-level errors during the click loop.
  const pageErrors: string[] = [];
  const onPageError = (err: Error) => pageErrors.push(`page-error: ${err.message}`);
  page.on('pageerror', onPageError);

  try {
    // Snapshot all currently-visible button-like elements *before* we start
    // clicking, since clicks can navigate, open modals, or rerender lists.
    const buttons = page.locator('button:visible, [role="button"]:visible, a[role="button"]:visible');
    const count = await buttons.count();
    report.buttons = count;

    for (let i = 0; i < count; i += 1) {
      // Re-query each iteration because the DOM mutates between clicks.
      const fresh = page.locator('button:visible, [role="button"]:visible, a[role="button"]:visible');
      const total = await fresh.count();
      if (i >= total) break;
      const btn = fresh.nth(i);
      const label = (await btn.textContent().catch(() => '') || '')
        || (await btn.getAttribute('aria-label').catch(() => '') || '')
        || (await btn.getAttribute('title').catch(() => '') || '');
      const trimmed = label.replace(/\s+/g, ' ').trim().slice(0, 80);

      if (isDestructive(trimmed || '(no label)')) {
        report.skipped.push(trimmed || '(no label)');
        continue;
      }

      const enabled = await btn.isEnabled({ timeout: 500 }).catch(() => false);
      if (!enabled) {
        report.skipped.push(`${trimmed || '(no label)'} (disabled)`);
        continue;
      }

      const beforeUrl = page.url();
      try {
        // Some buttons may be off-screen — scroll into view, click with timeout.
        await btn.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await btn.click({ timeout: 5000, trial: false, force: false });
        report.clicked += 1;

        // Settle: dismiss any toast, close any modal, and return to route.
        await page.waitForTimeout(250);
        const afterUrl = page.url();
        if (!afterUrl.endsWith(route) && !afterUrl.includes(route)) {
          // Got navigated away; come back so subsequent buttons are still on
          // the right page. Lose the modal state, that's fine.
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(300);
        }

        // Try to dismiss visible dialogs by pressing Escape — covers most
        // close buttons we don't want to chase manually.
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(150);
      } catch (err) {
        const msg = (err as Error).message.split('\n')[0].slice(0, 160);
        report.errors.push(`button "${trimmed || '(no label)'}": ${msg}`);
      }
    }
  } finally {
    page.off('pageerror', onPageError);
  }

  if (pageErrors.length) report.errors.push(...pageErrors);
  return report;
}

for (const role of ['admin', 'resident', 'porteiro'] as Role[]) {
  test.describe(`Smoke clicks — ${role} (real Chrome)`, () => {
    // Real Chrome is configured globally in playwright.config (channel='chrome').
    test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

    test(`${role}: visit and click every button on every page`, async ({ page, browserName }) => {
      // Up to 13 routes × ~10 buttons × ~600ms apiece, plus per-page wait.
      // The default 45 s blows up halfway through the admin run; give each
      // role its own generous slice and let Playwright do the work.
      test.setTimeout(360_000);
      // Track console errors so we can blame the page if a button breaks.
      const consoleErrors: string[] = [];
      page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Ignore noisy network errors when local backend bounces between tests.
          if (/Failed to load resource|net::ERR_/i.test(text)) return;
          consoleErrors.push(text.slice(0, 200));
        }
      });

      await loginAs(page, role);

      const reports: ClickReport[] = [];
      for (const route of ROUTES_BY_ROLE[role]) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        await page.screenshot({
          path: `test-results/smoke-clicks/${role}${route.replace(/\//g, '-')}.png`,
          fullPage: true,
        });
        const r = await clickAllButtons(page, route);
        reports.push(r);
      }

      // Report a one-line summary per route to make the run scannable.
      // eslint-disable-next-line no-console
      console.log(`\n=== ${role} (browser: ${browserName}) ===`);
      let totalClicked = 0;
      let totalErrors = 0;
      for (const r of reports) {
        // eslint-disable-next-line no-console
        console.log(
          `${r.route.padEnd(28)} btns=${String(r.buttons).padStart(2)} ` +
          `clicked=${String(r.clicked).padStart(2)} ` +
          `skipped=${r.skipped.length} errors=${r.errors.length}` +
          (r.errors.length ? ` -> ${r.errors[0]}` : ''),
        );
        totalClicked += r.clicked;
        totalErrors += r.errors.length;
      }
      // eslint-disable-next-line no-console
      console.log(`TOTAL clicked=${totalClicked} errors=${totalErrors} consoleErrors=${consoleErrors.length}`);

      const aggregateErrors = reports.flatMap((r) => r.errors.map((e) => `${r.route}: ${e}`));
      // Console errors that aren't network are a real failure.
      const fatalConsoleErrors = consoleErrors.filter((e) => !/^\[/.test(e));
      expect(
        { aggregateErrors, fatalConsoleErrors },
        `clickable smoke uncovered issues:\n${JSON.stringify({ aggregateErrors, fatalConsoleErrors }, null, 2)}`,
      ).toEqual({ aggregateErrors: [], fatalConsoleErrors: [] });
    });
  });
}
