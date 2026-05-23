import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor, hasExplicitCredentialsFor, isProdE2ETarget } from './support/credentials';
import { gotoApp } from './support/navigation';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

type Receivables = {
  units: Array<{ unit_id: number; unit_number: string; building_name: string }>;
  invoices: Array<{
    id: number;
    raw_status: string;
    remaining_cents: number;
    notes: string | null;
  }>;
};

const E2E_NOTE_PREFIX = 'E2E finance modal dismissal';
const E2E_FIXTURE_AMOUNT_CENTS = 1234;
const E2E_FIXTURE_DUE_DATE = '2000-01-01T12:00:00.000Z';

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

async function fetchReceivables(request: APIRequestContext, admin: Session): Promise<Receivables> {
  const res = await request.get(`${apiURL}/finance/receivables`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(res.ok(), `receivables failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Receivables;
}

async function voidInvoice(request: APIRequestContext, admin: Session, invoiceId: number, reason: string) {
  const res = await request.post(`${apiURL}/finance/invoices/${invoiceId}/void`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { reason },
  });
  expect(res.ok(), `void invoice ${invoiceId} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function cleanupE2EInvoices(request: APIRequestContext, admin: Session) {
  const receivables = await fetchReceivables(request, admin);
  const stale = receivables.invoices.filter((invoice) => (
    invoice.notes?.startsWith(E2E_NOTE_PREFIX)
    && invoice.raw_status !== 'void'
    && invoice.remaining_cents > 0
  ));
  for (const invoice of stale) {
    await voidInvoice(request, admin, invoice.id, 'clean stale E2E finance modal fixture');
  }
}

function fixturePeriod(offset: number) {
  const normalized = ((offset % 6000) + 6000) % 6000;
  const year = 2090 + Math.floor(normalized / 12);
  const month = String((normalized % 12) + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function createE2EOpenInvoice(request: APIRequestContext, admin: Session): Promise<number> {
  await cleanupE2EInvoices(request, admin);
  const receivables = await fetchReceivables(request, admin);
  const unit = receivables.units[0];
  expect(unit?.unit_id, 'prod/local E2E condo needs at least one unit for finance fixture').toBeTruthy();

  const seed = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const period = fixturePeriod(seed + attempt);
    const note = `${E2E_NOTE_PREFIX} ${new Date().toISOString()} ${period}`;
    const invoiceRes = await request.post(`${apiURL}/finance/invoices`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        amount_cents: E2E_FIXTURE_AMOUNT_CENTS,
        period,
        due_date: E2E_FIXTURE_DUE_DATE,
        unit_ids: [unit.unit_id],
        notes: note,
      },
    });
    expect(invoiceRes.ok(), `invoice create failed: ${invoiceRes.status()} ${await invoiceRes.text()}`).toBeTruthy();
    const invoiceId = ((await invoiceRes.json()).data.invoice_ids as number[])[0];
    if (invoiceId) return invoiceId;
  }

  throw new Error('could not create an E2E finance modal invoice after trying 180 future periods');
}

const labels = {
  financeHeading: /^(Finanças|Finance|Finanzas|Finances)$/i,
  receivablesHeading: /Cobranças e pagamentos|Charges and payments|Cobros y pagos|Appels et paiements/i,
  recordPaymentModal: /Registrar pagamento|Record payment|Registrar pago|Enregistrer le paiement/i,
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
  let invoiceId: number | null = null;

  try {
    invoiceId = await createE2EOpenInvoice(request, admin);

    await gotoApp(page, '/board/financas');
    await expect(page.getByRole('heading', { name: labels.financeHeading }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: labels.receivablesHeading }).first()).toBeVisible({ timeout: 15_000 });

    const payButton = page.locator(`[data-testid="finance-pay-invoice-${invoiceId}"]:visible`);
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
  } finally {
    if (invoiceId) {
      await voidInvoice(request, admin, invoiceId, 'clean E2E finance modal fixture');
    }
  }
});
