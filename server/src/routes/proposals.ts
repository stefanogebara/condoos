import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import {
  attachVoteTally,
  canVote,
  resolveVoterRights,
  getProposalVoteTally,
  computeQuorum,
  resolveFinalOutcome,
} from '../lib/proposal-tally';
import { notifyCondoResidents } from '../lib/whatsapp';

const router = Router();

/** Fetches a proposal only if it belongs to the user's condo. Null otherwise. */
function getScopedProposal(id: number, condoId: number) {
  return db.prepare(
    `SELECT p.*, usr.first_name AS author_first, usr.last_name AS author_last
     FROM proposals p JOIN users usr ON usr.id = p.author_id
     WHERE p.id = ? AND p.condominium_id = ?`
  ).get(id, condoId) as any;
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT p.*, usr.first_name AS author_first, usr.last_name AS author_last
     FROM proposals p JOIN users usr ON usr.id = p.author_id
     WHERE p.condominium_id = ?
     ORDER BY
       CASE p.status WHEN 'voting' THEN 1 WHEN 'discussion' THEN 2 WHEN 'approved' THEN 3 WHEN 'rejected' THEN 4 ELSE 5 END,
       p.created_at DESC`
  ).all(condoId) as any[];
  return ok(res, rows.map(attachVoteTally));
});

router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const p = getScopedProposal(id, condoId);
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
  const rights = resolveVoterRights(req.user!.id, condoId);
  const can_vote = canVote(req.user!.id, condoId, p.voter_eligibility);
  const tally = getProposalVoteTally(p);
  const quorum = computeQuorum(condoId, tally, p.voter_eligibility, p.quorum_percent || 0);
  return ok(res, {
    ...p,
    votes: tally,
    quorum,
    comments,
    voters: votes,
    my_vote: myVote,
    voter_rights: { ...rights, can_vote, proposal_eligibility: p.voter_eligibility },
  });
});

router.post('/', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const condoId = getActiveCondoId(req);
  const { title, description, category, estimated_cost, ai_drafted, source_suggestion_id, voter_eligibility } = req.body || {};
  if (!title || !description) return fail(res, 'missing_fields');

  const eligibility = ['all', 'owners_only', 'primary_contact_only'].includes(voter_eligibility)
    ? voter_eligibility
    : 'all';

  if (source_suggestion_id) {
    const s = db.prepare(`SELECT condominium_id FROM suggestions WHERE id=?`).get(source_suggestion_id) as any;
    if (!s || s.condominium_id !== condoId) return fail(res, 'forbidden', 403);
  }

  const row = db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, category, estimated_cost, ai_drafted, source_suggestion_id, voter_eligibility, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discussion')`
  ).run(condoId, u.id, title, description, category || null, estimated_cost || null, ai_drafted ? 1 : 0, source_suggestion_id || null, eligibility);
  if (source_suggestion_id) {
    db.prepare(`UPDATE suggestions SET status='promoted', promoted_proposal_id=? WHERE id=?`)
      .run(row.lastInsertRowid, source_suggestion_id);
  }
  return ok(res, { id: row.lastInsertRowid });
});

router.post('/:id/comments', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!;
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const p = getScopedProposal(id, condoId);
  if (!p) return fail(res, 'not_found', 404);
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
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const choice = req.body?.choice;
  if (!['yes','no','abstain'].includes(choice)) return fail(res, 'invalid_choice');
  const p = getScopedProposal(id, condoId);
  if (!p) return fail(res, 'not_found', 404);
  if (p.status !== 'voting') return fail(res, 'not_in_voting', 409);
  const now = Date.now();
  if (p.voting_opens_at && now < new Date(p.voting_opens_at).getTime()) {
    return fail(res, 'voting_not_open_yet', 409);
  }
  if (p.voting_closes_at && now >= new Date(p.voting_closes_at).getTime()) {
    return fail(res, 'voting_closed', 409);
  }
  if (!canVote(u.id, condoId, p.voter_eligibility)) {
    return fail(res, 'not_eligible_to_vote', 403);
  }
  db.prepare(
    `INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, ?)
     ON CONFLICT(proposal_id, user_id) DO UPDATE SET choice=excluded.choice`
  ).run(id, u.id, choice);
  return ok(res, { id, choice });
});

// PATCH /:id/compliance — set quorum + voting window while the proposal is in discussion.
router.patch('/:id/compliance', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const p = getScopedProposal(id, condoId);
  if (!p) return fail(res, 'not_found', 404);
  if (p.status !== 'discussion') return fail(res, 'locked_once_voting_opens', 409);

  const body = req.body || {};
  const quorum = body.quorum_percent;
  const opens  = body.voting_opens_at;
  const closes = body.voting_closes_at;

  if (quorum !== undefined) {
    if (typeof quorum !== 'number' || quorum < 0 || quorum > 100) {
      return fail(res, 'invalid_quorum');
    }
  }
  if (opens !== undefined && opens !== null && isNaN(Date.parse(opens))) return fail(res, 'invalid_opens_at');
  if (closes !== undefined && closes !== null && isNaN(Date.parse(closes))) return fail(res, 'invalid_closes_at');
  if (opens && closes && new Date(opens) >= new Date(closes)) return fail(res, 'closes_must_be_after_opens');

  const sets: string[] = [];
  const vals: any[] = [];
  if (quorum !== undefined) { sets.push('quorum_percent = ?');   vals.push(Math.round(quorum)); }
  if (opens  !== undefined) { sets.push('voting_opens_at = ?');  vals.push(opens || null); }
  if (closes !== undefined) { sets.push('voting_closes_at = ?'); vals.push(closes || null); }
  if (sets.length === 0) return fail(res, 'nothing_to_update');
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  db.prepare(`UPDATE proposals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return ok(res, { id, updated: sets.length - 1 });
});

// Admin can change who is allowed to vote, but only while the proposal is still in discussion.
router.patch('/:id/eligibility', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const eligibility = req.body?.voter_eligibility;
  if (!['all', 'owners_only', 'primary_contact_only'].includes(eligibility)) {
    return fail(res, 'invalid_eligibility');
  }
  const p = getScopedProposal(id, condoId);
  if (!p) return fail(res, 'not_found', 404);
  if (p.status !== 'discussion') return fail(res, 'locked_once_voting_opens', 409);
  db.prepare(`UPDATE proposals SET voter_eligibility=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(eligibility, id);
  return ok(res, { id, voter_eligibility: eligibility });
});

router.post('/:id/status', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const status = req.body?.status;
  const valid = ['discussion','voting','approved','rejected','completed'];
  if (!valid.includes(status)) return fail(res, 'invalid_status');
  const p = getScopedProposal(id, condoId);
  if (!p) return fail(res, 'not_found', 404);
  db.prepare(`UPDATE proposals SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, id);

  // When voting opens, nudge all residents. The WhatsApp stub is fire-and-forget.
  if (status === 'voting' && p.status !== 'voting') {
    const closesText = p.voting_closes_at
      ? ` Fechamento: ${new Date(p.voting_closes_at).toLocaleString('pt-BR')}.`
      : '';
    const body = `🗳️ CondoOS — A votação está aberta para "${p.title}".${closesText} Vote pelo app.`;
    notifyCondoResidents(condoId, body).catch((e) => console.warn('[proposals/status] notify failed:', e?.message));
  }

  return ok(res, { id, status });
});

export default router;
