import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

const apiURL = process.env.E2E_API_URL || 'http://localhost:4312/api';

async function loginApi(request: APIRequestContext, email: string, password: string) {
  const response = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as { token: string; user: Record<string, unknown> };
}

async function loginInBrowser(page: Page, request: APIRequestContext, kind: 'admin' | 'resident') {
  const credentials = kind === 'admin'
    ? ['admin@condoos.dev', 'admin123']
    : ['resident@condoos.dev', 'resident123'];
  const session = await loginApi(request, credentials[0], credentials[1]);
  await page.goto('/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('signed-out landing, login, route guard, and mobile drawer work', async ({ page, request, isMobile }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Run your building, softly/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible();

  await loginInBrowser(page, request, 'resident');
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Maya/i })).toBeVisible();
  await page.goto('/board');
  await expect(page).toHaveURL(/\/app$/);

  if (isMobile) {
    await expect(page.getByRole('button', { name: /Open menu/i })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
});

test('board roster import creates pending invite and invite links prefill join code', async ({ page, request }) => {
  await loginInBrowser(page, request, 'admin');
  await page.goto('/board/residents');
  await expect(page.getByRole('heading', { name: /Residents/i })).toBeVisible();

  await page.getByRole('button', { name: /Import roster/i }).click();
  const email = `e2e-${Date.now()}@example.com`;
  await page.locator('textarea').fill(`email,unit,relationship,primary_contact,voting_weight\n${email},502,tenant,no,1`);
  await page.getByRole('button', { name: /Create invites/i }).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/Rows that need attention/i)).toHaveCount(0);

  await page.goto('/onboarding/join?code=DEMO123');
  await expect(page.locator('input').first()).toHaveValue('DEMO123');
});

test('backend rejects invalid bookings and closes tied manual decisions as inconclusive', async ({ request }) => {
  const resident = await loginApi(request, 'resident@condoos.dev', 'resident123');
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');

  const amenities = await request.get(`${apiURL}/amenities`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  const pool = (await amenities.json()).data.find((a: any) => a.name === 'Rooftop Pool');

  const invalidBooking = await request.post(`${apiURL}/amenities/reservations`, {
    headers: { Authorization: `Bearer ${resident.token}` },
    data: {
      amenity_id: pool.id,
      starts_at: '2026-05-10T20:00:00.000Z',
      ends_at: '2026-05-10T19:00:00.000Z',
    },
  });
  expect(invalidBooking.status()).toBe(400);
  expect((await invalidBooking.json()).error).toBe('ends_must_be_after_starts');

  const created = await request.post(`${apiURL}/proposals`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { title: 'E2E tied proposal', description: 'Temporary E2E proposal', category: 'QA' },
  });
  const proposalId = (await created.json()).data.id;
  await request.post(`${apiURL}/proposals/${proposalId}/status`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { status: 'voting' },
  });
  await request.post(`${apiURL}/proposals/${proposalId}/vote`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { choice: 'yes' },
  });
  await request.post(`${apiURL}/proposals/${proposalId}/vote`, {
    headers: { Authorization: `Bearer ${resident.token}` },
    data: { choice: 'no' },
  });
  await request.post(`${apiURL}/ai/proposals/${proposalId}/decision-summary`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  const detail = await request.get(`${apiURL}/proposals/${proposalId}`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect((await detail.json()).data.status).toBe('inconclusive');
});

test('assembly pages render for board and resident', async ({ page, request }) => {
  await loginInBrowser(page, request, 'admin');
  await page.goto('/board/assemblies');
  await expect(page.getByRole('heading', { name: /Assemblies/i })).toBeVisible();

  await loginInBrowser(page, request, 'resident');
  await page.goto('/app/assemblies');
  await expect(page.getByRole('heading', { name: /Assemblies/i })).toBeVisible();
});
