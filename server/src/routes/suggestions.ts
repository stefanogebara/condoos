import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, requireBoardCapability, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT s.*, usr.first_name, usr.last_name, usr.unit_number,
            c.label AS cluster_label
     FROM suggestions s
     JOIN users usr ON usr.id = s.author_id
     LEFT JOIN suggestion_clusters c ON c.id = s.cluster_id
     WHERE s.condominium_id = ?
     ORDER BY s.created_at DESC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

// Audit H-N8 — cap body at 4000 chars so a malicious resident can't blow up
// the AI clustering prompt cost via multi-megabyte suggestions.
const createSuggestionSchema = z.object({
  body: z.string().min(1).max(4000),
});

router.post('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const parsed = createSuggestionSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const body = parsed.data.body.trim();
  if (!body) return fail(res, 'empty_body');
  const row = db.prepare(
    `INSERT INTO suggestions (condominium_id, author_id, body) VALUES (?, ?, ?)`
  ).run(u.condominium_id, u.id, body);
  audit(req, {
    action: 'suggestion.create',
    target_type: 'suggestion',
    target_id: Number(row.lastInsertRowid),
    condominium_id: u.condominium_id,
  });
  return ok(res, { id: row.lastInsertRowid });
});

router.get('/clusters', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const clusters = db.prepare(
    `SELECT * FROM suggestion_clusters WHERE condominium_id = ? ORDER BY created_at DESC`
  ).all(u.condominium_id) as any[];
  const withMembers = clusters.map((c) => ({
    ...c,
    members: db.prepare(
      `SELECT s.*, usr.first_name, usr.last_name, usr.unit_number
       FROM suggestions s JOIN users usr ON usr.id = s.author_id
       WHERE s.cluster_id = ? ORDER BY s.created_at DESC`
    ).all(c.id),
  }));
  return ok(res, withMembers);
});

router.post('/:id/dismiss', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const s = db.prepare(`SELECT id FROM suggestions WHERE id=? AND condominium_id=?`).get(id, u.condominium_id);
  if (!s) return fail(res, 'not_found', 404);
  db.prepare(`UPDATE suggestions SET status='dismissed' WHERE id=?`).run(id);
  audit(req, {
    action: 'suggestion.dismiss',
    target_type: 'suggestion',
    target_id: id,
    condominium_id: u.condominium_id,
  });
  return ok(res, { id, status: 'dismissed' });
});

export default router;
