import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4316/api');

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

async function adminLogin(page: Page, request: APIRequestContext) {
  const credentials = credentialsFor('admin');
  const s = await loginApi(request, credentials.email, credentials.password);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, s);
}

test('admin: monthly board packet renders and exports', async ({ page, request }) => {
  await adminLogin(page, request);
  await page.goto('/board/reports');

  await expect(page.getByRole('heading', { level: 1, name: /Reports|Relatórios|Informes/i })).toBeVisible();
  await expect(page.getByTestId('board-packet-page')).toBeVisible();
  await expect(page.getByText(/Executive summary|Resumo executivo|Resumen ejecutivo/i)).toBeVisible();
  await expect(page.getByText(/Risks and next steps|Riscos e próximos passos|Riesgos y próximos pasos/i)).toBeVisible();
  await expect(page.getByText(/Finance|Finanças|Finanzas/i).first()).toBeVisible();

  await page.getByTestId('board-packet-copy').click();
  await expect(page.getByText(/Packet copied|Pacote copiado|Paquete copiado/i)).toBeVisible();
  await expect(page.getByTestId('board-packet-download')).toBeVisible();
  await expect(page.getByTestId('board-packet-pdf')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('board-packet-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/condoos-board-packet-.+\.pdf$/);
});
