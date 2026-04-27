import { Router } from 'express';
import db from '../db';
import { requireAuth, AuthedRequest } from '../lib/auth';
import { ok } from '../lib/respond';
import { listUserMembershipHistory } from '../lib/memberships';

const router = Router();

// Read-only access to historical records for moved-out / revoked residents.
// This intentionally does not require an active membership.
router.get('/history', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const memberships = listUserMembershipHistory(userId);

  const votes = db.prepare(
    `SELECT v.proposal_id, v.choice, v.created_at,
            p.title AS proposal_title, p.status AS proposal_status,
            p.condominium_id
     FROM proposal_votes v
     JOIN proposals p ON p.id = v.proposal_id
     WHERE v.user_id = ?
     ORDER BY v.created_at DESC`
  ).all(userId);

  const comments = db.prepare(
    `SELECT c.id, c.proposal_id, c.body, c.created_at,
            p.title AS proposal_title, p.condominium_id
     FROM proposal_comments c
     JOIN proposals p ON p.id = c.proposal_id
     WHERE c.author_id = ?
     ORDER BY c.created_at DESC`
  ).all(userId);

  return ok(res, { memberships, votes, comments });
});

export default router;
