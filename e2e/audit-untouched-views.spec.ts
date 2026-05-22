// Capture screenshots of the views we haven't UX-audited yet:
// /board/memory, /board/reports, /board/financas, /board/edificio,
// and /concierge. Desktop + mobile each. Outputs land in
// test-results/untouched-views/ for review.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');
const adminCredentials = credentialsFor('admin');
const conciergeCredentials = credentialsFor('concierge');
const SHOT_DIR = path.join('test-results', 'untouched-views');
fs.mkdirSync(SHOT_DIR, { recursive: true });

// Share sessions across tests to stay under the auth rate limit
// (30 logins per 15min per IP). Without this, 10 tests = 10 logins
// and a second run inside the same window blows the budget.
const sessionCache = new Map<string, any>();
async function login(request: APIRequestContext, email: string, password: string) {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  const session = (await res.json()).data;
  sessionCache.set(email, session);
  return session;
}
async function setSession(page: Page, session: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

const BOARD_VIEWS = [
  { path: '/board/memory',    slug: 'memory' },
  { path: '/board/reports',   slug: 'reports' },
  { path: '/board/financas',  slug: 'financas' },
  { path: '/board/edificio',  slug: 'edificio' },
];

for (const view of BOARD_VIEWS) {
  test(`board ${view.slug} — desktop`, async ({ page, request }) => {
    const admin = await login(request, adminCredentials.email, adminCredentials.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setSession(page, admin);
    await page.goto(view.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: path.join(SHOT_DIR, `${view.slug}-desktop.png`), fullPage: true });
    // Console errors / warnings
    const consoleEntries: Array<{ type: string; text: string }> = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleEntries.push({ type: m.type(), text: m.text() }); });
    await page.waitForTimeout(500);
    fs.writeFileSync(path.join(SHOT_DIR, `${view.slug}-console.json`), JSON.stringify(consoleEntries, null, 2));
  });

  test(`board ${view.slug} — mobile`, async ({ page, request }) => {
    const admin = await login(request, adminCredentials.email, adminCredentials.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await setSession(page, admin);
    await page.goto(view.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: path.join(SHOT_DIR, `${view.slug}-mobile.png`), fullPage: true });
  });
}

test('concierge — desktop', async ({ page, request }) => {
  const concierge = await login(request, conciergeCredentials.email, conciergeCredentials.password);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, concierge);
  await page.goto('/concierge', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'concierge-desktop.png'), fullPage: true });
});

test('concierge — mobile', async ({ page, request }) => {
  const concierge = await login(request, conciergeCredentials.email, conciergeCredentials.password);
  await page.setViewportSize({ width: 390, height: 844 });
  await setSession(page, concierge);
  await page.goto('/concierge', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'concierge-mobile.png'), fullPage: true });
});
