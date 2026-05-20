import { expect, test, type APIRequestContext } from '@playwright/test';
import { credentialsFor } from './support/credentials';

const apiURL = process.env.E2E_API_URL
  || (process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api` : 'http://127.0.0.1:4312/api');

type Session = { token: string; user: any };
const sessionCache = new Map<string, Session>();

test.skip(
  process.env.E2E_LIVE_INTEGRATIONS !== '1',
  'Set E2E_LIVE_INTEGRATIONS=1 to run live provider checks.',
);

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const r = await request.post(`${apiURL}/auth/login`, { data: { email, password } });
  expect(r.ok(), `login failed for ${email}: ${r.status()} ${await r.text()}`).toBeTruthy();
  const session = (await r.json()).data as Session;
  sessionCache.set(email, session);
  return session;
}

function taggedEmail(raw: string) {
  const trimmed = raw.trim();
  const at = trimmed.indexOf('@');
  if (process.env.E2E_EMAIL_PLUS_TAG === '0' || at <= 0) return trimmed;
  return `${trimmed.slice(0, at)}+condoos-e2e-${Date.now()}${trimmed.slice(at)}`;
}

test.describe.configure({ mode: 'serial' });

test('production integrations are configured', async ({ request }) => {
  const health = await request.get(`${apiURL}/health`);
  expect(health.ok(), `health failed: ${health.status()} ${await health.text()}`).toBeTruthy();

  const authConfig = await request.get(`${apiURL}/auth/config`);
  expect(authConfig.ok(), `auth config failed: ${authConfig.status()} ${await authConfig.text()}`).toBeTruthy();
  const authData = (await authConfig.json()).data;
  if (process.env.E2E_EXPECT_GOOGLE === '1') {
    expect(authData.google_enabled, 'Google OAuth is expected to be configured in production').toBe(true);
    expect(authData.google_client_id, 'Google client id should be exposed to the login UI').toBeTruthy();
  }

  const adminCreds = credentialsFor('admin');
  const admin = await loginApi(request, adminCreds.email, adminCreds.password);
  const whatsapp = await request.get(`${apiURL}/users/whatsapp/status`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(whatsapp.ok(), `whatsapp status failed: ${whatsapp.status()} ${await whatsapp.text()}`).toBeTruthy();
  const whatsappData = (await whatsapp.json()).data;
  if (process.env.E2E_EXPECT_WHATSAPP === '1') {
    expect(whatsappData.configured, 'WhatsApp provider is expected to be configured in production').toBe(true);
    expect(whatsappData.provider, 'WhatsApp provider should be identified').toMatch(/twilio|waha/i);
  }
});

test('live Resend invite delivery works when explicitly write-enabled', async ({ request }) => {
  test.skip(process.env.E2E_ALLOW_PROD_WRITES !== '1', 'Set E2E_ALLOW_PROD_WRITES=1 to send live email.');
  test.skip(!process.env.E2E_LIVE_EMAIL_TO, 'Set E2E_LIVE_EMAIL_TO to the verified recipient email.');

  const adminCreds = credentialsFor('admin');
  const admin = await loginApi(request, adminCreds.email, adminCreds.password);
  const email = taggedEmail(process.env.E2E_LIVE_EMAIL_TO!);
  const csv = `email,unit,relationship,primary_contact,voting_weight\n${email},101,tenant,no,1`;
  const res = await request.post(`${apiURL}/memberships/import-csv`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { csv, send_emails: true },
  });
  expect(res.ok(), `invite import failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()).data;
  expect(body.imported_count).toBe(1);
  expect(body.email_delivery?.[0]?.delivery?.status).toBe('sent');
});

test('live WhatsApp notification path accepts a send trigger when explicitly write-enabled', async ({ request }) => {
  test.skip(process.env.E2E_ALLOW_PROD_WRITES !== '1', 'Set E2E_ALLOW_PROD_WRITES=1 to trigger live WhatsApp.');
  test.skip(!process.env.E2E_LIVE_WHATSAPP_TO, 'Set E2E_LIVE_WHATSAPP_TO to the recipient phone in E.164 format.');

  const adminCreds = credentialsFor('admin');
  const residentCreds = credentialsFor('resident');
  const admin = await loginApi(request, adminCreds.email, adminCreds.password);
  const resident = await loginApi(request, residentCreds.email, residentCreds.password);

  const patch = await request.patch(`${apiURL}/users/me`, {
    headers: { Authorization: `Bearer ${resident.token}` },
    data: { phone: process.env.E2E_LIVE_WHATSAPP_TO, whatsapp_opt_in: true },
  });
  expect(patch.ok(), `resident WhatsApp opt-in failed: ${patch.status()} ${await patch.text()}`).toBeTruthy();

  const pkg = await request.post(`${apiURL}/packages`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: {
      recipient_id: resident.user.id,
      carrier: 'CondoOS E2E',
      description: `Live WhatsApp smoke ${new Date().toISOString()}`,
    },
  });
  expect(pkg.ok(), `package notification trigger failed: ${pkg.status()} ${await pkg.text()}`).toBeTruthy();
});
