import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireActiveMembership, requireRole, requireBoardCapability, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

router.get('/', requireAuth, requireActiveMembership, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT a.*, usr.first_name, usr.last_name
     FROM announcements a JOIN users usr ON usr.id = a.author_id
     WHERE a.condominium_id = ?
     ORDER BY a.pinned DESC, a.created_at DESC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

// Audit H-N8 — same Zod treatment as proposals: reject oversized fields and
// unknown sources up front instead of relying on the DB CHECK constraints.
const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  pinned: z.boolean().optional(),
  source: z.enum(['manual', 'ai', 'system']).optional(),
  related_proposal_id: z.number().int().positive().optional().nullable(),
});

router.post('/', requireAuth, requireActiveMembership, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const { title, body, pinned, source, related_proposal_id } = parsed.data;
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
