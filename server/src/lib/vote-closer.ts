// Auto-closes proposals whose voting window has expired.
// Runs on an interval from server.ts. Idempotent — safe to run forever.
import db from '../db';
import {
  getProposalVoteTally,
  computeQuorum,
  resolveFinalOutcome,
} from './proposal-tally';

interface ProposalRow {
  id: number;
  condominium_id: number;
  voter_eligibility: string | null;
  quorum_percent: number;
  voting_closes_at: string | null;
  status: string;
}

/**
 * Close any `voting` proposals whose window has expired.
 * Returns the number of proposals closed in this tick.
 */
export function tickVoteCloser(now: Date = new Date()): number {
  const rows = db.prepare(
    `SELECT id, condominium_id, voter_eligibility, quorum_percent, voting_closes_at, status
     FROM proposals
     WHERE status = 'voting' AND voting_closes_at IS NOT NULL`
  ).all() as ProposalRow[];

  let closed = 0;
  for (const p of rows) {
    if (!p.voting_closes_at) continue;
    if (now.getTime() < new Date(p.voting_closes_at).getTime()) continue;

    const tally = getProposalVoteTally(p as any);
    const quorum = computeQuorum(p.condominium_id, tally, p.voter_eligibility, p.quorum_percent || 0);
    const outcome = resolveFinalOutcome(tally, quorum);
    const reason = !quorum.quorum_met ? 'quorum_not_met' : 'window_expired';

    const result = db.prepare(
      `UPDATE proposals
       SET status = ?, closed_at = CURRENT_TIMESTAMP, close_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'voting'`
    ).run(outcome, reason, p.id);
    if (result.changes > 0) {
      closed += 1;
      console.log(`[vote-closer] closed proposal ${p.id}: ${outcome} (${reason}), yes=${tally.yes_weight} no=${tally.no_weight} turnout=${quorum.turnout_percent}% quorum=${quorum.quorum_percent}%`);
    }
  }
  return closed;
}

/** Start the interval. Returns the handle so tests can stop it. */
export function startVoteCloser(intervalMs = 60_000): NodeJS.Timeout {
  // Run once on boot so a restart doesn't miss a stale window.
  try { tickVoteCloser(); } catch (e) { console.error('[vote-closer] boot tick error', e); }
  return setInterval(() => {
    try { tickVoteCloser(); } catch (e) { console.error('[vote-closer] tick error', e); }
  }, intervalMs).unref();
}
