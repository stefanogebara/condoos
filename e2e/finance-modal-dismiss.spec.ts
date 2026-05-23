import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor, hasExplicitCredentialsFor, isProdE2ETarget } from './support/credentials';
import { gotoApp } from './support/navigation';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

function skipIfMissingProdCredentials(role: 'admin') {
  if (!isProdE2ETarget()) return;
  test.skip(
    !hasExplicitCredentialsFor(role),
    'requires explicit production admin credentials; prod blocks seeded demo credentials',
  );
}

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const res = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  const session = (await res.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

async function adminLogin(page: Page, request: APIRequestContext): Promise<Session> {
  const creds = credentialsFor('admin');
  const session = await loginApi(request, creds.email, creds.password);
  await gotoApp(page, '/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
  return session;
}

async function openInvoiceCount(request: APIRequestContext, admin: Session): Promise<number> {
  const res = await request.get(`${apiURL}/finance/receivables`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(res.ok(), `receivables failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return Number(((await res.json()).data as { open_invoice_count?: number }).open_invoice_count || 0);
}

async function ensureLocalOpenInvoice(request: APIRequestContext, admin: Session): Promise<boolean> {
  if (await openInvoiceCount(request, admin) > 0) return true;
  if (isProdE2ETarget()) return false;

  const residentCreds = credentialsFor('resident');
  const resident = await loginApi(request, residentCreds.email, residentCreds.password);
  const membershipsRes = await request.get(`${apiURL}/onboarding/me`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  expect(membershipsRes.ok(), `membership lookup failed: ${membershipsRes.status()} ${await membershipsRes.text()}`).toBeTruthy();
  const membership = ((await membershipsRes.json()).data as Array<{ unit_id: number; status: string }>).find((row) => row.status === 'active');
  expect(membership?.unit_id, 'resident active unit').toBeTruthy();

  const scheduleRes = await request.post(`${apiURL}/finance/schedules`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: {
      name: `E2E modal dismiss ${Date.now()}`,
      amount_cents: 1234,
      currency: 'BRL',
      frequency: 'monthly',
      due_day: 10,
    },
  });
  expect(scheduleRes.ok(), `schedule create failed: ${scheduleRes.status()} ${await scheduleRes.text()}`).toBeTruthy();
  const scheduleId = (await scheduleRes.json()).data.id as number;

  const invoiceRes = await request.post(`${apiURL}/finance/invoices`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: {
      schedule_id: scheduleId,
      period: '2099-06',
      unit_ids: [membership!.unit_id],
    },
  });
  expect(invoiceRes.ok(), `invoice create failed: ${invoiceRes.status()} ${await invoiceRes.text()}`).toBeTruthy();
  expect(((await invoiceRes.json()).data.invoice_ids as number[])[0], 'invoice id').toBeTruthy();
  return true;
}

const labels = {
  financeHeading: /^(Finanças|Finance|Finanzas|Finances)$/i,
  receivablesHeading: /Cobranças e pagamentos|Charges and payments|Cobros y pagos|Appels et paiements/i,
  recordPaymentButton: /Registrar pago|Record payment|Enregistrer le paiement/i,
  recordPaymentModal: /Registrar pagamento|Record payment|Enregistrer le paiement/i,
};

async function clickBackdrop(page: Page) {
  const backdrop = page.locator('div.fixed.inset-0.z-50').last();
  await expect(backdrop).toBeVisible();
  const box = await backdrop.boundingBox();
  if (!box) throw new Error('payment modal backdrop has no bounding box');
  await page.mouse.click(box.x + 24, box.y + 24);
}

test('board finance payment modal dismisses with Escape and backdrop without submitting', async ({ page, request }) => {
  skipIfMissingProdCredentials('admin');

  const admin = await adminLogin(page, request);
  const hasReceivableToOpen = await ensureLocalOpenInvoice(request, admin);
  test.skip(!hasReceivableToOpen, 'no open invoice is available to open the manual payment modal safely');

  await gotoApp(page, '/board/financas');
  await expect(page.getByRole('heading', { name: labels.financeHeading }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: labels.receivablesHeading }).first()).toBeVisible({ timeout: 15_000 });

  const payButton = page.getByRole('button', { name: labels.recordPaymentButton }).first();
  await expect(payButton).toBeVisible({ timeout: 15_000 });
  await payButton.scrollIntoViewIfNeeded();
  await payButton.click();
  const modalHeading = page.getByRole('heading', { name: labels.recordPaymentModal }).first();
  await expect(modalHeading).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(modalHeading).toBeHidden();
  await expect(payButton).toBeVisible();

  await payButton.scrollIntoViewIfNeeded();
  await payButton.click();
  await expect(modalHeading).toBeVisible();
  await clickBackdrop(page);
  await expect(modalHeading).toBeHidden();
  await expect(payButton).toBeVisible();
});
