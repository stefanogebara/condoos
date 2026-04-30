import { Router, type Request } from 'express';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db';
import { signToken, requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { claimPendingInvitesForUser } from '../lib/invites';
import { GoogleAuthError, verifyGoogleCredential } from '../lib/google-auth';
import { createRateLimit } from '../lib/rate-limit';
import { demoAuthEnabled, isBlockedDemoCredential } from '../lib/demo-auth';

const router = Router();
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60_000;

function positiveIntEnv(name: string, fallback: number): number {
  const raw = parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Keep brute-force protection per credential while avoiding collateral lockouts
// for shared NATs such as GitHub Actions runners or condo building networks.
const AUTH_RATE_LIMIT_MAX = positiveIntEnv('AUTH_RATE_LIMIT_MAX', 5);
const AUTH_IP_RATE_LIMIT_MAX = positiveIntEnv('AUTH_IP_RATE_LIMIT_MAX', 60);

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function authRateLimitKey(req: Request): string {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : 'unknown';
  const email = rawEmail.trim().toLowerCase() || 'unknown';
  return `${clientIp(req)}:${email}`;
}

const authIpRateLimit = createRateLimit({
  keyPrefix: 'auth_ip',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_IP_RATE_LIMIT_MAX,
});
const authCredentialRateLimit = createRateLimit({
  keyPrefix: 'auth_credential',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
  key: authRateLimitKey,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', authIpRateLimit, authCredentialRateLimit, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  if (isBlockedDemoCredential(parsed.data.email, parsed.data.password)) {
    return fail(res, 'demo_login_disabled', 403);
  }

  const row = db.prepare(
    `SELECT id, email, password_hash, role, condominium_id, first_name, last_name, unit_number
     FROM users WHERE email = ?`
  ).get(parsed.data.email) as any;

  if (!row) return fail(res, 'invalid_credentials', 401);
  const match = bcrypt.compareSync(parsed.data.password, row.password_hash);
  if (!match) return fail(res, 'invalid_credentials', 401);

  claimPendingInvitesForUser(row);
  const token = signToken(row.id);
  const { password_hash, ...user } = row;
  return ok(res, { token, user });
});

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  return ok(res, { user: req.user });
});

router.post('/refresh', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url
     FROM users WHERE id = ?`
  ).get(req.user!.id) as any;
  if (!row) return fail(res, 'user_not_found', 401);
  const token = signToken(row.id);
  return ok(res, { token, user: row });
});

// GET /api/auth/config — tells the client which sign-in methods are enabled.
router.get('/config', (_req, res) => {
  return ok(res, {
    google_client_id: process.env.GOOGLE_CLIENT_ID || null,
    google_enabled: !!process.env.GOOGLE_CLIENT_ID,
    demo_enabled: demoAuthEnabled(),
  });
});

// POST /api/auth/google — verify a Google ID token and issue a CondoOS JWT.
// Body: { credential: string } — the ID token returned by @react-oauth/google.
const googleSchema = z.object({ credential: z.string().min(10) });

router.post('/google', authIpRateLimit, authCredentialRateLimit, asyncHandler(async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  let info;
  try {
    info = await verifyGoogleCredential(parsed.data.credential, process.env.GOOGLE_CLIENT_ID);
  } catch (err) {
    if (err instanceof GoogleAuthError) return fail(res, err.code, err.status);
    throw err;
  }
  const email = info.email;

  // Look up existing user
  let user = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url
     FROM users WHERE email = ?`
  ).get(email) as any;

  if (!user) {
    // Create an unaffiliated user. They only receive data access after joining
    // or creating a building, because all scoped routes require user_unit.
    const first = (info.given_name || info.name?.split(' ')[0] || email.split('@')[0]).slice(0, 60);
    const last  = (info.family_name || info.name?.split(' ').slice(1).join(' ') || '').slice(0, 60);
    const pwHash = bcrypt.hashSync(Math.random().toString(36).slice(2) + Date.now(), 10);

    const result = db.prepare(
      `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, unit_number, avatar_url)
       VALUES (?, ?, ?, ?, ?, 'resident', NULL, ?)`
    ).run(null, email, pwHash, first, last, info.picture || null);

    user = db.prepare(
      `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url
       FROM users WHERE id = ?`
    ).get(result.lastInsertRowid);
  } else if (info.picture && !user.avatar_url) {
    db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(info.picture, user.id);
    user.avatar_url = info.picture;
  }

  claimPendingInvitesForUser(user);

  const token = signToken(user.id);
  return ok(res, { token, user });
}));

// POST /api/auth/dev-register — test-only fresh-user creation for E2E onboarding flows.
// Disabled unless E2E_REGISTER_SECRET is set on the server AND the request supplies
// a matching x-e2e-secret header. Creates an unaffiliated user (no condominium_id,
// no user_unit), so onboarding routes can be exercised end-to-end against a
// brand-new account.
const devRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(120),
  first_name: z.string().min(1).max(60).default('E2E'),
  last_name: z.string().min(1).max(60).default('Tester'),
});

function devRegisterSecretIsConfigured(): string | null {
  const raw = (process.env.E2E_REGISTER_SECRET || '').trim();
  // Reject empty / whitespace-only / too-short secrets at request time so a
  // misconfigured deploy can't accidentally enable a wide-open registration
  // endpoint with a weak gate.
  if (raw.length < 16) return null;
  return raw;
}

function constantTimeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // timingSafeEqual throws on length mismatch; do a dummy comparison so the
    // total time spent is comparable to the equal-length case.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

router.post('/dev-register', authIpRateLimit, authCredentialRateLimit, asyncHandler(async (req, res) => {
  const expected = devRegisterSecretIsConfigured();
  // Same 404 in both "disabled" and "wrong secret" cases — never confirm to
  // unauthenticated callers that the endpoint is live.
  if (!expected) return fail(res, 'not_found', 404);
  const provided = req.header('x-e2e-secret') || '';
  if (!constantTimeMatch(provided, expected)) return fail(res, 'not_found', 404);

  const parsed = devRegisterSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(parsed.data.email);
  if (existing) return fail(res, 'email_taken', 409);

  // Async hash at cost 12 — avoids blocking the event loop and matches current
  // OWASP guidance for new code.
  const pwHash = await bcrypt.hash(parsed.data.password, 12);
  const result = db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, unit_number)
     VALUES (NULL, ?, ?, ?, ?, 'resident', NULL)`
  ).run(parsed.data.email, pwHash, parsed.data.first_name, parsed.data.last_name);

  const row = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number
     FROM users WHERE id = ?`
  ).get(result.lastInsertRowid) as any;

  // Mirror /login + /google: claim any pending invites that match this email
  // so an E2E run can exercise invite-claim flows without extra plumbing.
  claimPendingInvitesForUser(row);

  const token = signToken(row.id);
  return ok(res, { token, user: row });
}));

export default router;
