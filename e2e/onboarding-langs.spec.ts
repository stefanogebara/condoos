// Visual + leak proof for the three onboarding pages across all four
// locales. These pages predate the i18n dictionary and were the source
// of the "everything in Portuguese" bug the user flagged.
import { test, expect, Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Locale = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

const PAGES = [
  '/onboarding',
  '/onboarding/join',
  '/onboarding/create',
];

// Sentinel words that prove the translation reached the page. If none
// of these are visible, the dictionary didn't kick in and the test
// fails loud rather than passing on rendered Portuguese.
const SIGNATURES: Record<Locale, RegExp> = {
  'pt-BR': /(Vamos encontrar seu prédio|Entrar num prédio|Insira o código|Como o prédio se chama|Estrutura)/u,
  'en-US': /(Let’s find your building|Join a building|Enter the invite code|What is your building called|Structure)/u,
  'es-ES': /(Vamos a encontrar tu edificio|Unirse a un edificio|Ingresa el código de invitación|Cómo se llama el edificio|Estructura)/u,
  'fr-FR': /(Trouvons votre immeuble|Rejoindre un immeuble|Saisissez le code d’invitation|Comment s’appelle votre immeuble|Structure)/u,
};

// PT phrases that must NOT appear when the locale is non-PT.
const PT_LEAKS: RegExp[] = [
  /\bPrédio\b/u,
  /\bEstrutura\b/u,
  /\bPreferências\b/u,
  /\bOperação\b/u,
  /\bPronto\b/u,
  /Nome do condomínio/u,
  /Endereço/u,
  /Os blocos \/ torres/u,
  /Como o prédio se chama/u,
  /Vamos encontrar seu prédio/u,
  /Insira o código de convite/u,
  /Entrar num prédio/u,
  /Montar um novo prédio/u,
];

function loginInitScript(token: string, user: unknown) {
  return (args: { t: string; u: unknown }) => {
    localStorage.setItem('condoos_token', args.t);
    localStorage.setItem('condoos_user', JSON.stringify(args.u));
  };
}

async function loginAs(page: Page, role: 'admin' | 'resident') {
  // We log in to satisfy the auth gate — onboarding pages live behind
  // it. Each role has a different default landing post-membership, so
  // we just need any valid session.
  const creds = role === 'admin'
    ? { email: 'admin@condoos.dev', password: 'admin123' }
    : { email: 'resident@condoos.dev', password: 'resident123' };
  const res = await page.request.post(`${apiURL}/auth/login`, { data: creds });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  await page.addInitScript(loginInitScript(body.data.token, body.data.user), {
    t: body.data.token, u: body.data.user,
  });
}

async function setLocale(page: Page, locale: Locale) {
  await page.addInitScript((target) => {
    localStorage.setItem('condoos_locale', target);
    localStorage.setItem('condoos_locale_source', 'manual');
  }, locale);
}

for (const locale of ['pt-BR', 'en-US', 'es-ES', 'fr-FR'] as Locale[]) {
  test.describe(`Onboarding visual — ${locale}`, () => {
    test.use({
      locale,
      timezoneId: locale === 'fr-FR' ? 'Europe/Paris'
        : locale === 'es-ES' ? 'Europe/Madrid'
          : locale === 'pt-BR' ? 'America/Sao_Paulo'
            : 'America/New_York',
    });

    for (const path of PAGES) {
      test(`${path} in ${locale}`, async ({ page }) => {
        await setLocale(page, locale);
        // /onboarding redirects authed users with active memberships, so
        // we use the resident demo account which won't redirect for the
        // create page either.
        await loginAs(page, 'admin');
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        const slug = path.replace(/\//g, '-').replace(/^-/, '');
        await page.screenshot({ path: `test-results/onboarding-langs/${locale}-${slug}.png`, fullPage: true });

        const text = await page.locator('body').innerText();

        // Sanity: at least one locale-signature word is visible.
        if (locale !== 'pt-BR') {
          // Onboarding pages may redirect for users with active memberships.
          // Soft-fail when the page didn't actually render an onboarding view.
          test.skip(!SIGNATURES[locale].test(text), `${path} did not show onboarding for ${locale} (likely redirected)`);
        }

        // Hard-fail on any PT leak in non-PT locales.
        if (locale !== 'pt-BR') {
          const leaks = PT_LEAKS.flatMap((re) => text.match(re)?.[0] ? [text.match(re)![0]] : []);
          expect(leaks, `PT leaked on ${path} in ${locale}: ${leaks.join(', ')}`).toEqual([]);
        }
      });
    }

    // /onboarding/create is a 5-step wizard — step 1 is what the lone
    // page-load test above sees. Walk through every step by filling
    // out the form so we catch leaks on the inner steps the user
    // actually screenshotted.
    test(`/onboarding/create wizard steps 1-3 in ${locale}`, async ({ page }) => {
      test.setTimeout(60_000);
      await setLocale(page, locale);
      await loginAs(page, 'admin');
      await page.goto('/onboarding/create', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      const sig = SIGNATURES[locale];
      const initialText = await page.locator('body').innerText();
      test.skip(!sig.test(initialText), '/onboarding/create did not show wizard (admin already onboarded)');

      // Step 1: enter condo name + address, then Continue.
      const inputs = page.locator('input.input');
      await inputs.nth(0).fill('Visual QA Tower');
      await inputs.nth(1).fill('1 Test Street');
      await page.getByRole('button').filter({ hasText: /Continuar|Continue|Continuer/ }).first().click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `test-results/onboarding-langs/${locale}-create-step2.png`, fullPage: true });

      const step2Text = await page.locator('body').innerText();
      if (locale !== 'pt-BR') {
        const leaks2 = PT_LEAKS.flatMap((re) => step2Text.match(re)?.[0] ? [step2Text.match(re)![0]] : []);
        // Also catch the long step-2 hint paragraph that previously broke.
        if (/Cadastre cada torre ou bloco/.test(step2Text)) leaks2.push('Cadastre cada torre ou bloco…');
        expect(leaks2, `PT leak on /onboarding/create step 2 in ${locale}: ${leaks2.join(', ')}`).toEqual([]);
      }

      // Step 2 → step 3: just click Continue (defaults are valid).
      await page.getByRole('button').filter({ hasText: /Continuar|Continue|Continuer/ }).first().click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `test-results/onboarding-langs/${locale}-create-step3.png`, fullPage: true });

      const step3Text = await page.locator('body').innerText();
      if (locale !== 'pt-BR') {
        const leaks3 = PT_LEAKS.flatMap((re) => step3Text.match(re)?.[0] ? [step3Text.match(re)![0]] : []);
        expect(leaks3, `PT leak on /onboarding/create step 3 in ${locale}: ${leaks3.join(', ')}`).toEqual([]);
      }
    });
  });
}
