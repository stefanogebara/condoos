// ARC-R4 — Building memory for the admin agent's prompt context.
//
// Extracted from runAdminAgentInner. Three signals the agent uses:
//
//   1) similar_resolved_tickets — past resolutions in the same
//      category with overlapping title keywords. Lets the agent
//      cite "Em março, Otis trocou cabo desgastado por R$ 2400 em
//      4h. Mesma rota?"
//
//   2) open_similar_count — count of currently-open tickets in the
//      same category over 30 days. When ≥ 3 the agent surfaces
//      "padrão detectado — considere vistoria preventiva".
//
//   3) current_local_time + is_outside_business_hours — basic
//      temporal awareness so the agent doesn't cheerfully suggest
//      "ligar para Ricardo agora" at 23h. Uses the condo's IANA
//      timezone (default America/Sao_Paulo); falls back to UTC-3
//      when the configured zone is invalid (logged for ops).

import db from '../db';

export interface SimilarResolvedTicket {
  id: number;
  title: string;
  resolved_at: string;
  dispatched_vendors: string | null;
  resolution_note: string;
  estimated_cost_brl: number | null;
}

export interface BuildingMemory {
  similar_resolved_tickets: SimilarResolvedTicket[];
  open_similar_count: number;
  inferred_category: string | null;
  current_local_time: string;
  local_hour: number;
  is_outside_business_hours: boolean;
}

export interface BuildingMemoryInput {
  condoId: number;
  task: string;
  inferredCategory: string | null;
  // Functions are injected so the runner keeps owning the keyword
  // heuristics (extractKeywords/scoreTitleOverlap live in the runner
  // for now — moving them creates a circular import risk). Future
  // refactor: extract them into their own module too.
  taskKeywords: string[];
  scoreOverlap: (newTaskKeywords: string[], pastTitle: string) => number;
  timezone: string | null | undefined;
  clip?: (value: unknown, max: number) => string;
}

function defaultClip(value: unknown, max: number): string {
  return String(value || '').slice(0, max);
}

// Compute current local hour for the condo's timezone. Pure function
// so the time logic is testable independently of the building memory
// queries below.
export function computeLocalHour(timezone: string | null | undefined, now: Date = new Date()): {
  localHour: number;
  isOutsideBusinessHours: boolean;
  timezone: string;
} {
  const tz = timezone || 'America/Sao_Paulo';
  let localHour: number;
  try {
    localHour = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now),
    );
    if (!Number.isFinite(localHour)) throw new Error('invalid hour');
  } catch {
    console.warn(`[agent] invalid condo timezone "${tz}" — falling back to UTC-3`);
    localHour = ((now.getUTCHours() - 3) % 24 + 24) % 24;
  }
  return {
    localHour,
    isOutsideBusinessHours: localHour < 8 || localHour >= 19,
    timezone: tz,
  };
}

// Load similar-resolved + open-similar-count for one inferred category.
// Returns empty arrays when no category was inferred (the runner won't
// surface building memory in that case anyway).
export function loadSimilarTickets(
  condoId: number,
  inferredCategory: string | null,
  taskKeywords: string[],
  scoreOverlap: (newTaskKeywords: string[], pastTitle: string) => number,
): { similarResolved: SimilarResolvedTicket[]; openSimilarCount: number } {
  if (!inferredCategory) return { similarResolved: [], openSimilarCount: 0 };

  // Resolved tickets in same category, last 12 months. Score each by
  // how many task keywords appear in the title — top 3 by (overlap, recency).
  const candidates = db.prepare(
    `SELECT t.id, t.title, t.description, t.category, t.resolved_at,
            t.agent_plan,
            GROUP_CONCAT(DISTINCT sc.company_name) AS dispatched_vendors,
            MAX(d.responded_at)                      AS last_vendor_responded_at,
            MAX(d.response_summary)                  AS last_vendor_response,
            (SELECT body FROM ticket_comments c
             WHERE c.ticket_id = t.id ORDER BY c.created_at DESC LIMIT 1) AS last_comment
     FROM tickets t
     LEFT JOIN ticket_dispatches d ON d.ticket_id = t.id
     LEFT JOIN service_contacts sc ON sc.id = d.service_contact_id
     WHERE t.condominium_id = ?
       AND t.category = ?
       AND t.remediation_status = 'resolved'
       AND substr(t.resolved_at, 1, 10) >= date('now', '-12 months')
     GROUP BY t.id
     ORDER BY t.resolved_at DESC
     LIMIT 20`
  ).all(condoId, inferredCategory) as any[];

  const scored = candidates.map((c) => ({
    ...c,
    _score: scoreOverlap(taskKeywords, c.title || ''),
  })).sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return String(b.resolved_at || '').localeCompare(String(a.resolved_at || ''));
  });

  const top = scored.slice(0, 3).map((t) => {
    let agentPlanCost: number | null = null;
    try {
      if (t.agent_plan) {
        const parsed = JSON.parse(t.agent_plan);
        agentPlanCost = parsed?.proposal_draft?.estimated_cost ?? null;
      }
    } catch { /* malformed plan — leave cost null */ }
    return {
      id: t.id,
      title: defaultClip(t.title, 160),
      resolved_at: t.resolved_at,
      dispatched_vendors: t.dispatched_vendors,
      resolution_note: defaultClip(t.last_vendor_response || t.last_comment || '', 400),
      estimated_cost_brl: agentPlanCost,
    };
  });

  const openSimilarCount = (db.prepare(
    `SELECT COUNT(*) AS n FROM tickets
     WHERE condominium_id = ?
       AND category = ?
       AND remediation_status != 'resolved'
       AND substr(created_at, 1, 10) >= date('now', '-30 days')`
  ).get(condoId, inferredCategory) as { n: number }).n;

  return { similarResolved: top, openSimilarCount };
}

// One-shot orchestrator. Composes the two queries above + the local-
// hour computation into the BuildingMemory shape the prompt context
// expects.
export function buildBuildingMemory(input: BuildingMemoryInput): BuildingMemory {
  const { similarResolved, openSimilarCount } = loadSimilarTickets(
    input.condoId,
    input.inferredCategory,
    input.taskKeywords,
    input.scoreOverlap,
  );
  const time = computeLocalHour(input.timezone);
  return {
    similar_resolved_tickets: similarResolved,
    open_similar_count: openSimilarCount,
    inferred_category: input.inferredCategory,
    current_local_time: new Date().toISOString(),
    local_hour: time.localHour,
    is_outside_business_hours: time.isOutsideBusinessHours,
  };
}
