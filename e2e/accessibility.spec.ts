import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor } from './support/credentials';
import { gotoApp } from './support/navigation';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

async function seedSession(page: Page, request: APIRequestContext, kind: 'admin' | 'resident' | 'concierge') {
  const creds = credentialsFor(kind);
  const session = await loginApi(request, creds.email, creds.password);
  await gotoApp(page, '/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

function formatViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.map((v) => {
    const nodes = v.nodes.slice(0, 4).map((n) => `    - ${n.target.join(' ')}: ${n.failureSummary || 'no summary'}`).join('\n');
    return `${v.impact?.toUpperCase() || 'UNKNOWN'} ${v.id}: ${v.help}\n  ${v.helpUrl}\n${nodes}`;
  }).join('\n\n');
}

async function expectNoSeriousA11yViolations(page: Page, label: string) {
  const disabledRules = (process.env.A11Y_DISABLE_RULES || '')
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean);
  const builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  for (const rule of disabledRules) builder.disableRules([rule]);

  const results = await builder.analyze();
  const actionable = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(actionable, `${label} has serious accessibility violations:\n${formatViolations(actionable)}`).toEqual([]);
}

test.describe('accessibility audit', () => {
  test('public pages have no serious WCAG violations', async ({ page }) => {
    test.setTimeout(180_000);
    for (const route of ['/', '/login', '/onboarding']) {
      await test.step(route, async () => {
        await gotoApp(page, route);
        await expect(page.locator('body')).toBeVisible();
        await expectNoSeriousA11yViolations(page, route);
      });
    }
  });

  test('resident app pages have no serious WCAG violations', async ({ page, request }) => {
    test.setTimeout(240_000);
    await seedSession(page, request, 'resident');
    for (const route of ['/app', '/app/proposals', '/app/visitors', '/app/amenities', '/app/settings']) {
      await test.step(route, async () => {
        await gotoApp(page, route);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await expectNoSeriousA11yViolations(page, route);
      });
    }
  });

  test('board and concierge pages have no serious WCAG violations', async ({ page, request }) => {
    test.setTimeout(240_000);
    await seedSession(page, request, 'admin');
    for (const route of ['/board', '/board/proposals', '/board/edificio', '/board/financas', '/board/residents']) {
      await test.step(route, async () => {
        await gotoApp(page, route);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await expectNoSeriousA11yViolations(page, route);
      });
    }

    await seedSession(page, request, 'concierge');
    await gotoApp(page, '/concierge');
    await expect(page.getByText(/Portaria/i).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, '/concierge');
  });
});
