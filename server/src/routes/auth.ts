import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db';
import { signToken, requireAuth, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

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

export default router;
