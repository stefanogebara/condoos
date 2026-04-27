import { test, expect } from '@playwright/test';

test('Landing CTAs route by intent', async ({ page }) => {
  await page.goto('/');
  // Hero "Sou síndico" CTA
  const sindico = page.getByRole('link', { name: /Sou síndico — montar meu prédio/ }).first();
  await expect(sindico).toBeVisible();
  expect(await sindico.getAttribute('href')).toBe('/login?intent=create');

  const morador = page.getByRole('link', { name: /Sou morador — tenho um código/ }).first();
  expect(await morador.getAttribute('href')).toBe('/login?intent=join');

  const demo = page.getByRole('link', { name: /Só explorar/ }).first();
  expect(await demo.getAttribute('href')).toBe('/login?intent=demo');
});

test('Landing forwards ?code= into the join CTA', async ({ page }) => {
  await page.goto('/?code=ABC123');
  const morador = page.getByRole('link', { name: /Sou morador — tenho um código/ }).first();
  expect(await morador.getAttribute('href')).toBe('/login?intent=join&code=ABC123');
});

test('Login page shows intent banner when ?intent=create', async ({ page }) => {
  await page.goto('/login?intent=create');
  await expect(page.getByText(/Sou síndico/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Vamos montar seu prédio/ })).toBeVisible();
});

test('Login page shows detected code when ?intent=join&code=', async ({ page }) => {
  await page.goto('/login?intent=join&code=AB12CD');
  await expect(page.getByText(/Tenho um código/)).toBeVisible();
  await expect(page.getByText(/Código detectado: AB12CD/)).toBeVisible();
});
