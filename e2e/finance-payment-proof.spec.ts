import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:6312/api');
const apiOrigin = apiURL.replace(/\/api\/?$/, '');

type Session = { token: string; user: any };

async function loginRole(request: APIRequestContext, role: 'admin' | 'resident'): Promise<Session> {
  const creds = credentialsFor(role);
  const res = await request.post(`${apiURL}/auth/login`, { data: creds });
  expect(res.ok(), `login failed for ${role}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).data as Session;
}

async function setSession(page: Page, session: Session) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('condoos_token', token);
    localStorage.setItem('condoos_user', JSON.stringify(user));
  }, session);
}

function resolveUploadUrl(uploadUrl: string) {
  return uploadUrl.startsWith('http') ? uploadUrl : `${apiOrigin}${uploadUrl}`;
}

test('board finance rejects a resident payment proof through the styled modal', async ({ page, request }) => {
  test.skip(!!process.env.E2E_BASE_URL, 'local-only: creates disposable finance records');

  const admin = await loginRole(request, 'admin');
  const resident = await loginRole(request, 'resident');

  const membershipsRes = await request.get(`${apiURL}/onboarding/me`, {
    headers: { Authorization: `Bearer ${resident.token}` },
  });
  expect(membershipsRes.ok(), `membership lookup failed: ${membershipsRes.status()} ${await membershipsRes.text()}`).toBeTruthy();
  const membership = ((await membershipsRes.json()).data as Array<{ unit_id: number; status: string }>).find((row) => row.status === 'active');
  expect(membership?.unit_id, 'resident active unit').toBeTruthy();

  const scheduleRes = await request.post(`${apiURL}/finance/schedules`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: {
      name: `E2E proof review ${Date.now()}`,
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
      period: '2099-05',
      unit_ids: [membership!.unit_id],
    },
  });
  expect(invoiceRes.ok(), `invoice create failed: ${invoiceRes.status()} ${await invoiceRes.text()}`).toBeTruthy();
  const invoiceId = ((await invoiceRes.json()).data.invoice_ids as number[])[0];
  expect(invoiceId, 'invoice id').toBeTruthy();

  const proofBytes = Buffer.from('payment proof fixture');
  const presignRes = await request.post(`${apiURL}/uploads/presign`, {
    headers: { Authorization: `Bearer ${resident.token}` },
    data: {
      filename: 'proof.txt',
      content_type: 'text/plain',
      size_bytes: proofBytes.length,
      purpose: 'payment_proof',
      visibility: 'board_only',
    },
  });
  expect(presignRes.ok(), `presign failed: ${presignRes.status()} ${await presignRes.text()}`).toBeTruthy();
  const presigned = (await presignRes.json()).data;
  const uploadHeaders: Record<string, string> = { ...(presigned.headers || {}) };
  if (presigned.upload_method === 'api') uploadHeaders.Authorization = `Bearer ${resident.token}`;
  const uploadRes = await request.put(resolveUploadUrl(String(presigned.upload_url)), {
    headers: uploadHeaders,
    data: proofBytes,
  });
  expect(uploadRes.ok(), `upload failed: ${uploadRes.status()} ${await uploadRes.text()}`).toBeTruthy();
  const completeRes = await request.post(`${apiURL}/uploads/complete`, {
    headers: { Authorization: `Bearer ${resident.token}` },
    data: { file_id: presigned.file.id },
  });
  expect(completeRes.ok(), `complete failed: ${completeRes.status()} ${await completeRes.text()}`).toBeTruthy();

  const proofRes = await request.post(`${apiURL}/finance/payment-proofs`, {
    headers: { Authorization: `Bearer ${resident.token}` },
    data: {
      invoice_id: invoiceId,
      amount_cents: 1234,
      method: 'pix',
      file_id: presigned.file.id,
      note: 'E2E modal review',
    },
  });
  expect(proofRes.ok(), `proof submit failed: ${proofRes.status()} ${await proofRes.text()}`).toBeTruthy();

  await setSession(page, admin);
  await page.goto('/board/financas', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Finanças|Finance|Finanzas|Finances/i })).toBeVisible();
  await page.getByRole('button', { name: /Rejeitar|Reject|Rechazar|Rejeter/i }).first().click();
  await expect(page.getByRole('dialog', { name: /Rejeitar comprovante|Reject proof|Rechazar comprobante|Rejeter le justificatif/i })).toBeVisible();
  await page.getByLabel(/Motivo da rejeição|Rejection reason|Motivo del rechazo|Motif du rejet/i).fill('Receipt is unreadable');
  await page.getByRole('button', { name: /Rejeitar comprovante|Reject proof|Rechazar comprobante|Rejeter le justificatif/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/Comprovante rejeitado|Proof rejected|Comprobante rechazado|Justificatif rejeté/i)).toBeVisible();
});
