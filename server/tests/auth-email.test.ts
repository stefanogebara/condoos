import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuthError, verifyGoogleCredential } from '../src/lib/google-auth';
import db from '../src/db';
import {
  buildAgencyStaffInviteEmail,
  buildInviteEmail,
  buildVerificationEmail,
  sendInviteEmail,
  sendVerificationEmail,
} from '../src/lib/email';
import {
  consumeEmailVerificationToken,
  createEmailVerificationToken,
  emailVerificationRequiredForCreateBuilding,
  hashEmailVerificationToken,
} from '../src/lib/email-verification';
import { getCaptchaPublicConfig, verifyCreateBuildingCaptcha } from '../src/lib/captcha';
import { checkPrivateSetupCode, privateCreateBuildingRequired } from '../src/lib/private-access';
import { RATE_LIMIT_BYPASS_HEADER, createRateLimit, resetRateLimits } from '../src/lib/rate-limit';
import { demoAuthEnabled, isBlockedDemoCredential } from '../src/lib/demo-auth';
import { authRateLimitKey } from '../src/routes/auth';

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

test('buildInviteEmail creates both a sign-in URL and a deep-link with the invite code', () => {
  const email = buildInviteEmail({
    to: 'owner@example.com',
    condoName: 'Pine Ridge Towers',
    inviteCode: 'DEMO123',
    unitNumber: '502',
    relationship: 'owner',
    senderName: 'Alex Silva',
  }, { APP_ORIGIN: 'https://condoos.example' } as NodeJS.ProcessEnv);

  assert.equal(email.loginUrl, 'https://condoos.example/login');
  // Landing reads ?code= and forwards it through the join CTA into the wizard.
  assert.equal(email.joinUrl, 'https://condoos.example/?code=DEMO123');
  assert.match(email.subject, /Pine Ridge Towers/);
  assert.match(email.text, /Alex Silva invited you to join Pine Ridge Towers/);
  assert.match(email.text, /Your unit: 502/);
  assert.match(email.text, /Invite code: DEMO123/);
  assert.match(email.text, /https:\/\/condoos\.example\/\?code=DEMO123/);
  assert.match(email.html, /tap here to claim your unit/);
});

test('buildAgencyStaffInviteEmail creates a staff signup and acceptance link', () => {
  const email = buildAgencyStaffInviteEmail({
    to: 'ops@example.com',
    agencyName: 'Andes Management',
    role: 'maintenance_manager',
    token: 'raw-token',
    senderName: 'Alex Silva',
  }, { APP_ORIGIN: 'https://condoos.example/' } as NodeJS.ProcessEnv);

  assert.equal(email.inviteUrl, 'https://condoos.example/signup?intent=agency&agency_invite=raw-token');
  assert.match(email.subject, /Andes Management/);
  assert.match(email.text, /Alex Silva invited you to join Andes Management/);
  assert.match(email.text, /maintenance_manager/);
  assert.match(email.text, /https:\/\/condoos\.example\/signup\?intent=agency&agency_invite=raw-token/);
  assert.match(email.html, /Accept agency invite/);
});

test('sendInviteEmail skips safely when email delivery is not configured', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => { logs.push(String(message)); };
  try {
    const delivery = await sendInviteEmail({
      to: 'owner@example.com',
      condoName: 'Pine Ridge Towers',
      inviteCode: 'DEMO123',
      unitNumber: '502',
      relationship: 'owner',
    }, {} as NodeJS.ProcessEnv);

    assert.deepEqual(delivery, { status: 'skipped', provider: 'none', error: 'email_not_configured' });
    assert.deepEqual(logs, ['[email] invite skipped: email_not_configured']);
  } finally {
    console.log = originalLog;
  }
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
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['User-Agent'], 'CondoOS/0.1');
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.from, 'CondoOS <noreply@condoos.example>');
  assert.deepEqual(payload.to, ['owner@example.com']);
  assert.match(payload.text, /Invite code: DEMO123/);
  assert.match(payload.text, /https:\/\/condoos\.example\/login/);
});

test('buildVerificationEmail creates a confirmation link without leaking secrets', () => {
  const email = buildVerificationEmail({
    to: 'owner@example.com',
    firstName: 'Olivia',
    verificationUrl: 'https://condoos.example/login?verify_email=raw-token',
  });

  assert.equal(email.subject, 'Confirm your CondoOS email');
  assert.match(email.text, /Hi Olivia/);
  assert.match(email.text, /https:\/\/condoos\.example\/login\?verify_email=raw-token/);
  assert.match(email.html, /Confirm my email/);
});

test('sendVerificationEmail uses the same Resend delivery contract as invites', async () => {
  const calls: any[] = [];
  const delivery = await sendVerificationEmail({
    to: 'owner@example.com',
    firstName: 'Olivia',
    verificationUrl: 'https://condoos.example/login?verify_email=raw-token',
  }, {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'CondoOS <noreply@condoos.example>',
  } as NodeJS.ProcessEnv, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => JSON.stringify({ id: 'email_verify_123' }) };
  });

  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.message_id, 'email_verify_123');
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.to, ['owner@example.com']);
  assert.match(payload.text, /Confirm this email before creating a condominium/);
});

test('email verification tokens are hashed, single-use, and mark the user verified', () => {
  const email = `verify-${process.hrtime.bigint()}@example.com`;
  const userId = Number(db.prepare(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES (?, 'hash', 'Verify', 'User', 'resident')`
  ).run(email).lastInsertRowid);

  const issued = createEmailVerificationToken(userId);
  assert.notEqual(hashEmailVerificationToken(issued.token), issued.token);

  const stored = db.prepare(
    `SELECT token_hash FROM email_verification_tokens WHERE user_id = ?`
  ).get(userId) as { token_hash: string };
  assert.equal(stored.token_hash, hashEmailVerificationToken(issued.token));

  const consumed = consumeEmailVerificationToken(issued.token);
  assert.equal(consumed.ok, true);
  assert.equal(consumed.user_id, userId);
  const user = db.prepare(
    `SELECT email_verified_at FROM users WHERE id = ?`
  ).get(userId) as { email_verified_at: string | null };
  assert.ok(user.email_verified_at);

  const replay = consumeEmailVerificationToken(issued.token);
  assert.deepEqual(replay, { ok: false, error: 'invalid_or_used_token' });
});

test('email verification requirement fails closed in production and can be explicitly disabled', () => {
  assert.equal(emailVerificationRequiredForCreateBuilding(null, { NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
  assert.equal(emailVerificationRequiredForCreateBuilding(null, { NODE_ENV: 'development' } as NodeJS.ProcessEnv), false);
  assert.equal(emailVerificationRequiredForCreateBuilding(null, {
    NODE_ENV: 'production',
    EMAIL_VERIFICATION_REQUIRED: '0',
  } as NodeJS.ProcessEnv), false);
});

test('Turnstile config stays optional until keys are installed', async () => {
  assert.deepEqual(getCaptchaPublicConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), {
    turnstile_site_key: null,
    create_building_captcha_required: false,
  });

  const skipped = await verifyCreateBuildingCaptcha(undefined, undefined, { NODE_ENV: 'production' } as NodeJS.ProcessEnv);
  assert.deepEqual(skipped, { ok: true, skipped: true });
});

test('private building creation gate is explicit and accepts sales-issued env codes', () => {
  assert.equal(privateCreateBuildingRequired({} as NodeJS.ProcessEnv), false);
  assert.equal(privateCreateBuildingRequired({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), true);
  assert.equal(privateCreateBuildingRequired({ PRIVATE_CREATE_BUILDING_REQUIRED: '1' } as NodeJS.ProcessEnv), true);
  assert.equal(privateCreateBuildingRequired({ PRIVATE_CREATE_BUILDING_REQUIRED: '0' } as NodeJS.ProcessEnv), false);

  const requiredEnv = { PRIVATE_CREATE_BUILDING_REQUIRED: '1' } as NodeJS.ProcessEnv;
  assert.deepEqual(checkPrivateSetupCode('', requiredEnv), {
    ok: false,
    status: 403,
    error: 'setup_code_required',
  });
  assert.deepEqual(checkPrivateSetupCode('wrong-code', requiredEnv), {
    ok: false,
    status: 403,
    error: 'invalid_setup_code',
  });

  const accepted = checkPrivateSetupCode(' agency 2026 ', {
    PRIVATE_CREATE_BUILDING_REQUIRED: '1',
    PRIVATE_SETUP_CODES: 'AGENCY2026',
  } as NodeJS.ProcessEnv);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.source, 'env');
});

test('verifyCreateBuildingCaptcha validates tokens server-side with Cloudflare Siteverify', async () => {
  const calls: any[] = [];
  const env = {
    NODE_ENV: 'production',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
  } as NodeJS.ProcessEnv;

  const result = await verifyCreateBuildingCaptcha('client-token', '203.0.113.7', env, async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => JSON.stringify({ success: true, hostname: 'condoos.example' }) };
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload, {
    secret: 'secret-key',
    response: 'client-token',
    remoteip: '203.0.113.7',
  });

  const missing = await verifyCreateBuildingCaptcha('', '203.0.113.7', env);
  assert.deepEqual(missing, { ok: false, status: 403, error: 'captcha_required' });
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

test('auth rate-limit key scopes shared IPs by normalized email', () => {
  const req = {
    ip: '203.0.113.10',
    socket: {},
    body: { email: ' Resident@CondoOS.Dev ' },
  } as any;

  assert.equal(authRateLimitKey(req), '203.0.113.10:resident@condoos.dev');
});

test('createRateLimit custom key allows different users behind one shared IP', () => {
  resetRateLimits();
  const limiter = createRateLimit({
    keyPrefix: 'auth-test',
    windowMs: 60_000,
    max: 1,
    key: (req) => authRateLimitKey(req),
  });
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
  limiter({ ip: '203.0.113.10', socket: {}, body: { email: 'a@example.com' } } as any, res, () => { nextCalls += 1; });
  limiter({ ip: '203.0.113.10', socket: {}, body: { email: 'b@example.com' } } as any, res, () => { nextCalls += 1; });
  limiter({ ip: '203.0.113.10', socket: {}, body: { email: 'a@example.com' } } as any, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 2);
  assert.deepEqual(responses.find((r) => r.status), { status: 429 });
  resetRateLimits();
});

test('createRateLimit allows secret-gated automation bypass', () => {
  const previous = process.env.RATE_LIMIT_BYPASS_SECRET;
  process.env.RATE_LIMIT_BYPASS_SECRET = '0123456789abcdef0123456789abcdef';
  resetRateLimits();

  try {
    const limiter = createRateLimit({
      keyPrefix: 'auth-test-bypass',
      windowMs: 60_000,
      max: 1,
    });
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
    const req = {
      ip: '203.0.113.10',
      socket: {},
      get: (name: string) => name.toLowerCase() === RATE_LIMIT_BYPASS_HEADER
        ? process.env.RATE_LIMIT_BYPASS_SECRET
        : undefined,
    } as any;

    let nextCalls = 0;
    limiter(req, res, () => { nextCalls += 1; });
    limiter(req, res, () => { nextCalls += 1; });

    assert.equal(nextCalls, 2);
    assert.deepEqual(responses, []);
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_BYPASS_SECRET;
    else process.env.RATE_LIMIT_BYPASS_SECRET = previous;
    resetRateLimits();
  }
});

test('demo auth blocks every seeded demo credential in production unless explicitly enabled', () => {
  const productionEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  const enabledEnv = { NODE_ENV: 'production', DEMO_AUTH_ENABLED: '1' } as NodeJS.ProcessEnv;

  assert.equal(demoAuthEnabled(productionEnv), false);
  assert.equal(demoAuthEnabled(enabledEnv), true);

  for (const email of [
    'admin@condoos.dev',
    'resident@condoos.dev',
    'jordan@condoos.dev',
    'taylor@condoos.dev',
    'riley@condoos.dev',
    'sam@condoos.dev',
  ]) {
    assert.equal(isBlockedDemoCredential(email, 'resident123', productionEnv), true);
    assert.equal(isBlockedDemoCredential(email.toUpperCase(), 'resident123', productionEnv), true);
    assert.equal(isBlockedDemoCredential(email, 'resident123', enabledEnv), false);
  }

  assert.equal(isBlockedDemoCredential('real-owner@example.com', 'resident123', productionEnv), false);
  assert.equal(isBlockedDemoCredential('resident@condoos.dev', 'wrong-password', productionEnv), false);
});
