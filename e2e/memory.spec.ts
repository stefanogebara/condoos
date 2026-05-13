import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');

type Session = { token: string; user: any };

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

async function setSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('admin searches Building Memory across vendors and expenses', async ({ page, request }) => {
  const admin = await loginApi(request, 'admin@condoos.dev', 'admin123');
  await setSession(page, admin);

  await page.goto('/board/memory');
  await expect(page.getByRole('heading', { name: /Building Memory|Memória do prédio|Memoria del edificio/i })).toBeVisible();

  await page.getByTestId('memory-search-input').fill('Cool Breeze');
  await page.getByTestId('memory-search-submit').click();
  await expect(page.getByTestId('memory-results')).toBeVisible();
  await expect(page.getByText(/Cool Breeze/i).first()).toBeVisible();
  await expect(page.getByTestId('memory-result-expense').first()).toBeVisible();
});
