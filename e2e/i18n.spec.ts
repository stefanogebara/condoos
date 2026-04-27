import { expect, test } from '@playwright/test';

test.describe('locale auto-detection', () => {
  test.use({ locale: 'en-US' });

  test('renders public and login copy in English for en-US browsers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your condo,/i })).toBeVisible();
    await expect(page.getByText(/at peace\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Sign in$/i }).first()).toBeVisible();

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByText(/Sign in to your building/i)).toBeVisible();
  });
});

test.describe('Spanish locale', () => {
  test.use({ locale: 'es-ES' });

  test('renders key public copy in Spanish for es-ES browsers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Tu condominio,/i })).toBeVisible();
    await expect(page.getByText(/en paz\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Entrar$/i }).first()).toBeVisible();
    await expect(page.getByText(/Probar la demo/i)).toBeVisible();
  });
});

test.describe('French locale', () => {
  test.use({ locale: 'fr-FR' });

  test('renders key public copy in French for fr-FR browsers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Votre copropriété,/i })).toBeVisible();
    await expect(page.getByText(/en paix\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Connexion$/i }).first()).toBeVisible();
    await expect(page.getByText(/Essayer la démo/i)).toBeVisible();
  });
});
