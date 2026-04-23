import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../lib/auth';
import { ok } from '../lib/respond';

const router = Router();

router.get('/residents', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(
    `SELECT id, first_name, last_name, unit_number, role, email
     FROM users WHERE condominium_id = ? ORDER BY unit_number`
  ).all(req.user!.condominium_id);
  return ok(res, rows);
});

export default router;
