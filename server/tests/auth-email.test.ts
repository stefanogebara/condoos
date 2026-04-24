import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuthError, verifyGoogleCredential } from '../src/lib/google-auth';
import { buildInviteEmail, sendInviteEmail } from '../src/lib/email';
import { createRateLimit, resetRateLimits } from '../src/lib/rate-limit';

const futureExp = Math.floor(Date.now() / 1000) + 3600;

test('verifyGoogleCredential accepts a valid Google tokeninfo response', async () => {
  const info = await verifyGoogleCredential('credential', 'client-123', async (url) => {
    assert.match(url, /oauth2\.googleapis\.com\/tokeninfo/);
    return {
      ok: true,
      json: async () => ({
        iss: 'https://accounts.google.com',
        aud: 'client-123',
        sub: 'google-user',
        email: 'OWNER@EXAMPLE.COM',
        email_verified: 'true',
        given_name: 'Olivia',
        family_name: 'Owner',
        exp: futureExp,
      }),
    };
  });

  assert.equal(info.email, 'owner@example.com');
  assert.equal(info.given_name, 'Olivia');
});

test('verifyGoogleCredential rejects unsafe Google tokeninfo responses', async () => {
  await assert.rejects(
    () => verifyGoogleCredential('credential', undefined),
    (err: unknown) => err instanceof GoogleAuthError && err.code === 'google_auth_disabled' && err.status === 501,
  );

  await assert.rejects(
    () => verifyGoogleCredential('credential', 'expected-client', async () => ({
      ok: true,
      json: async () => ({
        iss: 'https://accounts.google.com',
        aud: 'wrong-client',
        sub: 'google-user',
        email: 'owner@example.com',
        email_verified: true,
        exp: futureExp,
      }),
    })),
    (err: unknown) => err instanceof GoogleAuthError && err.code === 'google_aud_mismatch',
  );
});

test('buildInviteEmail creates a join link with the configured app origin', () => {
  const email = buildInviteEmail({
    to: 'owner@example.com',
    condoName: 'Pine Ridge Towers',
    inviteCode: 'DEMO123',
    unitNumber: '502',
    relationship: 'owner',
  }, { APP_ORIGIN: 'https://condoos.example' } as NodeJS.ProcessEnv);

  assert.equal(email.joinUrl, 'https://condoos.example/onboarding/join?code=DEMO123');
  assert.match(email.subject, /Pine Ridge Towers/);
  assert.match(email.text, /Unit: 502/);
});

test('sendInviteEmail skips safely when email delivery is not configured', async () => {
  const delivery = await sendInviteEmail({
    to: 'owner@example.com',
    condoName: 'Pine Ridge Towers',
    inviteCode: 'DEMO123',
    unitNumber: '502',
    relationship: 'owner',
  }, {} as NodeJS.ProcessEnv);

  assert.deepEqual(delivery, { status: 'skipped', provider: 'none', error: 'email_not_configured' });
});

test('sendInviteEmail posts to Resend when configured', async () => {
  const calls: any[] = [];
  const delivery = await sendInviteEmail({
    to: 'owner@example.com',
    condoName: 'Pine Ridge Towers',
    inviteCode: 'DEMO123',
    unitNumber: '502',
    relationship: 'owner',
  }, {
    APP_ORIGIN: 'https://condoos.example',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'CondoOS <noreply@condoos.example>',
  } as NodeJS.ProcessEnv, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => JSON.stringify({ id: 'email_123' }) };
  });

  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.message_id, 'email_123');
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.to, ['owner@example.com']);
  assert.match(payload.text, /https:\/\/condoos\.example\/onboarding\/join\?code=DEMO123/);
});

test('createRateLimit returns 429 after the configured allowance', () => {
  resetRateLimits();
  const limiter = createRateLimit({ keyPrefix: 'test', windowMs: 60_000, max: 1 });
  const req = { ip: '203.0.113.10', socket: {} } as any;
  const responses: any[] = [];
  const res = {
    setHeader: (name: string, value: string) => responses.push({ header: [name, value] }),
    status(code: number) {
      responses.push({ status: code });
      return this;
    },
    json(body: unknown) {
      responses.push({ body });
      return this;
    },
  } as any;

  let nextCalls = 0;
  limiter(req, res, () => { nextCalls += 1; });
  limiter(req, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.deepEqual(responses.find((r) => r.status), { status: 429 });
  assert.equal((responses.find((r) => r.body) as any).body.error, 'rate_limited');
  resetRateLimits();
});
