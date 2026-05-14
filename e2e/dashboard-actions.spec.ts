import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

type Session = { token: string; user: any };

async function login(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data as Session;
}

async function installSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

test('dashboard actions: role-scoped API drives resident, admin, and guard command centers', async ({ page, request }) => {
  const resident = await login(request, 'resident@condoos.dev', 'resident123');
  const admin = await login(request, 'admin@condoos.dev', 'admin123');
  const concierge = await login(request, 'porteiro@condoos.dev', 'porteiro123');

  for (const session of [resident, admin, concierge]) {
    const response = await request.get(`${apiURL}/dashboard/actions`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(response.ok(), `dashboard failed for ${session.user.role}: ${response.status()} ${await response.text()}`).toBeTruthy();
    const data = (await response.json()).data;
    expect(data.role).toBe(session.user.role);
    expect(Array.isArray(data.actions)).toBeTruthy();
    expect(data.actions.length).toBeGreaterThan(0);
    expect(typeof data.unread_count).toBe('number');
  }

  await installSession(page, resident);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Today in your unit|Hoje na sua unidade|Hoy en tu unidad|Aujourd’hui/i })).toBeVisible();
  await expect(page.getByText(/Fast actions|Ações rápidas|Acciones rápidas|Actions rapides/i)).toBeVisible();

  await installSession(page, admin);
  await page.goto('/board');
  await expect(page.getByRole('heading', { name: /Command center|Central de comando|Centro de comando|Centro de mando/i })).toBeVisible();

  await installSession(page, concierge);
  await page.goto('/board/concierge');
  await expect(page.getByRole('heading', { name: /Front desk command|Comando da portaria|Comando de portaria|Comando de portería/i })).toBeVisible();
});
