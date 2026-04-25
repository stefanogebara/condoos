import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest, getActiveCondoId } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { createRateLimit } from '../lib/rate-limit';
import { computeQuorum, getProposalVoteTally, resolveFinalOutcome } from '../lib/proposal-tally';
import { chat, parseJsonLoose } from '../ai/openrouter';
import {
  PROPOSAL_DRAFT_SYS,
  PROPOSAL_CLASSIFY_SYS,
  CLUSTER_SYS,
  THREAD_SUMMARY_SYS,
  MEETING_SUMMARY_SYS,
  EXPLAIN_SYS,
  DECISION_SUMMARY_SYS,
  ASSEMBLY_AGENDA_SYS,
  ASSEMBLY_ATA_SYS,
} from '../ai/prompts';
import { generateAtaMarkdown } from '../lib/assembly';
import {
  fallbackProposalDraft,
  fallbackCluster,
  fallbackThreadSummary,
  fallbackMeetingSummary,
  fallbackExplain,
  fallbackDecisionSummary,
} from '../ai/fallbacks';

const router = Router();
const aiRateLimit = createRateLimit({
  keyPrefix: 'ai',
  windowMs: 60 * 60_000,
  max: 60,
  key: (req) => String((req as AuthedRequest).user?.id || req.ip || 'unknown'),
});

function boundedText(value: unknown, max: number): { ok: true; text: string } | { ok: false; error: 'missing_text' | 'text_too_long' } {
  const text = String(value || '').trim();
  if (!text) return { ok: false, error: 'missing_text' };
  if (text.length > max) return { ok: false, error: 'text_too_long' };
  return { ok: true, text };
}

function clip(value: unknown, max: number): string {
  return String(value || '').slice(0, max);
}

// Helper to try AI, fall back silently on any error.
async function tryAI<T>(
  messages: any[],
  fallback: () => T,
  opts?: { jsonMode?: boolean; maxTokens?: number; label?: string; tier?: 'quality' | 'cheap' }
): Promise<T> {
  const label = opts?.label || 'ai';
  try {
    const raw = await chat(messages, {
      jsonMode: opts?.jsonMode,
      maxTokens: opts?.maxTokens,
      tier: opts?.tier,
    });
    if (opts?.jsonMode) {
      const parsed = parseJsonLoose<T>(raw);
      if (!parsed) {
        console.warn(`[${label}] JSON parse failed, using fallback. length=${raw.length}`);
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
router.post('/proposal-draft', requireAuth, aiRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  const input = boundedText(req.body?.text, 4_000);
  if (!input.ok) return fail(res, input.error, input.error === 'text_too_long' ? 413 : 400);
  const text = input.text;
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

// 1b. Classify a proposal title+description into one of 7 fixed categories.
// Uses the cheap tier (DeepSeek) — pure classification doesn't need Haiku quality.
const VALID_CATEGORIES = ['maintenance', 'infrastructure', 'safety', 'amenity', 'community', 'policy', 'financial'] as const;
function fallbackClassify(text: string): { category: string; confidence: number; reasoning: string } {
  const t = text.toLowerCase();
  const hits: Array<[string, RegExp]> = [
    ['safety',         /\b(safety|fire|smoke|camera|security|access|hazard|alarm|seguranç|cfˆmera|inc[eê]ndio)\b/i],
    ['financial',      /\b(fee|dues|budget|reserve|assess|audit|taxa|cond[oô]mino|or[çc]ament|fundo)\b/i],
    ['infrastructure', /\b(ev|solar|elevator|intern|upgrade|install.*(system|network)|elevador|rede)\b/i],
    ['amenity',        /\b(pool|gym|sauna|party|bbq|grill|piscina|acad|churr|sal[aã]o)\b/i],
    ['community',      /\b(event|party|welcome|neighbor|social|comemor|evento|vizinh)\b/i],
    ['policy',         /\b(rule|policy|bylaw|pet|guest|noise|quiet hours|regra|convenç|regiment|anim)\b/i],
    ['maintenance',    /\b(repair|fix|broken|replace|leak|malfunction|service|consert|quebrad|vazament|substitu)\b/i],
  ];
  for (const [cat, re] of hits) {
    if (re.test(t)) return { category: cat, confidence: 0.55, reasoning: `keyword match for "${cat}"` };
  }
  return { category: 'maintenance', confidence: 0.3, reasoning: 'default fallback — no clear keywords' };
}

router.post('/proposal-classify', requireAuth, aiRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  const text = typeof req.body?.text === 'string'
    ? req.body.text
    : [req.body?.title, req.body?.description].filter(Boolean).join('\n\n');
  const input = boundedText(text, 3_000);
  if (!input.ok) return fail(res, input.error, input.error === 'text_too_long' ? 413 : 400);
  const trimmed = input.text;

  const out = await tryAI<{ category: string; confidence: number; reasoning: string }>(
    [
      { role: 'system', content: PROPOSAL_CLASSIFY_SYS },
      { role: 'user', content: trimmed },
    ],
    () => fallbackClassify(trimmed),
    { jsonMode: true, maxTokens: 150, tier: 'cheap', label: 'proposal-classify' }
  );

  // Guard against model hallucinating a new category
  const category = (VALID_CATEGORIES as readonly string[]).includes(out.category)
    ? out.category
    : fallbackClassify(trimmed).category;
  const confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));
  const reasoning = typeof out.reasoning === 'string' ? out.reasoning.slice(0, 200) : '';
  return ok(res, { category, confidence, reasoning });
}));

// 2. Cluster all open suggestions for the condo
router.post('/cluster-suggestions', requireAuth, aiRateLimit, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT id, body FROM suggestions
     WHERE condominium_id=? AND status='open'
     ORDER BY created_at DESC LIMIT 50`
  ).all(u.condominium_id) as { id: number; body: string }[];

  if (rows.length === 0) return ok(res, { clusters: [], unclustered_ids: [] });

  const payload = rows.map((r) => `#${r.id}: ${clip(r.body, 1_000)}`).join('\n');
  const out = await tryAI<any>(
    [
      { role: 'system', content: CLUSTER_SYS },
      { role: 'user', content: `Here are the open suggestions:\n\n${payload}` },
    ],
    () => fallbackCluster(rows),
    { jsonMode: true, maxTokens: 1200, tier: 'cheap', label: 'cluster-suggestions' }
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
router.post('/proposals/:id/summarize-thread', requireAuth, aiRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
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

  const formatted = comments.slice(0, 100).map((c) => `- ${c.first_name} ${c.last_name}: ${clip(c.body, 1_000)}`).join('\n');
  const out = await tryAI<any>(
    [
      { role: 'system', content: THREAD_SUMMARY_SYS },
      { role: 'user', content: `Proposal: ${clip(prop.title, 300)}\n\nDescription: ${clip(prop.description, 4_000)}\n\nDiscussion:\n${formatted}` },
    ],
    () => fallbackThreadSummary(comments.length),
    { jsonMode: true, maxTokens: 800, label: 'summarize-thread' }
  );

  db.prepare(`UPDATE proposals SET ai_summary=? WHERE id=?`).run(JSON.stringify(out), id);
  return ok(res, out);
}));

// 4. Summarize a meeting + generate action items + draft resident announcement
router.post('/meetings/:id/summarize', requireAuth, aiRateLimit, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
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
      { role: 'user', content: `Meeting: ${clip(m.title, 300)}\nAgenda: ${clip(m.agenda || '(none)', 2_000)}\n\nRaw notes:\n${clip(m.raw_notes, 12_000)}` },
    ],
    () => fallbackMeetingSummary(clip(m.raw_notes, 12_000)),
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
router.post('/proposals/:id/explain', requireAuth, aiRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const p = db.prepare(
    `SELECT title, description FROM proposals WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as any;
  if (!p) return fail(res, 'not_found', 404);

  const text = await tryAI<string>(
    [
      { role: 'system', content: EXPLAIN_SYS },
      { role: 'user', content: `Title: ${clip(p.title, 300)}\n\nDescription: ${clip(p.description, 4_000)}` },
    ],
    () => fallbackExplain(p.title, p.description),
    { maxTokens: 500, label: 'explain' }
  );

  db.prepare(`UPDATE proposals SET ai_explainer=? WHERE id=?`).run(text, id);
  return ok(res, { explainer: text });
}));

// 6. Board-ready decision summary after vote closes
router.post('/proposals/:id/decision-summary', requireAuth, aiRateLimit, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const p = db.prepare(
    `SELECT * FROM proposals WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as any;
  if (!p) return fail(res, 'not_found', 404);
  const votes = getProposalVoteTally(p);
  const quorum = computeQuorum(p.condominium_id, votes, p.voter_eligibility, p.quorum_percent || 0);
  const outcome = resolveFinalOutcome(votes, quorum);

  const comments = db.prepare(
    `SELECT body FROM proposal_comments WHERE proposal_id=? ORDER BY created_at ASC LIMIT 20`
  ).all(id) as any[];

  const out = await tryAI<any>(
    [
      { role: 'system', content: DECISION_SUMMARY_SYS },
      {
        role: 'user',
        content: `Proposal: ${clip(p.title, 300)}\n\nDescription: ${clip(p.description, 4_000)}\n\nFinal vote: ${votes.yes} yes, ${votes.no} no, ${votes.abstain} abstain. Weighted tally: ${votes.yes_weight} yes, ${votes.no_weight} no, ${votes.abstain_weight} abstain (outcome: ${outcome}).\n\nRepresentative comments:\n${comments.map((c) => `- ${clip(c.body, 1_000)}`).join('\n')}`,
      },
    ],
    () => fallbackDecisionSummary(p.title, outcome, votes),
    { jsonMode: true, maxTokens: 800, label: 'decision-summary' }
  );

  db.prepare(
    `UPDATE proposals
     SET decision_summary = ?,
         status = ?,
         closed_at = CURRENT_TIMESTAMP,
         close_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(JSON.stringify(out), outcome, quorum.quorum_met ? 'manual_decision' : 'quorum_not_met', id);

  return ok(res, out);
}));

// =========================================================================
// Annual Assembly (AGO) AI routes
// =========================================================================

// Draft an agenda from the assembly title + condo's open proposals.
router.post('/assemblies/:id/suggest-agenda', requireAuth, aiRateLimit, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = db.prepare(
    `SELECT a.*, c.name AS condo_name FROM assemblies a JOIN condominiums c ON c.id = a.condominium_id
     WHERE a.id = ? AND a.condominium_id = ?`
  ).get(id, condoId) as any;
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'draft') return fail(res, 'locked_after_convocation', 409);

  const openProposals = db.prepare(
    `SELECT id, title, description FROM proposals
     WHERE condominium_id = ? AND status IN ('discussion','voting') ORDER BY created_at DESC LIMIT 10`
  ).all(condoId) as any[];

  const payload = {
    condo_name: a.condo_name,
    assembly_title: a.title,
    assembly_kind: a.kind,
    open_proposals: openProposals.map((p) => ({ ...p, title: clip(p.title, 300), description: clip(p.description, 1_500) })),
  };

  const out = await tryAI<{ items: Array<{ title: string; description: string; item_type: string; required_majority: string }> }>(
    [
      { role: 'system', content: ASSEMBLY_AGENDA_SYS },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    () => ({
      items: [
        { title: 'Prestação de contas', description: 'Review and approve the prior-year accounts.', item_type: 'accounts', required_majority: 'simple' },
        { title: 'Previsão orçamentária', description: `Approve the budget for the coming year at ${a.condo_name}.`, item_type: 'budget', required_majority: 'simple' },
        ...openProposals.slice(0, 3).map((p) => ({
          title: p.title,
          description: `Bring proposal #${p.id} to a formal vote.`,
          item_type: 'ordinary',
          required_majority: 'simple',
        })),
        { title: 'Assuntos gerais', description: 'Open discussion on any remaining topic raised by residents.', item_type: 'other', required_majority: 'simple' },
      ],
    }),
    { jsonMode: true, maxTokens: 800, label: 'assembly-agenda' }
  );
  return ok(res, out);
}));

// Polish the auto-generated ata through the LLM. Falls back to the raw markdown.
router.post('/assemblies/:id/draft-ata', requireAuth, aiRateLimit, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = db.prepare(
    `SELECT a.*, c.name AS condo_name FROM assemblies a JOIN condominiums c ON c.id = a.condominium_id
     WHERE a.id = ? AND a.condominium_id = ?`
  ).get(id, condoId) as any;
  if (!a) return fail(res, 'not_found', 404);

  const rawAta = generateAtaMarkdown(id);
  const polished = await tryAI<string>(
    [
      { role: 'system', content: ASSEMBLY_ATA_SYS },
      { role: 'user', content: clip(rawAta, 12_000) },
    ],
    () => rawAta,
    { jsonMode: false, maxTokens: 1500, label: 'assembly-ata' }
  );
  db.prepare(`UPDATE assemblies SET ata_markdown = ? WHERE id = ?`).run(polished, id);
  return ok(res, { ata_markdown: polished });
}));

export default router;
