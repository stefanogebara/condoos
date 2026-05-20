// Login auto-routing smoke. Verifies:
//   1. Landing page exposes the "Já tem conta?" lane prominently in
//      the hero (new — used to only have signup-flavored CTAs).
//   2. Clicking that link lands on /login with no intent param —
//      returning users get the clean form-first page.
//   3. /login without a session renders the form (no redirect).
//   4. /login WITH a session (token in localStorage) redirects to
//      the role-appropriate dashboard. Skipped when no test creds
//      are available — the API path needs E2E_ADMIN_EMAIL/PASSWORD
//      since prod blocks the seeded admin@condoos.dev creds.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@condoos.dev';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'admin123';
const residentEmail = process.env.E2E_RESIDENT_EMAIL || 'resident@condoos.dev';
const residentPassword = process.env.E2E_RESIDENT_PASSWORD || 'resident123';

type Session = { token: string; user: any };

async function tryLogin(request: APIRequestContext, email: string, password: string): Promise<Session | null> {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  if (!res.ok()) return null;
  return (await res.json()).data as Session;
}

async function setSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('landing hero exposes "Já tem conta? Entre direto" link to /login', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: /Entre direto no seu prédio/i });
  await expect(link).toBeVisible({ timeout: 10_000 });
  // Click and verify it lands on /login with NO intent param. The
  // returning-user lane mustn't be biased toward create or join.
  await link.click();
  await expect(page).toHaveURL(/\/login(?!\?intent=)/);
});

test('/login without a session renders the login form (no redirect)', async ({ page }) => {
  // Make sure localStorage is clean — the visit to / above may have
  // cached something. Going to /login directly with no token should
  // render the form.
  await page.goto('/login');
  // The form has email + password inputs and an "Entrar" button.
  await expect(page.getByRole('textbox', { name: /voce@predio|email|e-mail/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /^Entrar$/ })).toBeVisible();
});

test('/login WITH a session auto-redirects to the role dashboard (admin → /board)', async ({ page, request }) => {
  const admin = await tryLogin(request, adminEmail, adminPassword);
  test.skip(!admin, `admin creds (E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD) not available on this run — prod blocks demo creds`);

  await setSession(page, admin!);
  // Navigate to /login while already authenticated. Should auto-
  // redirect to the role's dashboard within a couple ticks. Even
  // with an intent param (the regression case the user complained
  // about) the auto-redirect should fire.
  await page.goto('/login?intent=create');
  await expect(page).toHaveURL(/\/(board|onboarding\/create)/, { timeout: 10_000 });
});

test('/login WITH a resident session + active membership auto-redirects to /app (no join wizard)', async ({ page, request }) => {
  const resident = await tryLogin(request, residentEmail, residentPassword);
  test.skip(!resident, `resident creds not available on this run`);

  await setSession(page, resident!);
  // Even with intent=join (the regression case — returning morador
  // clicks "Sou morador" on the hero), the auto-redirect should
  // route them to /app because they already have a membership,
  // NOT through the join wizard at /onboarding/join.
  await page.goto('/login?intent=join');
  await expect(page).toHaveURL(/\/app(?!.*onboarding)/, { timeout: 10_000 });
});
