import { expect, test } from '@playwright/test';
import { gotoApp } from './support/navigation';

test.describe('locale auto-detection', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

  test('renders public and login copy in English for US location', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { name: /Your condo,/i })).toBeVisible();
    await expect(page.getByText(/at peace\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Sign in$/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /I manage a building/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /I am a resident/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Just explore \(demo\)/i }).first()).toBeVisible();
    await expect(page.getByText(/^Mon$/).first()).toBeVisible();
    await expect(page.getByText(/built in a hackathon/i)).toBeVisible();
    await expect(page.getByText(/Sou síndico/i)).toHaveCount(0);
    await expect(page.getByText(/^Seg$/)).toHaveCount(0);

    await gotoApp(page, '/login');
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByText(/Sign in to your building/i)).toBeVisible();
  });
});

test.describe('Spanish locale', () => {
  test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

  test('renders key public copy in Spanish for Spain location', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { name: /Tu condominio,/i })).toBeVisible();
    await expect(page.getByText(/en paz\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Entrar$/i }).first()).toBeVisible();
    await expect(page.getByText(/Probar la demo/i)).toBeVisible();
  });
});

test.describe('French locale', () => {
  test.use({ locale: 'fr-FR', timezoneId: 'Europe/Paris' });

  test('renders key public copy in French for France location', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { name: /Votre copropriété,/i })).toBeVisible();
    await expect(page.getByText(/en paix\./i)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Connexion$/i }).first()).toBeVisible();
    await expect(page.getByText(/Essayer la démo/i)).toBeVisible();
  });
});

test.describe('location priority', () => {
  test.use({ locale: 'pt-BR', timezoneId: 'Europe/Paris' });

  test('prefers location over browser language before manual override', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { name: /Votre copropriété,/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Localisation utilisée/i })).toBeVisible();
  });
});

test.describe('manual language switcher', () => {
  test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

  test('lets users override the detected language', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { name: /Seu condomínio,/i })).toBeVisible();

    await page.locator('select[aria-label]').selectOption('en-US');
    await expect(page.getByRole('heading', { name: /Your condo,/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Use location/i })).toBeVisible();
  });
});

test.describe('precise location reset', () => {
  test.use({
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  test('uses browser geolocation when the user asks to return to location mode', async ({ page }) => {
    await page.addInitScript(() => {
      const position = {
        coords: {
          latitude: -23.55052,
          longitude: -46.633308,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };

      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(success: (position: unknown) => void) {
            success(position);
          },
          watchPosition(success: (position: unknown) => void) {
            success(position);
            return 1;
          },
          clearWatch() {},
        },
      });
    });

    await gotoApp(page, '/');
    await page.locator('select[aria-label]').selectOption('fr-FR');
    await expect(page.getByRole('heading', { name: /Votre copropriété,/i })).toBeVisible();

    await page.getByRole('button', { name: /Utiliser la localisation/i }).click();
    await expect(page.getByRole('heading', { name: /Seu condomínio,/i })).toBeVisible();
  });
});
