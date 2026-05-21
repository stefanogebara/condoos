// Verify the root URL renders the Landing hero in three states:
// logged out, logged in as resident with membership, and logged in
// as board admin. Confirms the auth-aware nav CTA wording.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const apiURL = process.env.E2E_API_URL || 'https://condoos-api.fly.dev/api';
const adminEmail = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@condoos.test';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'e2e-prod-fixed-passphrase-2026';
const residentEmail = process.env.E2E_RESIDENT_EMAIL || 'e2e-resident@condoos.test';
const residentPassword = process.env.E2E_RESIDENT_PASSWORD || 'e2e-prod-fixed-passphrase-2026';
const SHOT_DIR = path.join('test-results', 'hero-restore');
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function login(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).data;
}
async function setSession(page: Page, session: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('hero — logged out renders Landing with Entrar CTA', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText(/Seu condomínio/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /^Entrar/i }).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, 'hero-logged-out.png'), fullPage: false });
});

test('hero — logged in board admin renders Landing with painel CTA', async ({ page, request }) => {
  const admin = await login(request, adminEmail, adminPassword);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, admin);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText(/Seu condomínio/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /Ir para o painel/i }).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, 'hero-admin.png'), fullPage: false });
});

test('hero — logged in resident renders Landing with app CTA', async ({ page, request }) => {
  const resident = await login(request, residentEmail, residentPassword);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, resident);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText(/Seu condomínio/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /Ir para o app|Continuar cadastro/i }).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, 'hero-resident.png'), fullPage: false });
});
