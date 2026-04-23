import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import fetch from 'node-fetch';
import db from '../db';
import { signToken, requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { claimPendingInvitesForUser } from '../lib/invites';

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

interface GoogleTokenInfo {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: string | boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  exp: string | number;
}

router.post('/google', asyncHandler(async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return fail(res, 'google_auth_disabled', 501);

  // Verify the ID token against Google's tokeninfo endpoint. Simple, no extra deps.
  const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(parsed.data.credential)}`;
  const gRes = await fetch(verifyUrl);
  if (!gRes.ok) return fail(res, 'google_verify_failed', 401);
  const info = (await gRes.json()) as GoogleTokenInfo;

  // Audience check
  if (info.aud !== clientId) return fail(res, 'google_aud_mismatch', 401);
  // Issuer check
  if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') {
    return fail(res, 'google_iss_mismatch', 401);
  }
  // Expiry
  const exp = typeof info.exp === 'string' ? parseInt(info.exp, 10) : info.exp;
  if (!exp || exp * 1000 < Date.now()) return fail(res, 'google_token_expired', 401);
  // Email verified
  const emailVerified = info.email_verified === true || info.email_verified === 'true';
  if (!emailVerified) return fail(res, 'google_email_unverified', 401);

  const email = (info.email || '').toLowerCase().trim();
  if (!email) return fail(res, 'google_no_email', 401);

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
