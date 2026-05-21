// One-off inspection — captures the grouped board sidebar on prod
// after the 3-section restructure. Single test, single screenshot.
//
//   npx playwright test e2e/inspect-sidebar.spec.ts --project=desktop --reporter=line

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const apiURL = process.env.E2E_API_URL || 'https://condoos-api.fly.dev/api';
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const SHOT_DIR = path.join('test-results', 'sidebar-grouping');
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function login(request: APIRequestContext) {
  test.skip(!adminEmail || !adminPassword, 'Set admin production E2E credentials to run this inspection.');
  const res = await request.post(`${apiURL}/auth/login`, { data: { email: adminEmail, password: adminPassword } });
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

test('sidebar — board admin grouped sections (desktop)', async ({ page, request }) => {
  const admin = await login(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, admin);
  // Reload so the freshly-set token is picked up by React + interceptors
  await page.goto('/board', { waitUntil: 'domcontentloaded' });
  // Sidebar is in <aside>. Wait for any nav link to render.
  await expect(page.locator('aside nav a').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  // Clip the sidebar (left rail is 288px / w-72)
  await page.screenshot({
    path: path.join(SHOT_DIR, 'sidebar-grouped.png'),
    clip: { x: 0, y: 0, width: 320, height: 900 },
  });
  // Full page for context
  await page.screenshot({ path: path.join(SHOT_DIR, 'sidebar-grouped-fullpage.png'), fullPage: true });
});

test('sidebar — board admin grouped sections (mobile drawer)', async ({ page, request }) => {
  const admin = await login(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await setSession(page, admin);
  await page.goto('/board', { waitUntil: 'domcontentloaded' });
  // Open the mobile drawer
  const menuBtn = page.getByRole('button', { name: /Abrir menu|Open menu/i }).first();
  await menuBtn.click({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOT_DIR, 'sidebar-mobile-drawer.png'), fullPage: true });
});
