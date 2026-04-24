import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { notifyUsers } from '../lib/whatsapp';

const router = Router();

// List packages: residents see their own, board sees all for the condo
router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = u.role === 'board_admin'
    ? db.prepare(
        `SELECT p.*, usr.first_name, usr.last_name, usr.unit_number
         FROM packages p JOIN users usr ON usr.id = p.recipient_id
         WHERE p.condominium_id = ?
         ORDER BY p.arrived_at DESC`
      ).all(u.condominium_id)
    : db.prepare(
        `SELECT * FROM packages WHERE recipient_id = ? ORDER BY arrived_at DESC`
      ).all(u.id);
  return ok(res, rows);
});

router.post('/:id/pickup', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const pkg = db.prepare(
    `SELECT * FROM packages WHERE id = ? AND condominium_id = ?`
  ).get(id, u.condominium_id) as any;
  if (!pkg) return fail(res, 'not_found', 404);
  if (u.role !== 'board_admin' && pkg.recipient_id !== u.id) return fail(res, 'forbidden', 403);
  db.prepare(`UPDATE packages SET status='picked_up', picked_up_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
  return ok(res, { id, status: 'picked_up' });
});

// Board logs a new package
router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const { recipient_id, carrier, description } = req.body || {};
  if (!recipient_id || !carrier) return fail(res, 'missing_fields');
  const u = req.user!;
  const condoId = getActiveCondoId(req);
  // Recipient must live in the admin's condo.
  const recipient = db.prepare(
    `SELECT usr.id
     FROM users usr
     JOIN user_unit uu ON uu.user_id = usr.id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE usr.id = ? AND b.condominium_id = ? AND uu.status = 'active'
     LIMIT 1`
  ).get(recipient_id, condoId);
  if (!recipient) return fail(res, 'recipient_not_in_condo', 400);
  const row = db.prepare(
    `INSERT INTO packages (condominium_id, recipient_id, carrier, description)
     VALUES (?, ?, ?, ?)`
  ).run(condoId, recipient_id, carrier, description || null);

  // WhatsApp notification (fire-and-forget; never blocks response)
  const body = `📦 CondoOS — Uma encomenda (${carrier}) chegou para você na portaria. Passe para retirar!`;
  notifyUsers([recipient_id], body).catch((e) => console.warn('[packages] notify failed:', e?.message));

  return ok(res, { id: row.lastInsertRowid });
});

export default router;
