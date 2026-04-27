import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT a.*, usr.first_name, usr.last_name
     FROM announcements a JOIN users usr ON usr.id = a.author_id
     WHERE a.condominium_id = ?
     ORDER BY a.pinned DESC, a.created_at DESC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const { title, body, pinned, source, related_proposal_id } = req.body || {};
  if (!title || !body) return fail(res, 'missing_fields');
  const row = db.prepare(
    `INSERT INTO announcements (condominium_id, author_id, title, body, pinned, source, related_proposal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(u.condominium_id, u.id, title, body, pinned ? 1 : 0, source || 'manual', related_proposal_id || null);
  audit(req, {
    action: 'announcement.create',
    target_type: 'announcement',
    target_id: Number(row.lastInsertRowid),
    condominium_id: u.condominium_id,
    metadata: { source: source || 'manual', pinned: !!pinned, related_proposal_id: related_proposal_id || null },
  });
  return ok(res, { id: row.lastInsertRowid });
});

export default router;
