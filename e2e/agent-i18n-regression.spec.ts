import { expect, Page, test } from '@playwright/test';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL}/api` : 'http://127.0.0.1:6312/api');

const expectations = {
  'en-US': {
    generatePlan: 'Generate plan',
    addContext: '+ add context (type, location, budget, urgency)',
    historyHint: '30-60s, uses your building history',
  },
  'es-ES': {
    generatePlan: 'Generar plan',
    addContext: '+ agregar contexto (tipo, ubicación, presupuesto, urgencia)',
    historyHint: '30-60s, usa el historial del edificio',
  },
  'fr-FR': {
    generatePlan: 'Générer le plan',
    addContext: '+ ajouter du contexte (type, lieu, budget, urgence)',
    historyHint: '30-60 s, utilise l’historique de l’immeuble',
  },
} as const;

async function setLocale(page: Page, locale: keyof typeof expectations) {
  await page.addInitScript((target) => {
    localStorage.setItem('condoos_locale', target);
    localStorage.setItem('condoos_locale_source', 'manual');
  }, locale);
}

async function loginAsAdmin(page: Page) {
  const res = await page.request.post(`${apiURL}/auth/login`, {
    data: credentialsFor('admin'),
  });
  expect(res.ok(), 'admin login should succeed').toBeTruthy();
  const body = await res.json();
  const token = body?.data?.token || body?.token;
  const user = body?.data?.user || body?.user;
  expect(token, 'token returned').toBeTruthy();
  expect(user, 'user returned').toBeTruthy();

  await page.addInitScript((args: { token: string; user: unknown }) => {
    localStorage.setItem('condoos_token', args.token);
    localStorage.setItem('condoos_user', JSON.stringify(args.user));
  }, { token, user });
}

for (const locale of Object.keys(expectations) as Array<keyof typeof expectations>) {
  test(`board agent chrome is fully localized (${locale})`, async ({ page }) => {
    await setLocale(page, locale);
    await loginAsAdmin(page);
    await page.goto('/board/agent', { waitUntil: 'domcontentloaded' });

    const copy = expectations[locale];
    await expect(page.getByRole('button', { name: copy.generatePlan })).toBeVisible();
    await expect(page.getByText(copy.addContext)).toBeVisible();
    await expect(page.getByText(copy.historyHint)).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\borçamento\b/iu);
    expect(bodyText).not.toMatch(/\bhistórico\b/iu);
    expect(bodyText).not.toMatch(/\bGerar plano\b/iu);
    expect(bodyText).not.toMatch(/\badicionar contexto\b/iu);
    expect(bodyText).not.toMatch(/usa seu histórico do prédio/iu);
  });
}
