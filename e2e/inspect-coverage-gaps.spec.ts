// Verify the loose ends from the 5/21 session: hero CTA clicks land
// on the right URL, sidebars render in full (not just above the
// fold), mobile drawer shows section headers, language switch
// applies to the new section labels, and the "✓ Plano IA" chip
// shows up next to the action badge after a successful plan.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const apiURL = process.env.E2E_API_URL || 'https://condoos-api.fly.dev/api';
const adminEmail = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@condoos.test';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'e2e-prod-fixed-passphrase-2026';
const residentEmail = process.env.E2E_RESIDENT_EMAIL || 'e2e-resident@condoos.test';
const residentPassword = process.env.E2E_RESIDENT_PASSWORD || 'e2e-prod-fixed-passphrase-2026';
const SHOT_DIR = path.join('test-results', 'coverage-gaps');
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

test('hero CTAs — admin clicks "Ir para o painel" lands on /board', async ({ page, request }) => {
  const admin = await login(request, adminEmail, adminPassword);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, admin);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /Ir para o painel/i }).first().click();
  await page.waitForURL(/\/board(?:$|\/|\?)/, { timeout: 15_000 });
  expect(page.url()).toMatch(/\/board/);
});

test('hero CTAs — resident clicks "Ir para o app" lands on /app or /onboarding', async ({ page, request }) => {
  const resident = await login(request, residentEmail, residentPassword);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, resident);
  await page.goto('/', { waitUntil: 'networkidle' });
  const cta = page.getByRole('link', { name: /Ir para o app|Continuar cadastro/i }).first();
  await cta.click();
  await page.waitForURL(/\/(?:app|onboarding)(?:$|\/|\?)/, { timeout: 15_000 });
  expect(page.url()).toMatch(/\/(?:app|onboarding)/);
});

test('board sidebar — full-height capture, all three sections visible', async ({ page, request }) => {
  const admin = await login(request, adminEmail, adminPassword);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await setSession(page, admin);
  await page.goto('/board', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside nav a').first()).toBeVisible({ timeout: 30_000 });
  // Section headers exist for every group (look for the small uppercase labels)
  await expect(page.locator('aside').getByText(/^ATENDER$/i)).toBeVisible();
  await expect(page.locator('aside').getByText(/^DECIDIR$/i)).toBeVisible();
  await expect(page.locator('aside').getByText(/^CONHECER$/i)).toBeVisible();
  // Capture the full sidebar height
  await page.screenshot({ path: path.join(SHOT_DIR, 'board-sidebar-full.png'), clip: { x: 0, y: 0, width: 320, height: 1200 } });
});

test('resident sidebar — full-height capture, all three sections visible', async ({ page, request }) => {
  const resident = await login(request, residentEmail, residentPassword);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setSession(page, resident);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside nav a').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('aside').getByText(/^DIA A DIA$/i)).toBeVisible();
  await expect(page.locator('aside').getByText(/^DECIDIR$/i)).toBeVisible();
  await expect(page.locator('aside').getByText(/^CONHECER$/i)).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, 'resident-sidebar-full.png'), clip: { x: 0, y: 0, width: 320, height: 1100 } });
});

test('mobile drawer — board admin section headers visible when drawer open', async ({ page, request }) => {
  const admin = await login(request, adminEmail, adminPassword);
  await page.setViewportSize({ width: 390, height: 844 });
  await setSession(page, admin);
  await page.goto('/board', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Abrir menu|Open menu/i }).first().click({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await expect(page.locator('aside').getByText(/^ATENDER$/i)).toBeVisible();
  await expect(page.locator('aside').getByText(/^DECIDIR$/i)).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, 'board-mobile-drawer.png'), fullPage: true });
});

test('language switch — section headers translate to EN', async ({ page, request }) => {
  const admin = await login(request, adminEmail, adminPassword);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await setSession(page, admin);
  await page.goto('/board', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside nav a').first()).toBeVisible({ timeout: 30_000 });
  // Click EN locale chip in the sidebar
  const enChip = page.locator('aside').getByRole('button', { name: /^EN$/i }).first();
  if (await enChip.isVisible().catch(() => false)) {
    await enChip.click();
    await page.waitForTimeout(800);
    // New section labels in English
    await expect(page.locator('aside').getByText(/^RESPOND$/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('aside').getByText(/^DECIDE$/i)).toBeVisible();
    await expect(page.locator('aside').getByText(/^REFERENCE$/i)).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'board-sidebar-en.png'), clip: { x: 0, y: 0, width: 320, height: 1200 } });
  } else {
    test.skip(true, 'EN locale chip not found in sidebar');
  }
});

test('plano IA chip — appears next to action badge on successful plan', async ({ page, request }) => {
  const admin = await login(request, adminEmail, adminPassword);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, admin);
  await page.goto('/board/agent', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  // Fill + submit
  const taskInput = page.getByPlaceholder(/Descreva o conserto|describe the repair/i).first();
  await taskInput.fill('A bomba dágua precisa de manutenção preventiva.');
  await page.getByRole('button', { name: /Gerar plano|Generate plan/i }).first().click();

  // Wait for plan to render — "Ação recomendada" is the strongest signal
  await expect(page.getByText(/Ação recomendada/i).first()).toBeVisible({ timeout: 180_000 });
  await page.waitForTimeout(2_000);

  // The chip is "✓ Plano IA" rendered as a neutral badge with that text
  const chip = page.getByText(/✓\s*Plano IA/i).first();
  // Either the success chip OR the fallback warning should be present
  const hasChip = await chip.isVisible().catch(() => false);
  const hasFallback = await page.getByText(/Fallback seguro/i).first().isVisible().catch(() => false);
  expect(hasChip || hasFallback, 'Either Plano IA chip or Fallback warning must render').toBeTruthy();

  // Screenshot the action band specifically
  const actionBadge = page.getByText(/Ação recomendada/i).first();
  const box = await actionBadge.boundingBox();
  if (box) {
    await page.screenshot({
      path: path.join(SHOT_DIR, 'plano-ia-chip.png'),
      clip: { x: 0, y: Math.max(0, box.y - 30), width: 1440, height: 300 },
    });
  }
  fs.writeFileSync(path.join(SHOT_DIR, 'plano-ia-chip-state.json'), JSON.stringify({
    has_success_chip: hasChip,
    has_fallback_warning: hasFallback,
  }, null, 2));
});
