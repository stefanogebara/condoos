import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import fetch from 'node-fetch';
import db from '../db';
import { signToken, requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';

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
    // Create a parked user with no building. They'll pick one via /onboarding
    // (join with a code, or create a new building as the first admin).
    // We still need *some* condominium_id because it's NOT NULL in the schema;
    // a "pending" condo (id = 0) would require migrations, so instead we
    // temporarily point them at the first existing condo but grant no unit access.
    // Their real scoping starts once /onboarding/join or /create-building completes.
    const anyCondo = db.prepare(`SELECT id FROM condominiums LIMIT 1`).get() as any;
    if (!anyCondo) return fail(res, 'no_condo_configured', 500);

    const first = (info.given_name || info.name?.split(' ')[0] || email.split('@')[0]).slice(0, 60);
    const last  = (info.family_name || info.name?.split(' ').slice(1).join(' ') || '').slice(0, 60);
    const pwHash = bcrypt.hashSync(Math.random().toString(36).slice(2) + Date.now(), 10);

    const result = db.prepare(
      `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, unit_number, avatar_url)
       VALUES (?, ?, ?, ?, ?, 'resident', NULL, ?)`
    ).run(anyCondo.id, email, pwHash, first, last, info.picture || null);

    user = db.prepare(
      `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url
       FROM users WHERE id = ?`
    ).get(result.lastInsertRowid);
  } else if (info.picture && !user.avatar_url) {
    db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(info.picture, user.id);
    user.avatar_url = info.picture;
  }

  // If the admin pre-invited this email via CSV, auto-activate their membership(s).
  const pendingInvites = db.prepare(
    `SELECT i.id, i.condominium_id, i.unit_id, un.number AS unit_number
     FROM invites i
     JOIN units un ON un.id = i.unit_id
     WHERE LOWER(i.email) = LOWER(?) AND i.status = 'pending'`
  ).all(email) as Array<{ id: number; condominium_id: number; unit_id: number; unit_number: string }>;

  if (pendingInvites.length > 0) {
    const claimTx = db.transaction(() => {
      for (const inv of pendingInvites) {
        // Skip if user already has an active row for this unit.
        const existing = db.prepare(
          `SELECT id FROM user_unit WHERE user_id=? AND unit_id=? AND status='active'`
        ).get(user.id, inv.unit_id);
        if (existing) {
          db.prepare(`UPDATE invites SET status='claimed', claimed_by_user_id=? WHERE id=?`).run(user.id, inv.id);
          continue;
        }
        db.prepare(
          `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
           VALUES (?, ?, 'tenant', 'active', 0, 1.0, CURRENT_TIMESTAMP)`
        ).run(user.id, inv.unit_id);
        db.prepare(`UPDATE invites SET status='claimed', claimed_by_user_id=? WHERE id=?`).run(user.id, inv.id);
      }
      // Point user at the first matching condo.
      const primary = pendingInvites[0];
      db.prepare(`UPDATE users SET condominium_id=?, unit_number=? WHERE id=?`)
        .run(primary.condominium_id, primary.unit_number, user.id);
      user.condominium_id = primary.condominium_id;
      user.unit_number    = primary.unit_number;
    });
    claimTx();
  }

  const token = signToken(user.id);
  return ok(res, { token, user });
}));

export default router;
