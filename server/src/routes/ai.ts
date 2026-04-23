import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { chat, parseJsonLoose } from '../ai/openrouter';
import {
  PROPOSAL_DRAFT_SYS,
  CLUSTER_SYS,
  THREAD_SUMMARY_SYS,
  MEETING_SUMMARY_SYS,
  EXPLAIN_SYS,
  DECISION_SUMMARY_SYS,
} from '../ai/prompts';
import {
  fallbackProposalDraft,
  fallbackCluster,
  fallbackThreadSummary,
  fallbackMeetingSummary,
  fallbackExplain,
  fallbackDecisionSummary,
} from '../ai/fallbacks';

const router = Router();

// Helper to try AI, fall back silently on any error.
async function tryAI<T>(
  messages: any[],
  fallback: () => T,
  opts?: { jsonMode?: boolean; maxTokens?: number; label?: string }
): Promise<T> {
  const label = opts?.label || 'ai';
  try {
    const raw = await chat(messages, { jsonMode: opts?.jsonMode, maxTokens: opts?.maxTokens });
    if (opts?.jsonMode) {
      const parsed = parseJsonLoose<T>(raw);
      if (!parsed) {
        console.warn(`[${label}] JSON parse failed, using fallback. First 300 chars:`, raw.slice(0, 300));
        return fallback();
      }
      return parsed;
    }
    return raw as unknown as T;
  } catch (err) {
    console.warn(`[${label}] fallback used:`, (err as Error).message);
    return fallback();
  }
}

// 1. Draft a proposal from free-text resident suggestion
router.post('/proposal-draft', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return fail(res, 'missing_text');
  const out = await tryAI(
    [
      { role: 'system', content: PROPOSAL_DRAFT_SYS },
      { role: 'user', content: text },
    ],
    () => fallbackProposalDraft(text),
    { jsonMode: true, maxTokens: 600, label: 'proposal-draft' }
  );
  return ok(res, out);
}));

// 2. Cluster all open suggestions for the condo
router.post('/cluster-suggestions', requireAuth, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT id, body FROM suggestions
     WHERE condominium_id=? AND status='open'
     ORDER BY created_at DESC LIMIT 50`
  ).all(u.condominium_id) as { id: number; body: string }[];

  if (rows.length === 0) return ok(res, { clusters: [], unclustered_ids: [] });

  const payload = rows.map((r) => `#${r.id}: ${r.body}`).join('\n');
  const out = await tryAI<any>(
    [
      { role: 'system', content: CLUSTER_SYS },
      { role: 'user', content: `Here are the open suggestions:\n\n${payload}` },
    ],
    () => fallbackCluster(rows),
    { jsonMode: true, maxTokens: 1200, label: 'cluster-suggestions' }
  );

  // Persist clusters
  db.prepare(
    `DELETE FROM suggestion_clusters WHERE condominium_id=?`
  ).run(u.condominium_id);
  db.prepare(
    `UPDATE suggestions SET cluster_id=NULL WHERE condominium_id=?`
  ).run(u.condominium_id);

  const insertCluster = db.prepare(
    `INSERT INTO suggestion_clusters (condominium_id, label, summary) VALUES (?, ?, ?)`
  );
  const assign = db.prepare(`UPDATE suggestions SET cluster_id=?, category=? WHERE id=?`);

  const persisted: any[] = [];
  for (const c of out.clusters || []) {
    const result = insertCluster.run(u.condominium_id, c.label || 'Untitled', c.summary || null);
    const cid = Number(result.lastInsertRowid);
    for (const sid of c.suggestion_ids || []) assign.run(cid, c.label || null, sid);
    persisted.push({ id: cid, label: c.label, summary: c.summary, suggestion_ids: c.suggestion_ids });
  }
  return ok(res, { clusters: persisted, unclustered_ids: out.unclustered_ids || [], fallback: out._fallback === true });
}));

// 3. Summarize a proposal's discussion thread
router.post('/proposals/:id/summarize-thread', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const prop = db.prepare(
    `SELECT title, description FROM proposals WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as any;
  if (!prop) return fail(res, 'not_found', 404);
  const comments = db.prepare(
    `SELECT c.body, usr.first_name, usr.last_name
     FROM proposal_comments c JOIN users usr ON usr.id=c.author_id
     WHERE c.proposal_id=? ORDER BY c.created_at ASC`
  ).all(id) as any[];

  if (comments.length === 0) {
    return ok(res, { summary: 'No discussion yet.', points_of_agreement: [], points_of_disagreement: [], open_questions: [] });
  }

  const formatted = comments.map((c) => `- ${c.first_name} ${c.last_name}: ${c.body}`).join('\n');
  const out = await tryAI<any>(
    [
      { role: 'system', content: THREAD_SUMMARY_SYS },
      { role: 'user', content: `Proposal: ${prop.title}\n\nDescription: ${prop.description}\n\nDiscussion:\n${formatted}` },
    ],
    () => fallbackThreadSummary(comments.length),
    { jsonMode: true, maxTokens: 800, label: 'summarize-thread' }
  );

  db.prepare(`UPDATE proposals SET ai_summary=? WHERE id=?`).run(JSON.stringify(out), id);
  return ok(res, out);
}));

// 4. Summarize a meeting + generate action items + draft resident announcement
router.post('/meetings/:id/summarize', requireAuth, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const m = db.prepare(
    `SELECT * FROM meetings WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as any;
  if (!m) return fail(res, 'not_found', 404);
  if (!m.raw_notes || !m.raw_notes.trim()) return fail(res, 'no_notes', 400);

  const out = await tryAI<any>(
    [
      { role: 'system', content: MEETING_SUMMARY_SYS },
      { role: 'user', content: `Meeting: ${m.title}\nAgenda: ${m.agenda || '(none)'}\n\nRaw notes:\n${m.raw_notes}` },
    ],
    () => fallbackMeetingSummary(m.raw_notes),
    { jsonMode: true, maxTokens: 1800, label: 'meetings/summarize' }
  );

  db.prepare(`UPDATE meetings SET ai_summary=?, status='completed' WHERE id=?`).run(JSON.stringify(out), id);

  // Persist action items
  db.prepare(`DELETE FROM action_items WHERE meeting_id=?`).run(id);
  const insertAI = db.prepare(
    `INSERT INTO action_items (meeting_id, description, owner_label, due_date) VALUES (?, ?, ?, ?)`
  );
  for (const a of out.action_items || []) {
    insertAI.run(id, a.description, a.owner_label || null, a.due_date || null);
  }

  return ok(res, out);
}));

// 5. Plain-language explainer for residents
router.post('/proposals/:id/explain', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const p = db.prepare(
    `SELECT title, description FROM proposals WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as any;
  if (!p) return fail(res, 'not_found', 404);

  const text = await tryAI<string>(
    [
      { role: 'system', content: EXPLAIN_SYS },
      { role: 'user', content: `Title: ${p.title}\n\nDescription: ${p.description}` },
    ],
    () => fallbackExplain(p.title, p.description),
    { maxTokens: 500, label: 'explain' }
  );

  db.prepare(`UPDATE proposals SET ai_explainer=? WHERE id=?`).run(text, id);
  return ok(res, { explainer: text });
}));

// 6. Board-ready decision summary after vote closes
router.post('/proposals/:id/decision-summary', requireAuth, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const p = db.prepare(
    `SELECT * FROM proposals WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as any;
  if (!p) return fail(res, 'not_found', 404);
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN choice='yes' THEN 1 ELSE 0 END) AS yes,
       SUM(CASE WHEN choice='no' THEN 1 ELSE 0 END) AS no,
       SUM(CASE WHEN choice='abstain' THEN 1 ELSE 0 END) AS abstain
     FROM proposal_votes WHERE proposal_id=?`
  ).get(id) as any;

  const votes = { yes: counts.yes || 0, no: counts.no || 0, abstain: counts.abstain || 0 };
  const outcome: 'approved' | 'rejected' | 'inconclusive' =
    votes.yes > votes.no ? 'approved' : votes.no > votes.yes ? 'rejected' : 'inconclusive';

  const comments = db.prepare(
    `SELECT body FROM proposal_comments WHERE proposal_id=? ORDER BY created_at ASC LIMIT 20`
  ).all(id) as any[];

  const out = await tryAI<any>(
    [
      { role: 'system', content: DECISION_SUMMARY_SYS },
      {
        role: 'user',
        content: `Proposal: ${p.title}\n\nDescription: ${p.description}\n\nFinal vote: ${votes.yes} yes, ${votes.no} no, ${votes.abstain} abstain (outcome: ${outcome}).\n\nRepresentative comments:\n${comments.map((c) => `- ${c.body}`).join('\n')}`,
      },
    ],
    () => fallbackDecisionSummary(p.title, outcome, votes),
    { jsonMode: true, maxTokens: 800, label: 'decision-summary' }
  );

  db.prepare(
    `UPDATE proposals SET decision_summary=?, status=? WHERE id=?`
  ).run(JSON.stringify(out), outcome === 'approved' ? 'approved' : outcome === 'rejected' ? 'rejected' : p.status, id);

  return ok(res, out);
}));

export default router;
