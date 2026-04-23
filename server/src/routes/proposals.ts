import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';

const router = Router();

function withCounts(row: any) {
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN choice='yes' THEN 1 ELSE 0 END) AS yes,
       SUM(CASE WHEN choice='no' THEN 1 ELSE 0 END) AS no,
       SUM(CASE WHEN choice='abstain' THEN 1 ELSE 0 END) AS abstain,
       COUNT(*) AS total
     FROM proposal_votes WHERE proposal_id = ?`
  ).get(row.id) as any;
  return { ...row, votes: counts };
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT p.*, usr.first_name AS author_first, usr.last_name AS author_last
     FROM proposals p JOIN users usr ON usr.id = p.author_id
     WHERE p.condominium_id = ?
     ORDER BY
       CASE p.status WHEN 'voting' THEN 1 WHEN 'discussion' THEN 2 WHEN 'approved' THEN 3 WHEN 'rejected' THEN 4 ELSE 5 END,
       p.created_at DESC`
  ).all(u.condominium_id) as any[];
  return ok(res, rows.map(withCounts));
});

router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const p = db.prepare(
    `SELECT p.*, usr.first_name AS author_first, usr.last_name AS author_last
     FROM proposals p JOIN users usr ON usr.id = p.author_id WHERE p.id = ?`
  ).get(id) as any;
  if (!p) return fail(res, 'not_found', 404);
  const comments = db.prepare(
    `SELECT c.*, usr.first_name, usr.last_name, usr.unit_number
     FROM proposal_comments c JOIN users usr ON usr.id = c.author_id
     WHERE c.proposal_id = ? ORDER BY c.created_at ASC`
  ).all(id);
  const votes = db.prepare(
    `SELECT v.*, usr.first_name, usr.last_name
     FROM proposal_votes v JOIN users usr ON usr.id = v.user_id
     WHERE v.proposal_id = ?`
  ).all(id);
  const myVote = (db.prepare(
    `SELECT choice FROM proposal_votes WHERE proposal_id=? AND user_id=?`
  ).get(id, req.user!.id) as any)?.choice || null;
  return ok(res, { ...withCounts(p), comments, voters: votes, my_vote: myVote });
});

router.post('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const { title, description, category, estimated_cost, ai_drafted, source_suggestion_id } = req.body || {};
  if (!title || !description) return fail(res, 'missing_fields');
  const row = db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, category, estimated_cost, ai_drafted, source_suggestion_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discussion')`
  ).run(u.condominium_id, u.id, title, description, category || null, estimated_cost || null, ai_drafted ? 1 : 0, source_suggestion_id || null);
  if (source_suggestion_id) {
    db.prepare(`UPDATE suggestions SET status='promoted', promoted_proposal_id=? WHERE id=?`)
      .run(row.lastInsertRowid, source_suggestion_id);
  }
  return ok(res, { id: row.lastInsertRowid });
});

router.post('/:id/comments', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const body = (req.body?.body || '').trim();
  if (!body) return fail(res, 'empty_body');
  const row = db.prepare(
    `INSERT INTO proposal_comments (proposal_id, author_id, body) VALUES (?, ?, ?)`
  ).run(id, u.id, body);
  db.prepare(`UPDATE proposals SET updated_at=CURRENT_TIMESTAMP, ai_summary=NULL WHERE id=?`).run(id);
  return ok(res, { id: row.lastInsertRowid });
});

router.post('/:id/vote', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const choice = req.body?.choice;
  if (!['yes','no','abstain'].includes(choice)) return fail(res, 'invalid_choice');
  const p = db.prepare(`SELECT status FROM proposals WHERE id=?`).get(id) as any;
  if (!p) return fail(res, 'not_found', 404);
  if (p.status !== 'voting') return fail(res, 'not_in_voting', 409);
  db.prepare(
    `INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, ?)
     ON CONFLICT(proposal_id, user_id) DO UPDATE SET choice=excluded.choice`
  ).run(id, u.id, choice);
  return ok(res, { id, choice });
});

router.post('/:id/status', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  const valid = ['discussion','voting','approved','rejected','completed'];
  if (!valid.includes(status)) return fail(res, 'invalid_status');
  db.prepare(`UPDATE proposals SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, id);
  return ok(res, { id, status });
});

export default router;
