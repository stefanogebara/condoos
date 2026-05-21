// Verify resident sidebar grouping on prod after the 3-section restructure.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const apiURL = process.env.E2E_API_URL || 'https://condoos-api.fly.dev/api';
const residentEmail = process.env.E2E_RESIDENT_EMAIL || 'e2e-resident@condoos.test';
const residentPassword = process.env.E2E_RESIDENT_PASSWORD || 'e2e-prod-fixed-passphrase-2026';
const SHOT_DIR = path.join('test-results', 'resident-sidebar');
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function login(request: APIRequestContext) {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email: residentEmail, password: residentPassword } });
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

test('resident sidebar — 3 grouped sections', async ({ page, request }) => {
  const resident = await login(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setSession(page, resident);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('aside nav a').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({
    path: path.join(SHOT_DIR, 'resident-sidebar.png'),
    clip: { x: 0, y: 0, width: 320, height: 900 },
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'resident-fullpage.png'), fullPage: true });
});
