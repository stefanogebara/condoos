// Visual proof for the routes the user explicitly flagged as still leaking PT.
// One row per locale × page, full-page screenshot. The leak detector already
// passed on these — this spec exists to surface the rendered DOM for review.
import { test, expect, Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Locale = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

const PAGES = [
  '/app/settings',
  '/app',
  '/app/suggest',
  '/app/assemblies',
  '/app/proposals',
];

async function login(page: Page) {
  const res = await page.request.post(`${apiURL}/auth/login`, {
    data: { email: 'resident@condoos.dev', password: 'resident123' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  await page.addInitScript((args: { t: string; u: unknown }) => {
    localStorage.setItem('condoos_token', args.t);
    localStorage.setItem('condoos_user', JSON.stringify(args.u));
  }, { t: body.data.token, u: body.data.user });
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript((target) => {
    localStorage.setItem('condoos_locale', target);
    localStorage.setItem('condoos_locale_source', 'manual');
  }, locale);
}

for (const locale of ['pt-BR', 'en-US', 'es-ES', 'fr-FR'] as Locale[]) {
  test.describe(`User-flagged pages — ${locale}`, () => {
    test.use({ locale, timezoneId: locale === 'fr-FR' ? 'Europe/Paris' : locale === 'es-ES' ? 'Europe/Madrid' : locale === 'pt-BR' ? 'America/Sao_Paulo' : 'America/New_York' });

    for (const path of PAGES) {
      test(`${path} in ${locale}`, async ({ page }) => {
        await setLocale(page, locale);
        await login(page);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const slug = path.replace(/\//g, '-').replace(/^-/, '') || 'root';
        await page.screenshot({ path: `test-results/user-flagged/${locale}-${slug}.png`, fullPage: true });
      });
    }
  });
}
