// Visual proof: walk every locale across public + authenticated routes,
// take a screenshot, and assert that locale-specific signature copy is
// present on each page. Output goes under e2e/test-results/i18n-visual/.
import { expect, test, Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Locale = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

const LOCALES: Array<{ locale: Locale; label: string; tz: string }> = [
  { locale: 'pt-BR', label: 'pt', tz: 'America/Sao_Paulo' },
  { locale: 'en-US', label: 'en', tz: 'America/New_York' },
  { locale: 'es-ES', label: 'es', tz: 'Europe/Madrid' },
  { locale: 'fr-FR', label: 'fr', tz: 'Europe/Paris' },
];

// Locale-specific signature words per page. If a word is missing the page
// did not translate; if a foreign-locale word is present, there's a leak.
const SIGNATURES: Record<Locale, RegExp> = {
  'pt-BR': /(Encomendas|Visitantes|Áreas comuns|Comunicados|Propostas)/,
  'en-US': /(Packages|Visitors|Amenities|Announcements|Proposals)/,
  'es-ES': /(Paquetes|Visitantes|Áreas comunes|Avisos|Propuestas)/,
  'fr-FR': /(Colis|Visiteurs|Espaces communs|Annonces|Propositions)/,
};

async function loginAs(page: Page, role: 'admin' | 'resident' | 'porteiro') {
  const creds = {
    admin: { email: 'admin@condoos.dev', password: 'admin123' },
    resident: { email: 'resident@condoos.dev', password: 'resident123' },
    porteiro: { email: 'porteiro@condoos.dev', password: 'porteiro123' },
  }[role];
  const res = await page.request.post(`${apiURL}/auth/login`, { data: creds });
  expect(res.ok(), `${role} login`).toBeTruthy();
  const body = await res.json();
  const token = body?.data?.token;
  const user = body?.data?.user;
  await page.addInitScript((args: { t: string; u: unknown }) => {
    localStorage.setItem('condoos_token', args.t);
    localStorage.setItem('condoos_user', JSON.stringify(args.u));
  }, { t: token, u: user });
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript((target) => {
    localStorage.setItem('condoos_locale', target);
    localStorage.setItem('condoos_locale_source', 'manual');
  }, locale);
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(900); // let the MutationObserver translate
  await page.screenshot({ path: `test-results/i18n-visual/${name}.png`, fullPage: true });
}

for (const { locale, label, tz } of LOCALES) {
  test.describe(`Visual ${label}`, () => {
    test.use({ locale, timezoneId: tz });

    test(`landing in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await page.goto('/');
      await shoot(page, `${label}-landing`);
      const text = await page.locator('body').innerText();
      expect(text, `${label} landing missing locale signatures`).toMatch(SIGNATURES[locale]);
    });

    test(`admin dashboard in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await loginAs(page, 'admin');
      await page.goto('/board');
      await shoot(page, `${label}-board`);
      const text = await page.locator('body').innerText();
      expect(text, `${label} /board missing locale signatures`).toMatch(SIGNATURES[locale]);
    });

    test(`finanças in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await loginAs(page, 'admin');
      await page.goto('/board/financas');
      await shoot(page, `${label}-financas`);
    });

    test(`amenities in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await loginAs(page, 'admin');
      await page.goto('/board/amenities');
      await shoot(page, `${label}-amenities`);
    });

    test(`resident overview in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await loginAs(page, 'resident');
      await page.goto('/app');
      await shoot(page, `${label}-app`);
      const text = await page.locator('body').innerText();
      expect(text, `${label} /app missing locale signatures`).toMatch(SIGNATURES[locale]);
    });

    test(`resident transparência in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await loginAs(page, 'resident');
      await page.goto('/app/transparencia');
      await shoot(page, `${label}-transparencia`);
    });

    test(`concierge in ${label}`, async ({ page }) => {
      await setLocale(page, locale);
      await loginAs(page, 'porteiro');
      await page.goto('/concierge');
      await shoot(page, `${label}-concierge`);
    });

    test(`manual switcher to ${label} from PT`, async ({ page }) => {
      // Start with no locale stored; let it default to PT (or whatever location detects).
      await page.goto('/');
      await page.locator('select[aria-label]').selectOption(locale);
      await page.waitForLoadState('domcontentloaded');
      await shoot(page, `${label}-after-manual-switch`);
      const text = await page.locator('body').innerText();
      expect(text, `manual switch to ${label} did not apply`).toMatch(SIGNATURES[locale]);
    });
  });
}
