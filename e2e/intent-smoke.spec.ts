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
  await expect(page.getByText(
    /Sou síndico|I am the board admin|Soy administrador|Je suis syndic|Acesso privado aprovado|Approved private access|Acceso privado aprobado|Accès privé approuvé/i,
  )).toBeVisible();
  await expect(page.getByRole('heading', {
    name: /Vamos montar seu prédio|Let.s set up your building|Vamos a configurar tu edificio|Configurons votre immeuble|Ative seu prédio aprovado|Activate your approved building|Activa tu edificio aprobado|Activez votre immeuble approuvé/i,
  })).toBeVisible();
});

test('Login page shows detected code when ?intent=join&code=', async ({ page }) => {
  await gotoApp(page, '/login?intent=join&code=AB12CD');
  await expect(page.getByText(/Tenho um código|I have a code|Tengo un código|J.ai un code/i)).toBeVisible();
  await expect(page.getByText(/(Código detectado|Code detected|Code détecté)\s*:?\s*AB12CD/i)).toBeVisible();
});

test('Login exposes signup path for residents with invite codes', async ({ page }) => {
  await gotoApp(page, '/login?intent=join&code=AB12CD');
  const signup = page.locator('a[href="/signup?intent=join&code=AB12CD"]').first();
  await expect(signup).toBeVisible();
  await expect(signup).toContainText(/Criar conta com código|Create account with code|Crear cuenta con código|Créer un compte avec un code/i);
});

test('Signup with invite code creates account and lands on join flow', async ({ page }) => {
  await gotoApp(page, '/signup?intent=join&code=DEMO123');
  const tag = Date.now();
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('E2E');
  await page.getByRole('textbox', { name: 'Sobrenome', exact: true }).fill('Signup');
  await page.getByRole('textbox', { name: /Email/i }).fill(`e2e+signup-${tag}@condoos.test`);
  await page.getByLabel(/Senha|Password|Contraseña/i).fill('signup-pass-12345');
  await page.getByRole('textbox', { name: /Código de convite|Invite code/i }).fill('DEMO123');
  await page.getByRole('button', { name: /Criar conta e entrar|Create account and join|Crear cuenta y unirme/i }).click();
  await expect(page).toHaveURL(/\/onboarding\/join\?code=DEMO123/);
  await expect(page.getByRole('heading', { name: /Insira o código de convite|Enter the invite code|Ingresa el código de invitación/i })).toBeVisible();
});

test('Signup manual form explains short passwords without generic failure', async ({ page }) => {
  await gotoApp(page, '/signup?intent=join&code=DEMO123');
  const tag = Date.now();
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('E2E');
  await page.getByRole('textbox', { name: 'Sobrenome', exact: true }).fill('Short');
  await page.getByRole('textbox', { name: /Email/i }).fill(`e2e+short-${tag}@condoos.test`);
  await page.getByLabel(/Senha|Password|Contraseña/i).fill('short');
  await page.getByRole('button', { name: /Criar conta e entrar|Create account and join|Crear cuenta y unirme/i }).click();
  await expect(page.getByText(/Use uma senha com pelo menos 12 caracteres|Use a password with at least 12 characters|Usa una contraseña de al menos 12 caracteres/i)).toBeVisible();
  await expect(page.getByText(/No se pudo crear la cuenta|Falha ao criar conta|Could not create account/i)).toHaveCount(0);
});

test.describe('Spanish signup entry points', () => {
  test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

  test('login and signup explain the invite-code account path in Spanish', async ({ page }) => {
    await gotoApp(page, '/login?intent=join&code=AB12CD');
    await expect(page.getByText('¿Nuevo en CondoOS?')).toBeVisible();
    await expect(page.getByRole('link', { name: /Crear cuenta con código/i })).toBeVisible();

    await gotoApp(page, '/signup?intent=join&code=AB12CD');
    await expect(page.getByRole('heading', { name: /Crea tu cuenta para unirte/i })).toBeVisible();
    await expect(page.getByPlaceholder(/contraseña de 12\+ caracteres/i)).toBeVisible();
  });
});
