import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db';
import { signToken, requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { claimPendingInvitesForUser } from '../lib/invites';
import { GoogleAuthError, verifyGoogleCredential } from '../lib/google-auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

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

// GET /api/auth/config — tells the client which sign-in methods are enabled.
router.get('/config', (_req, res) => {
  return ok(res, {
    google_client_id: process.env.GOOGLE_CLIENT_ID || null,
    google_enabled: !!process.env.GOOGLE_CLIENT_ID,
  });
});

// POST /api/auth/google — verify a Google ID token and issue a CondoOS JWT.
// Body: { credential: string } — the ID token returned by @react-oauth/google.
const googleSchema = z.object({ credential: z.string().min(10) });

router.post('/google', asyncHandler(async (req, res) => {
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

export default router;
