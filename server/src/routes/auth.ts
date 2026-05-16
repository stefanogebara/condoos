import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db';
import { signToken, requireAuth, revokeUserTokens, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
// claimPendingInvitesForUser intentionally NOT imported here — auto-claim
// at signup is unsafe. See lib/invites.ts comment.
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

// Demo accounts are public credentials embedded in the README. Without an
// allowlist a single visitor hammering the "Síndico"/"Morador" demo buttons
// will trip the per-credential limit (max=5/15min) and lock the demo for the
// next visitor. The per-IP limit still throttles abuse from a single attacker.
const DEMO_LOGIN_ALLOWLIST = new Set([
  'admin@condoos.dev',
  'resident@condoos.dev',
]);

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

function skipDemoCredentialLimit(req: Request, _res: Response, next: NextFunction) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (DEMO_LOGIN_ALLOWLIST.has(email)) return next();
  return authCredentialRateLimit(req, _res, next);
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(120),
  first_name: z.string().min(1).max(60),
  last_name: z.string().min(1).max(60),
});

// Audit H-N1 / M-N1 — `bcrypt.compareSync` was both a timing oracle and a
// blocking call. The user-not-found branch returned in ~0.22s while the
// user-found-wrong-password branch took ~0.33s, leaking valid emails. Run
// the hash compare unconditionally against a precomputed dummy hash on the
// not-found path so timing is symmetric, and switch to the async API so
// concurrent logins no longer starve the event loop. Cost factor must match
// the cost actually used to hash stored passwords (currently 10, see
// db/seed.ts and routes/auth.ts/dev-register) — otherwise the dummy compare
// is *slower* than a real one and the oracle reverses direction. Once we
// migrate stored hashes to cost 12 (OWASP 2023 floor), bump this to 12 too.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('not-a-real-password-timing-padding', 10);

router.post('/login', authIpRateLimit, skipDemoCredentialLimit, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  if (isBlockedDemoCredential(parsed.data.email, parsed.data.password)) {
    return fail(res, 'demo_login_disabled', 403);
  }

  const row = db.prepare(
    `SELECT id, email, password_hash, role, condominium_id, first_name, last_name, unit_number, mobile_phone, home_phone
     FROM users WHERE email = ?`
  ).get(parsed.data.email) as any;

  // Always run a real bcrypt compare so the response time does not depend on
  // whether the email exists. Result is discarded on the not-found path.
  const hashToCheck = row?.password_hash || DUMMY_BCRYPT_HASH;
  const match = await bcrypt.compare(parsed.data.password, hashToCheck);
  if (!row || !match) return fail(res, 'invalid_credentials', 401);

  // Auto-claim used to run here — that path is unsafe (silent email-match
  // join with no consent + no audit). The resident now goes through
  // /onboarding/join to explicitly redeem the condo's invite_code.
  const token = signToken(row.id);
  const { password_hash, ...user } = row;
  return ok(res, { token, user });
}));

router.post('/register', authIpRateLimit, authCredentialRateLimit, asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const body = parsed.data;
  const email = body.email.trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) return fail(res, 'email_taken', 409);

  const pwHash = await bcrypt.hash(body.password, 12);
  const result = db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, unit_number, avatar_url)
     VALUES (NULL, ?, ?, ?, ?, 'resident', NULL, NULL)`
  ).run(email, pwHash, body.first_name.trim(), body.last_name.trim());

  const user = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url, mobile_phone, home_phone
     FROM users WHERE id = ?`
  ).get(result.lastInsertRowid) as any;

  // Auto-claim removed (see /login). Residents redeem via /onboarding/join.
  const token = signToken(user.id);
  return ok(res, { token, user }, 201);
}));

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  return ok(res, { user: req.user });
});

router.post('/refresh', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url, mobile_phone, home_phone
     FROM users WHERE id = ?`
  ).get(req.user!.id) as any;
  if (!row) return fail(res, 'user_not_found', 401);
  const token = signToken(row.id);
  return ok(res, { token, user: row });
});

router.delete('/logout', requireAuth, (req: AuthedRequest, res) => {
  revokeUserTokens(req.user!.id);
  return ok(res, { revoked: true });
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
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url, mobile_phone, home_phone
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
      `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url, mobile_phone, home_phone
       FROM users WHERE id = ?`
    ).get(result.lastInsertRowid);
  } else if (info.picture && !user.avatar_url) {
    db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(info.picture, user.id);
    user.avatar_url = info.picture;
  }

  // Auto-claim removed (see /login). Residents redeem via /onboarding/join.

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
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, mobile_phone, home_phone
     FROM users WHERE id = ?`
  ).get(result.lastInsertRowid) as any;

  // Auto-claim removed. E2E tests that need invite redemption now go
  // through /api/onboarding/join with the condo invite_code — same path
  // as a real resident.

  const token = signToken(row.id);
  return ok(res, { token, user: row });
}));

export default router;
