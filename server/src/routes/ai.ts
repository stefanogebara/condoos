import { Router, type Response } from 'express';
import db from '../db';
import { requireAuth, requireRole, requireBoardCapability, AuthedRequest, getActiveCondoId } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { createRateLimit } from '../lib/rate-limit';
import { audit } from '../lib/audit';
import { computeQuorum, getProposalVoteTally, resolveFinalOutcome } from '../lib/proposal-tally';
import { aiBreakerState, chat, parseJsonLoose } from '../ai/openrouter';
import {
  PROPOSAL_DRAFT_SYS,
  PROPOSAL_CLASSIFY_SYS,
  CLUSTER_SYS,
  THREAD_SUMMARY_SYS,
  MEETING_SUMMARY_SYS,
  EXPLAIN_SYS,
  DECISION_SUMMARY_SYS,
  PROPOSAL_COST_ANALYSIS_SYS,
  ASSEMBLY_AGENDA_SYS,
  ASSEMBLY_ATA_SYS,
  ADMIN_AGENT_SYS,
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
import { runAdminAgent } from '../ai/admin-agent-runner';
import { presentAdminAgentForOperator } from '../ai/admin-agent';
import { getAgentRunSnapshot } from '../lib/agent-runs';
import { getAiUsageSummary } from '../lib/ai-usage';

const router = Router();
const aiRateLimit = createRateLimit({
  keyPrefix: 'ai',
  windowMs: 60_000,
  max: 30,
  key: (req) => String((req as AuthedRequest).user?.id || req.ip || 'unknown'),
});

// SEC-M3 — Per-condo budget on top of the per-user limit. A condo with
// 5 board admins could otherwise burst 5×30=150 LLM-bound requests per
// minute, each potentially fanning out to 6 ReAct rounds = 900 model
// calls/min on OpenRouter. The per-condo cap puts the building's
// shared budget in one bucket regardless of how many board members
// are hammering the workbench. Generous enough that legitimate work
// (one admin per minute average, with bursts) never trips it.
const aiCondoRateLimit = createRateLimit({
  keyPrefix: 'ai_condo',
  windowMs: 60_000,
  max: 60,
  key: (req) => {
    const r = req as AuthedRequest;
    const condoId = r.user?.condominium_id;
    return condoId ? `condo:${condoId}` : `user:${r.user?.id || r.ip || 'unknown'}`;
  },
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

function optionalText(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

function wantsAdminAgentDebug(req: AuthedRequest): boolean {
  return req.query.include_debug === '1' ||
    req.query.debug === '1' ||
    req.body?.include_debug === true ||
    req.body?.debug === true;
}

// Helper to try AI, fall back silently on any error.
async function tryAI<T>(
  messages: any[],
  fallback: () => T,
  opts?: { jsonMode?: boolean; maxTokens?: number; label?: string; tier?: 'quality' | 'cheap'; condoId?: number | null; res?: Response }
): Promise<T> {
  const label = opts?.label || 'ai';
  // When we degrade to canned output, stamp X-AI-Status so the client can
  // tell a real AI response from a fallback. 'unavailable' = the credit
  // circuit breaker is open (systemic outage); 'degraded' = this one call
  // failed or returned unparseable JSON. Absent header = 'ok'.
  const markDegraded = () => {
    if (opts?.res && !opts.res.headersSent) {
      opts.res.setHeader('X-AI-Status', aiBreakerState().open ? 'unavailable' : 'degraded');
    }
  };
  try {
    const raw = await chat(messages, {
      jsonMode: opts?.jsonMode,
      maxTokens: opts?.maxTokens,
      tier: opts?.tier,
      caller: `ai:${label}`,
      condoId: opts?.condoId,
    });
    if (opts?.jsonMode) {
      const parsed = parseJsonLoose<T>(raw);
      if (!parsed) {
        console.warn(`[${label}] JSON parse failed, using fallback. length=${raw.length}`);
        markDegraded();
        return fallback();
      }
      return parsed;
    }
    return raw as unknown as T;
  } catch (err) {
    console.warn(`[${label}] fallback used:`, (err as Error).message);
    markDegraded();
    return fallback();
  }
}

// 1. Draft a proposal from free-text resident suggestion.
// `locale` (optional) forces the model to respond in that language regardless
// of what the resident wrote — e.g. an English-locale user typing PT still
// gets an English proposal back, so the demo stays single-language.
const LOCALE_NAMES: Record<string, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'en-US': 'English',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
};
router.post('/proposal-draft', requireAuth, aiRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const input = boundedText(req.body?.text, 4_000);
  if (!input.ok) return fail(res, input.error, input.error === 'text_too_long' ? 413 : 400);
  const text = input.text;
  const localeRaw = typeof req.body?.locale === 'string' ? req.body.locale : '';
  const localeName = LOCALE_NAMES[localeRaw] || '';
  const localeOverride = localeName
    ? `\n\n## Output language\nRespond ONLY in ${localeName}. If the resident wrote in another language, translate as you draft. Do not echo the input language.`
    : '';
  const out = await tryAI(
    [
      { role: 'system', content: PROPOSAL_DRAFT_SYS + localeOverride },
      { role: 'user', content: text },
    ],
    () => fallbackProposalDraft(text),
    { jsonMode: true, maxTokens: 600, label: 'proposal-draft', condoId, res }
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
  const condoId = getActiveCondoId(req);
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
    { jsonMode: true, maxTokens: 150, tier: 'cheap', label: 'proposal-classify', condoId, res }
  );

  // Guard against model hallucinating a new category
  const category = (VALID_CATEGORIES as readonly string[]).includes(out.category)
    ? out.category
    : fallbackClassify(trimmed).category;
  const confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));
  const reasoning = typeof out.reasoning === 'string' ? out.reasoning.slice(0, 200) : '';
  return ok(res, { category, confidence, reasoning });
}));

// 1c. General admin operations agent: repair/install workbench.
// Delegates to runAdminAgent so the workbench shares ONE implementation
// with the auto-dispatch path on tickets. Previously this route had its
// own duplicated context-builder which missed every enhancement made to
// the runner (vendor reputation joins, cost history from expenses,
// mojibake fix). Now they always stay in sync.
router.post('/admin-agent', requireAuth, aiRateLimit, aiCondoRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const input = boundedText(req.body?.task, 6_000);
  if (!input.ok) return fail(res, input.error, input.error === 'text_too_long' ? 413 : 400);
  // Min-length guard. The agent is expensive (4 model calls in ReAct +
  // optional vision); single-character / one-word inputs produce noise.
  // The client already prompts for 10+ chars but admins can paste short
  // text or click rapidly. 8 unicode chars after trim is the floor.
  if (input.text.length < 8) return fail(res, 'task_too_short', 400);
  const condoId = getActiveCondoId(req);
  const adminUserId = req.user!.id;

  // Thread bookkeeping. When the client omits thread_id, we create a
  // fresh thread on the admin's behalf — title derived from the first
  // 80 chars of the task so the side panel has a readable label. When
  // thread_id is provided, validate it belongs to this admin + condo
  // before appending to it (prevents cross-tenant context leakage).
  let threadId: number | undefined;
  const requested = Number(req.body?.thread_id);
  if (Number.isInteger(requested) && requested > 0) {
    const owner = db.prepare(
      `SELECT id FROM agent_threads WHERE id = ? AND condominium_id = ? AND admin_user_id = ?`
    ).get(requested, condoId, adminUserId);
    if (!owner) return fail(res, 'thread_not_found', 404);
    threadId = requested;
  } else {
    const title = input.text.split(/[\n.!?]/)[0].slice(0, 80) || 'Nova conversa';
    const r = db.prepare(
      `INSERT INTO agent_threads (condominium_id, admin_user_id, title, mode)
       VALUES (?, ?, ?, ?)`
    ).run(condoId, adminUserId, title, String(req.body?.mode || 'general').slice(0, 40));
    threadId = Number(r.lastInsertRowid);
  }

  const { plan, fallback, turn_index, agent_run_id } = await runAdminAgent({
    condoId,
    task: input.text,
    mode: req.body?.mode,
    locale: optionalText(req.body?.locale, 20),
    location: optionalText(req.body?.location, 240),
    budget: optionalText(req.body?.budget, 120),
    urgency: optionalText(req.body?.urgency, 120),
    threadId,
    adminUserId,
  });

  audit(req, {
    action: 'ai.admin_agent',
    target_type: 'ai_admin_agent',
    target_id: threadId,
    condominium_id: condoId,
    metadata: {
      mode: plan.task_type,
      task_type: plan.task_type,
      option_count: plan.options.length,
      service_contact_matches: plan.existing_network_fit.length,
      fallback,
      thread_id: threadId,
      turn_index,
      agent_run_id,
    },
  });
  // Explicit status the workbench reads directly. 'unavailable' = the
  // credit breaker is open (systemic — AI is down); 'degraded' = a one-off
  // failure dropped this run to the deterministic template; 'ok' = real
  // LLM output. The _fallback bool is kept for backward compatibility.
  const isFallback = fallback || !!plan._fallback;
  const ai_status: 'ok' | 'degraded' | 'unavailable' = isFallback
    ? (aiBreakerState().open ? 'unavailable' : 'degraded')
    : 'ok';
  return ok(res, presentAdminAgentForOperator(plan, {
    includeDebug: wantsAdminAgentDebug(req),
    fallback: isFallback,
    ai_status,
    thread_id: threadId,
    turn_index,
    agent_run_id,
  }));
}));

// Board-admin AI operations status: credit-breaker state + condo-scoped spend.
router.get('/usage', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const days = Math.min(365, Math.max(1, Number(req.query.days || 7)));
  return ok(res, {
    breaker: aiBreakerState(),
    usage: getAiUsageSummary(days, condoId),
  });
});

// Recent durable agent runs. This is the operational audit trail for the
// workbench and background ticket agent without requiring log access.
// Live progress snapshot for a single agent run — the UI polls this
// during the 30-55s ReAct wait to show what the agent is currently
// doing instead of a blind spinner. Cheap (single row read) so polling
// every 1-2s is fine. Stops polling when status≠running.
router.get('/admin-agent/runs/:id', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  // SEC-H1 — pass caller id so the snapshot library can filter out
  // workbench runs belonging to a different admin in the same condo.
  // Ticket-bound runs remain visible to all condo admins.
  const snapshot = getAgentRunSnapshot(id, condoId, req.user!.id);
  if (!snapshot) return fail(res, 'not_found', 404);
  return ok(res, snapshot);
});

router.get('/admin-agent/runs', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const adminId = req.user!.id;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  // SEC-H1 — Workbench runs (thread_id IS NOT NULL) are scoped to the
  // admin who started the thread. Ticket-bound runs (thread_id NULL)
  // stay condo-wide so the board can review what the agent did on a
  // given ticket regardless of which admin verified it.
  const rows = db.prepare(
    `SELECT id, admin_user_id, thread_id, ticket_id, mode, task, status,
            attempt_count, fallback, model, react_enabled, duration_ms,
            last_error, started_at, finished_at, created_at
       FROM agent_runs
      WHERE condominium_id = ?
        AND (thread_id IS NULL OR admin_user_id = ?)
      ORDER BY created_at DESC
      LIMIT ?`
  ).all(condoId, adminId, limit);
  return ok(res, rows);
});

// List the admin's most-recent active threads. Capped at 20 — older
// threads are still in the DB (we don't auto-archive) but the UI only
// needs the recent window for the sidebar dropdown.
router.get('/admin-agent/threads', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const adminUserId = req.user!.id;
  const rows = db.prepare(
    `SELECT t.id, t.title, t.mode, t.status, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM agent_turns WHERE thread_id = t.id) AS turn_count
     FROM agent_threads t
     WHERE t.condominium_id = ? AND t.admin_user_id = ? AND t.status = 'active'
     ORDER BY t.updated_at DESC
     LIMIT 20`
  ).all(condoId, adminUserId);
  return ok(res, rows);
});

// Full thread — used when the admin opens a past conversation from the
// sidebar. Persisted plans stay raw for audit, but the normal API response
// strips diagnostics unless include_debug=1 is explicitly set.
router.get('/admin-agent/threads/:id', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const adminUserId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const thread = db.prepare(
    `SELECT id, title, mode, status, created_at, updated_at
     FROM agent_threads WHERE id = ? AND condominium_id = ? AND admin_user_id = ?`
  ).get(id, condoId, adminUserId) as any;
  if (!thread) return fail(res, 'not_found', 404);
  const turns = db.prepare(
    `SELECT turn_index, user_task, agent_summary, agent_plan, fallback, created_at
     FROM agent_turns WHERE thread_id = ? ORDER BY turn_index ASC`
  ).all(id) as any[];
  // Parse the persisted plan JSON for client convenience.
  const hydrated = turns.map((t) => {
    let plan: any = null;
    try { plan = t.agent_plan ? JSON.parse(t.agent_plan) : null; } catch { plan = null; }
    return {
      turn_index: t.turn_index,
      user_task: t.user_task,
      agent_summary: t.agent_summary,
      created_at: t.created_at,
      fallback: !!t.fallback,
      plan: plan ? presentAdminAgentForOperator(plan, {
        includeDebug: wantsAdminAgentDebug(req),
        fallback: !!t.fallback,
        turn_index: t.turn_index,
      }) : null,
    };
  });
  return ok(res, { ...thread, turns: hydrated });
});

// Archive a thread — soft delete; turns remain readable until the
// thread itself is hard-deleted (we don't expose that path yet). Used
// for the "delete conversation" affordance in the sidebar.
router.post('/admin-agent/threads/:id/archive', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const adminUserId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const updated = db.prepare(
    `UPDATE agent_threads SET status = 'archived', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND condominium_id = ? AND admin_user_id = ?`
  ).run(id, condoId, adminUserId);
  if (updated.changes === 0) return fail(res, 'not_found', 404);
  audit(req, {
    action: 'ai.thread_archive',
    target_type: 'agent_thread',
    target_id: id,
    condominium_id: condoId,
  });
  return ok(res, { id, archived: true });
});

// Calibration metrics — how often the admin overrides the agent at each
// confidence tier. The signal is the dispatch_cancelled audit row joined
// with the confidence tier from the time of dispatch (we stash that on
// the audit metadata at cancel time). A well-calibrated agent has
// override rates that match its claimed confidence:
//   high   → admin cancels ≤ 15% of the time
//   medium → admin cancels ~30-50%
//   low    → we never auto-execute, so override rate is N/A
router.get('/admin-agent/calibration', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const days = Math.min(365, Math.max(7, Number(req.query.days || 90)));

  // Cancels grouped by the tier the agent claimed at dispatch time. We
  // parse the metadata JSON inline; SQLite json1 is enabled in modern
  // builds but we keep the JS path simple and portable.
  const cancels = db.prepare(
    `SELECT metadata FROM audit_log
     WHERE condominium_id = ?
       AND action = 'ticket.dispatch_cancelled'
       AND substr(created_at, 1, 10) >= date('now', '-' || ? || ' days')`
  ).all(condoId, days) as Array<{ metadata: string | null }>;

  // For the denominator we need the dispatches the agent fired. The
  // auto-dispatch path always writes scheduled_send_after — a normal
  // manual dispatch is null there. So we can split auto vs manual at
  // the same time as we count tiers.
  const dispatches = db.prepare(
    `SELECT t.agent_plan, d.id, d.scheduled_send_after
     FROM ticket_dispatches d
     JOIN tickets t ON t.id = d.ticket_id
     WHERE t.condominium_id = ?
       AND d.scheduled_send_after IS NOT NULL
       AND substr(d.created_at, 1, 10) >= date('now', '-' || ? || ' days')`
  ).all(condoId, days) as Array<{ agent_plan: string | null; id: number }>;

  // Bucket dispatches by claimed tier.
  const buckets: Record<'high' | 'medium' | 'low' | 'unset', { total: number; cancelled: number }> = {
    high: { total: 0, cancelled: 0 },
    medium: { total: 0, cancelled: 0 },
    low: { total: 0, cancelled: 0 },
    unset: { total: 0, cancelled: 0 },
  };
  for (const d of dispatches) {
    let tier: 'high' | 'medium' | 'low' | 'unset' = 'unset';
    try {
      const p = d.agent_plan ? JSON.parse(d.agent_plan) : null;
      const t = p?.confidence?.tier;
      if (t === 'high' || t === 'medium' || t === 'low') tier = t;
    } catch { /* malformed, count as unset */ }
    buckets[tier].total += 1;
  }
  for (const c of cancels) {
    try {
      const meta = c.metadata ? JSON.parse(c.metadata) : null;
      const t = meta?.agent_confidence_tier as 'high' | 'medium' | 'low' | undefined;
      if (t === 'high' || t === 'medium' || t === 'low') buckets[t].cancelled += 1;
      else buckets.unset.cancelled += 1;
    } catch { buckets.unset.cancelled += 1; }
  }

  const result = (['high', 'medium', 'low', 'unset'] as const).map((tier) => ({
    tier,
    auto_dispatched: buckets[tier].total,
    cancelled: buckets[tier].cancelled,
    cancel_rate: buckets[tier].total > 0
      ? Math.round((buckets[tier].cancelled / buckets[tier].total) * 100) / 100
      : null,
  }));
  return ok(res, { window_days: days, by_tier: result });
});

// AI spend visibility (Phase 1.6). Admin-only rollup of token usage + an
// estimated cost so the team sees the bill forming. `ai_available` reflects
// the credit circuit breaker — false means a recent 402 tripped it and the
// agent is serving the deterministic fallback until credits return.
router.get('/admin-agent/usage', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const days = Math.min(90, Math.max(1, Number(req.query.days || 7)));
  const summary = getAiUsageSummary(days, condoId);
  const breaker = aiBreakerState();
  return ok(res, {
    ...summary,
    window_days: days,
    ai_available: !breaker.open,
    breaker_open_until: breaker.openUntil,
  });
});

// 2. Cluster all open suggestions for the condo
router.post('/cluster-suggestions', requireAuth, aiRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  // Per the README contract every /api/ai/* endpoint must degrade to a
  // _fallback: true response on any failure (DB, model, malformed JSON)
  // rather than 500. Wrap the whole handler body so a missed nullable or
  // a model hiccup doesn't kick the admin back to an error toast.
  try {
    const rows = db.prepare(
      `SELECT id, body FROM suggestions
       WHERE condominium_id=? AND status='open'
       ORDER BY created_at DESC LIMIT 50`
    ).all(u.condominium_id) as { id: number; body: string }[];

    if (rows.length === 0) return ok(res, { clusters: [], unclustered_ids: [], _fallback: false });

    // Audit M-N8 — cluster labels + summaries used to come back in English
    // regardless of the admin's locale (the demo board on /board/suggestions
    // renders the AI output verbatim). Match the proposal-draft endpoint:
    // accept an optional `locale` and force the model to respond in that
    // language. When the caller doesn't send one, leave the prompt unchanged.
    const localeRaw = typeof req.body?.locale === 'string' ? req.body.locale : '';
    const localeName = LOCALE_NAMES[localeRaw] || '';
    const localeOverride = localeName
      ? `\n\n## Output language\nRespond in ${localeName} for both cluster `
        + `labels and summaries. The suggestion text below may be in a different `
        + `language — translate as you cluster.`
      : '';

    const payload = rows.map((r) => `#${r.id}: ${clip(r.body, 1_000)}`).join('\n');
    const out = await tryAI<any>(
      [
        { role: 'system', content: CLUSTER_SYS + localeOverride },
        { role: 'user', content: `Here are the open suggestions:\n\n${payload}` },
      ],
      () => fallbackCluster(rows),
      { jsonMode: true, maxTokens: 1200, tier: 'cheap', label: 'cluster-suggestions', condoId: u.condominium_id, res }
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
    const clusters = Array.isArray(out?.clusters) ? out.clusters : [];
    for (const c of clusters) {
      const result = insertCluster.run(u.condominium_id, c.label || 'Untitled', c.summary || null);
      const cid = Number(result.lastInsertRowid);
      const suggestionIds = Array.isArray(c.suggestion_ids) ? c.suggestion_ids : [];
      for (const sid of suggestionIds) assign.run(cid, c.label || null, sid);
      persisted.push({ id: cid, label: c.label, summary: c.summary, suggestion_ids: suggestionIds });
    }
    audit(req, {
      action: 'suggestion.cluster',
      target_type: 'suggestion_cluster',
      condominium_id: u.condominium_id,
      metadata: { cluster_count: persisted.length, unclustered_count: (out?.unclustered_ids || []).length },
    });
    return ok(res, {
      clusters: persisted,
      unclustered_ids: Array.isArray(out?.unclustered_ids) ? out.unclustered_ids : [],
      _fallback: out?._fallback === true,
    });
  } catch (err) {
    // Logged, but never bubbled — degraded experience > broken endpoint.
    console.warn('[ai/cluster-suggestions] fallback after error:', (err as Error)?.message || err);
    return ok(res, { clusters: [], unclustered_ids: [], _fallback: true });
  }
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
    { jsonMode: true, maxTokens: 800, label: 'summarize-thread', condoId: u.condominium_id, res }
  );

  db.prepare(`UPDATE proposals SET ai_summary=? WHERE id=?`).run(JSON.stringify(out), id);
  audit(req, {
    action: 'proposal.thread_summarize',
    target_type: 'proposal',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { comment_count: comments.length },
  });
  return ok(res, out);
}));

// 4. Summarize a meeting + generate action items + draft resident announcement
router.post('/meetings/:id/summarize', requireAuth, aiRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
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
    { jsonMode: true, maxTokens: 1800, label: 'meetings/summarize', condoId: u.condominium_id, res }
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

  audit(req, {
    action: 'meeting.summarize',
    target_type: 'meeting',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { action_item_count: (out.action_items || []).length },
  });
  return ok(res, out);
}));

// 4b. Pre-vote cost + risk analysis (#13)
// Admin-only. Uses the proposal's title + description to generate an
// estimated_cost (BRL), itemized cost_breakdown, and a short risk_summary.
// The output is persisted on the proposal so residents see it before voting.
interface CostAnalysis {
  estimated_cost: number;
  cost_breakdown: string;
  risk_summary: string;
}

function fallbackCostAnalysis(): CostAnalysis {
  return {
    estimated_cost: 0,
    cost_breakdown: '—',
    risk_summary: 'Análise automática indisponível. Adicione o orçamento e os riscos manualmente antes de abrir a votação.',
  };
}

router.post('/proposals/:id/analyze-cost', requireAuth, aiRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const p = db.prepare(
    `SELECT title, description, category FROM proposals WHERE id=? AND condominium_id=?`
  ).get(id, u.condominium_id) as { title: string; description: string; category: string | null } | undefined;
  if (!p) return fail(res, 'not_found', 404);

  const out = await tryAI<CostAnalysis>(
    [
      { role: 'system', content: PROPOSAL_COST_ANALYSIS_SYS },
      { role: 'user', content: `Title: ${clip(p.title, 300)}\nCategoria: ${p.category || 'não definida'}\n\nDescription:\n${clip(p.description, 4_000)}` },
    ],
    fallbackCostAnalysis,
    { jsonMode: true, maxTokens: 600, label: 'analyze-cost', tier: 'quality', condoId: u.condominium_id, res }
  );

  // Sanitize: clamp cost into a reasonable range, trim long fields.
  const safeCost = Number.isFinite(out.estimated_cost) ? Math.max(0, Math.min(50_000_000, Math.round(out.estimated_cost))) : 0;
  const breakdown = String(out.cost_breakdown || '').slice(0, 2_000);
  const risks = String(out.risk_summary || '').slice(0, 1_500);

  db.prepare(
    `UPDATE proposals SET estimated_cost=?, cost_breakdown=?, risk_summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(safeCost, breakdown, risks, id);

  audit(req, {
    action: 'proposal.analyze_cost',
    target_type: 'proposal',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { estimated_cost: safeCost, has_breakdown: !!breakdown && breakdown !== '—', has_risks: !!risks },
  });

  return ok(res, { estimated_cost: safeCost, cost_breakdown: breakdown, risk_summary: risks });
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
    { maxTokens: 500, label: 'explain', condoId: u.condominium_id, res }
  );

  db.prepare(`UPDATE proposals SET ai_explainer=? WHERE id=?`).run(text, id);
  audit(req, {
    action: 'proposal.explain',
    target_type: 'proposal',
    target_id: id,
    condominium_id: u.condominium_id,
  });
  return ok(res, { explainer: text });
}));

// 6. Board-ready decision summary after vote closes
router.post('/proposals/:id/decision-summary', requireAuth, aiRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
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
    { jsonMode: true, maxTokens: 800, label: 'decision-summary', condoId: u.condominium_id, res }
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

  audit(req, {
    action: 'proposal.decision_summary',
    target_type: 'proposal',
    target_id: id,
    condominium_id: u.condominium_id,
    metadata: { outcome, quorum_met: quorum.quorum_met },
  });
  return ok(res, out);
}));

// =========================================================================
// Annual Assembly (AGO) AI routes
// =========================================================================

// Draft an agenda from the assembly title + condo's open proposals.
router.post('/assemblies/:id/suggest-agenda', requireAuth, aiRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
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
        { title: 'Prestação de contas', description: 'Revisar e aprovar as contas do exercício anterior.', item_type: 'accounts', required_majority: 'simple' },
        { title: 'Previsão orçamentária', description: `Aprovar o orçamento do próximo exercício do ${a.condo_name}.`, item_type: 'budget', required_majority: 'simple' },
        ...openProposals.slice(0, 3).map((p) => ({
          title: p.title,
          description: `Levar a proposta #${p.id} para votação formal.`,
          item_type: 'ordinary',
          required_majority: 'simple',
        })),
        { title: 'Assuntos gerais', description: 'Discussão aberta sobre temas restantes trazidos pelos moradores.', item_type: 'other', required_majority: 'simple' },
      ],
    }),
    { jsonMode: true, maxTokens: 800, label: 'assembly-agenda', condoId, res }
  );
  return ok(res, out);
}));

// Polish the auto-generated ata through the LLM. Falls back to the raw markdown.
router.post('/assemblies/:id/draft-ata', requireAuth, aiRateLimit, requireRole('board_admin'), requireBoardCapability('building_admin'), asyncHandler(async (req: AuthedRequest, res) => {
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
    { jsonMode: false, maxTokens: 1500, label: 'assembly-ata', condoId, res }
  );
  db.prepare(`UPDATE assemblies SET ata_markdown = ? WHERE id = ?`).run(polished, id);
  audit(req, {
    action: 'assembly.draft_ata',
    target_type: 'assembly',
    target_id: id,
    condominium_id: condoId,
  });
  return ok(res, { ata_markdown: polished });
}));

export default router;
