import { Router } from 'express';
import db from '../db';
import { requireAuth, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { getWhatsAppStatus } from '../lib/whatsapp';

const router = Router();

// Diagnostic: is WhatsApp delivery configured on this deployment?
// Safe to expose — returns only booleans + a masked from-number, never secrets.
router.get('/whatsapp/status', requireAuth, (_req: AuthedRequest, res) => {
  return ok(res, getWhatsAppStatus());
});

router.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare(
    `SELECT id, email, first_name, last_name, role, phone, whatsapp_opt_in
     FROM users WHERE id = ?`
  ).get(req.user!.id);
  return ok(res, row);
});

// Update profile fields — phone + whatsapp_opt_in for notification preferences.
router.patch('/me', requireAuth, (req: AuthedRequest, res) => {
  const { phone, whatsapp_opt_in, first_name, last_name } = req.body || {};
  const sets: string[] = [];
  const vals: any[] = [];
  if (phone !== undefined) {
    const cleaned = typeof phone === 'string' ? phone.trim() : null;
    // Basic E.164-ish sanity: must be digits + optional leading + and 7-18 chars
    if (cleaned && !/^\+?[\d\s\-()]{7,24}$/.test(cleaned)) return fail(res, 'invalid_phone');
    sets.push('phone = ?'); vals.push(cleaned || null);
  }
  if (whatsapp_opt_in !== undefined) {
    sets.push('whatsapp_opt_in = ?'); vals.push(whatsapp_opt_in ? 1 : 0);
  }
  if (first_name !== undefined) { sets.push('first_name = ?'); vals.push(String(first_name).trim()); }
  if (last_name  !== undefined) { sets.push('last_name = ?');  vals.push(String(last_name).trim()); }
  if (sets.length === 0) return fail(res, 'nothing_to_update');
  vals.push(req.user!.id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare(
    `SELECT id, email, first_name, last_name, role, phone, whatsapp_opt_in FROM users WHERE id = ?`
  ).get(req.user!.id);
  return ok(res, row);
});

router.get('/residents', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT
       usr.id,
       usr.first_name,
       usr.last_name,
       GROUP_CONCAT(DISTINCT un.number) AS unit_number,
       usr.role,
       usr.email
     FROM user_unit uu
     JOIN users usr ON usr.id = uu.user_id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE b.condominium_id = ? AND uu.status = 'active'
     GROUP BY usr.id
     ORDER BY MIN(CASE WHEN un.floor IS NULL THEN 9999 ELSE un.floor END), MIN(un.number), usr.last_name`
  ).all(condoId);
  return ok(res, rows);
});

export default router;
