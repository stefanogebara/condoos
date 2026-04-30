import { test, expect } from '@playwright/test';
import { gotoApp } from './support/navigation';

test('Landing CTAs route by intent', async ({ page }) => {
  await gotoApp(page, '/');

  const sindico = page.locator('a[href="/login?intent=create"]').first();
  await expect(sindico).toBeVisible();

  const morador = page.locator('a[href="/login?intent=join"]').first();
  await expect(morador).toBeVisible();

  const demo = page.locator('a[href="/login?intent=demo"]').first();
  await expect(demo).toBeVisible();
});

test('Landing forwards ?code= into the join CTA', async ({ page }) => {
  await gotoApp(page, '/?code=ABC123');
  await expect(page.locator('a[href="/login?intent=join&code=ABC123"]').first()).toBeVisible();
});

test('Login page shows intent banner when ?intent=create', async ({ page }) => {
  await gotoApp(page, '/login?intent=create');
  await expect(page.getByText(/Sou síndico|I am the board admin|Soy administrador|Je suis syndic/i)).toBeVisible();
  await expect(page.getByRole('heading', {
    name: /Vamos montar seu prédio|Let.s set up your building|Vamos a configurar tu edificio|Configurons votre immeuble/i,
  })).toBeVisible();
});

test('Login page shows detected code when ?intent=join&code=', async ({ page }) => {
  await gotoApp(page, '/login?intent=join&code=AB12CD');
  await expect(page.getByText(/Tenho um código|I have a code|Tengo un código|J.ai un code/i)).toBeVisible();
  await expect(page.getByText(/(Código detectado|Code detected|Code détecté)\s*:?\s*AB12CD/i)).toBeVisible();
});
