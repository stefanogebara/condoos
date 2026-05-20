// ARC-R4 — Final-stage plan shaping for the admin agent.
//
// Everything that happens AFTER sanitizeAdminAgentOutput returns but
// BEFORE the runner hands the plan back to its caller. Two responsibilities:
//
//   1. decorateAgentPlan — server-decorates the model's plan with the
//      fields the UI needs but the model can't reliably produce:
//        - SEC-2 vendor binding (drops hallucinated company_names,
//          stamps service_contact_id from the saved-contacts map)
//        - cost_history from the expenses ledger
//        - building_memory snapshot the prompt also received
//        - attachment_analysis from vision
//        - agent_trace from the ReAct tool calls
//        - evidence_sources from buildAgentEvidenceSources
//        - confidence cap rule (high → medium when no vendor +
//          no past_ticket evidence; SEC-1/SEC-2 backstop against
//          a forged "high" rating triggering auto-dispatch)
//
//   2. persistAgentTurn — appends a turn row to agent_turns when the
//      caller passes threadId + adminUserId. SELECT MAX + INSERT
//      wrapped in db.transaction() (COR-M1) so concurrent first-turn
//      inserts on the same thread don't race to the same turn_index.
//
// Both are pure data-shaping; no LLM calls, no HTTP. Independently
// testable. The runner orchestrates which inputs each gets and what
// to do with the outputs.

import db from '../db';
import { buildAgentEvidenceSources } from './agent-evidence';
import { agentLanguage, type AdminAgentInput, type AdminAgentOutput } from '../ai/admin-agent';
import type { VendorBundle, VendorCostHistory } from './agent-vendor-repo';
import type { BuildingMemory } from './agent-building-memory';

export interface ToolTraceEntry {
  name: string;
  input: any;
  output: any;
}

export interface PlanDecorationInput {
  plan: AdminAgentOutput;
  adminInput: AdminAgentInput;
  vendorBundle: VendorBundle;
  costByVendor: Map<string, VendorCostHistory>;
  buildingMemory: BuildingMemory;
  attachmentAnalysis: Array<{ description?: string; signals?: string[]; [k: string]: unknown }>;
  toolTrace: ToolTraceEntry[];
  usedFallback: boolean;
  condoId: number;
  locale?: string;
  summariseToolOutput: (toolName: string, output: any) => string;
}

// Mutates + returns the plan with all server-side decoration applied.
// Returning the same reference (vs cloning) is intentional — keeps the
// runner's local `plan` variable in sync without a reassign dance.
export function decorateAgentPlan(input: PlanDecorationInput): AdminAgentOutput {
  const {
    plan,
    adminInput,
    vendorBundle,
    costByVendor,
    buildingMemory,
    attachmentAnalysis,
    toolTrace,
    usedFallback,
    condoId,
    locale,
    summariseToolOutput,
  } = input;

  // SEC-2 — Bind each model-emitted network fit back to a real
  // service_contacts row via DB id, and DROP any fit whose company_name
  // doesn't match a saved contact in this condo. The model only ever
  // sees company_name strings (which could be hallucinated or planted
  // via prompt injection); the auto-dispatch path will dispatch by id,
  // so an unmatched fit becomes a no-op rather than a possible
  // attacker-controlled outreach. Case-insensitive lookup (COR-H5).
  if (plan.existing_network_fit?.length) {
    plan.existing_network_fit = plan.existing_network_fit
      .map((fit) => {
        const id = vendorBundle.idByName.get(String(fit.company_name || '').toLowerCase()) ?? null;
        if (!id) {
          console.warn(`[agent] dropping unmatched fit company_name="${fit.company_name}" for condo ${condoId}`);
        }
        return { ...fit, service_contact_id: id };
      })
      .filter((fit) => fit.service_contact_id != null);
  }

  // Decorate the existing_network_fit entries with cost history from
  // the expenses ledger. The model may or may not echo cost data back;
  // we always have it from the DB, so the UI gets reliable numbers
  // either way. Done after sanitize so we layer on a typed payload.
  if (plan.existing_network_fit?.length) {
    plan.existing_network_fit = plan.existing_network_fit.map((fit) => {
      const cost = costByVendor.get(String(fit.company_name || '').toLowerCase());
      if (!cost) return { ...fit, cost_history: null };
      const centsToBrl = (n: number | null | undefined): number | null =>
        n == null ? null : Math.round(Number(n)) / 100;
      const count = Number(cost.expense_count || 0);
      return {
        ...fit,
        cost_history: {
          expense_count: count,
          last_amount_brl: centsToBrl(cost.last_amount_cents),
          last_spent_at: cost.last_spent_at,
          avg_brl: centsToBrl(cost.avg_cents),
          min_brl: centsToBrl(cost.min_cents),
          max_brl: centsToBrl(cost.max_cents),
          confidence: count >= 3 ? ('high' as const) : ('low' as const),
        },
      };
    });
  }

  // Attach the same building_memory the prompt context received so
  // the UI can render past resolutions / pattern badges / after-hours
  // warnings independently of whether the model echoed them in prose.
  // Filter empty memory to keep payload size sensible.
  if (
    buildingMemory.similar_resolved_tickets.length > 0
    || buildingMemory.open_similar_count > 0
    || buildingMemory.is_outside_business_hours
  ) {
    plan.building_memory = buildingMemory;
  } else {
    plan.building_memory = null;
  }

  // Attach vision results so the UI doesn't have to fetch attachments
  // separately. Empty array stays out of the response payload.
  if (attachmentAnalysis.length > 0) {
    plan.attachment_analysis = attachmentAnalysis as any;
  }

  // Surface the ReAct tool trace so the UI can render a "thinking"
  // view ("checked past elevator tickets... pulled Otis history...").
  // Only present on the ReAct path; the single-shot path returns [].
  if (toolTrace.length > 0) {
    plan.agent_trace = toolTrace.map((t) => ({
      tool: t.name,
      input_keys: Object.keys(t.input || {}),
      output_summary: summariseToolOutput(t.name, t.output),
    }));
  }

  // First-class evidence cards. The trace tells the admin WHAT the
  // agent looked up; evidence_sources shows the concrete facts /
  // citations used to reach the recommendation.
  plan.evidence_sources = buildAgentEvidenceSources(plan, toolTrace, locale);

  // Confidence-inflation cross-check. A "high" rating triggers the
  // platform's auto-execute path (see prompts.ts confidence rules +
  // the veto window in tickets.ts). If the model claims high but
  // produced NEITHER a saved-vendor citation NOR a past_ticket
  // evidence source, it's rating itself on vibes — cap to medium so
  // auto-dispatch can't fire on a forged score. Scope refusal
  // (looksOutOfScope) explicitly sets high with no fit/options;
  // honour that case via the task_type === 'general' check.
  if (
    plan.confidence
    && plan.confidence.tier === 'high'
    && !usedFallback
    && plan.task_type !== 'general'
  ) {
    const hasNamedVendor = (plan.existing_network_fit?.length || 0) > 0;
    const hasPastTicket = Array.isArray(plan.evidence_sources)
      && plan.evidence_sources.some((e) => e?.type === 'past_ticket');
    if (!hasNamedVendor && !hasPastTicket) {
      console.warn(
        `[agent] capping high→medium confidence: no vendor + no past ticket cited (task_type=${plan.task_type})`,
      );
      plan.confidence.score = Math.min(plan.confidence.score, 0.7);
      plan.confidence.tier = 'medium';
      plan.confidence.reasoning = [
        agentLanguage(adminInput) === 'pt'
          ? 'Sem fornecedor citado nem ticket resolvido — confiança rebaixada para medium.'
          : 'No vendor cited and no past ticket — confidence capped at medium.',
        ...(plan.confidence.reasoning || []),
      ].slice(0, 4);
    }
  }

  return plan;
}

export interface PersistTurnInput {
  threadId: number | null | undefined;
  adminUserId: number | null | undefined;
  task: string;
  plan: AdminAgentOutput;
  usedFallback: boolean;
}

// COR-M1 — SELECT MAX + INSERT must be atomic so concurrent first-turn
// inserts on the same thread don't race to the same turn_index. The
// transaction makes the invariant explicit and survives an accidental
// async refactor.
export function persistAgentTurn(input: PersistTurnInput): number | undefined {
  if (!input.threadId || !input.adminUserId) return undefined;
  return db.transaction(() => {
    const next = (db.prepare(
      `SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index FROM agent_turns WHERE thread_id = ?`,
    ).get(input.threadId) as { next_index: number }).next_index;
    db.prepare(
      `INSERT INTO agent_turns (thread_id, turn_index, user_task, agent_summary, agent_plan, fallback)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.threadId,
      next,
      input.task,
      String(input.plan.summary || '').slice(0, 800),
      JSON.stringify(input.plan),
      input.usedFallback ? 1 : 0,
    );
    db.prepare(
      `UPDATE agent_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(input.threadId);
    return next;
  })();
}
