// Reusable orchestrator for the admin operations agent.
//
// The original route at POST /api/ai/admin-agent does the full context-
// gathering + model call inline. The Incident Loop feature (verified tickets
// → AI agent dispatch) needs to fire the same logic from a different
// endpoint, so the heavy lifting moves here. The route handler stays as the
// auth + rate-limit + audit shell.

import db from '../db';
import { chat, parseJsonLoose } from './openrouter';
import { ADMIN_AGENT_SYS } from './prompts';
import {
  fallbackAdminAgent,
  normalizeAdminAgentMode,
  sanitizeAdminAgentOutput,
  type AdminAgentInput,
  type AdminAgentMode,
} from './admin-agent';

function clip(value: unknown, max: number): string {
  return String(value || '').slice(0, max);
}

// === Helpers for building memory ===
// Lightweight keyword-based category inference. Cheap, no LLM call. We
// match on the same category vocabulary the ticket-create form uses; the
// list mirrors CATEGORIES in client-app/src/pages/resident/Tickets.tsx
// plus the safety-critical extensions in server/src/routes/tickets.ts.
// First-match wins — order matters: more specific synonyms before
// general ones (gas_leak before gas, water_damage before water).
const CATEGORY_KEYWORDS: Array<{ category: string; words: RegExp }> = [
  { category: 'gas_leak',    words: /\b(vazamento de g[áa]s|gas leak)\b/i },
  { category: 'water_damage', words: /\b(inund(a[çc][ãa]o|ada?)|alagamento|water damage)\b/i },
  { category: 'fire_safety', words: /\b(inc[êe]ndio|fuma[çc]a|alarme de inc|fire safety|fire alarm)\b/i },
  { category: 'elevator',    words: /\b(elevador|elevator|lift)\b/i },
  { category: 'electrical',  words: /\b(el[ée]trica?|electrical|tomada|disjuntor|curto-?circuito|fia[çc][ãa]o)\b/i },
  { category: 'plumbing',    words: /\b(hidr[áa]ulica?|encanamento|vazamento|cano|esgoto|plumbing|leak|pipe)\b/i },
  { category: 'hvac',        words: /\b(ar condicionado|ventila[çc][ãa]o|climatiza[çc][ãa]o|hvac|a\/c)\b/i },
  { category: 'security',    words: /\b(seguran[çc]a|porta(o|s|s)|portaria|intercom|c[âa]mera|cctv|security|access|gate)\b/i },
  { category: 'gas',         words: /\b(g[áa]s)\b/i },
  { category: 'water',       words: /\b(caixa d'?[áa]gua|reservat[óo]rio|water tank)\b/i },
  { category: 'cleaning',    words: /\b(limpeza|cleaning|janitor)\b/i },
  { category: 'amenity',     words: /\b(academia|piscina|sal[ãa]o|gym|pool|amenity)\b/i },
  { category: 'maintenance', words: /\b(manuten[çc][ãa]o|conserto|maintenance|repair)\b/i },
];

export function inferCategoryFromTask(task: string): string | null {
  const text = String(task || '');
  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.test(text)) return category;
  }
  return null;
}

// Strip stopwords + punctuation; lowercase; keep tokens >= 4 chars. Used
// to score title overlap between the new task and past resolved tickets.
const STOPWORDS = new Set([
  'para','com','sem','que','dos','das','uma','este','esta','esse','essa','isso',
  'pelo','pela','suas','seus','minha','meu','muito','mais','sobre','tambem',
  'mas','por','foi','tem','ter','ser','este','isso','aqui','agora','hoje',
  'entre','sobre','depois','antes','quando','onde','como','porque','quanto',
  'the','and','for','with','from','that','this','these','those','some','very',
  'also','more','need','needs','urgent','urgente','again','then','before','after',
]);
export function extractKeywords(s: string): string[] {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents for matching
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

// Cheap overlap score. Equal-weight tokens; pre-normalised both sides so
// "ruído" ↔ "ruido" matches. Returns 0 when no overlap.
export function scoreTitleOverlap(newTaskKeywords: string[], pastTitle: string): number {
  if (newTaskKeywords.length === 0) return 0;
  const pastSet = new Set(extractKeywords(pastTitle));
  let hits = 0;
  for (const w of newTaskKeywords) if (pastSet.has(w)) hits += 1;
  return hits;
}

export interface RunAdminAgentArgs {
  condoId: number;
  task: string;
  mode?: string | AdminAgentMode;
  locale?: string;
  location?: string;
  budget?: string;
  urgency?: string;
}

export interface RunAdminAgentResult {
  plan: any;
  fallback: boolean;
}

export async function runAdminAgent(args: RunAdminAgentArgs): Promise<RunAdminAgentResult> {
  const mode = normalizeAdminAgentMode(args.mode);

  const condo = db.prepare(`SELECT id, name, address FROM condominiums WHERE id = ?`).get(args.condoId) as any;
  const footprint = db.prepare(
    `SELECT COUNT(DISTINCT b.id) AS buildings, COUNT(u.id) AS units
     FROM buildings b
     LEFT JOIN units u ON u.building_id = b.id
     WHERE b.condominium_id = ?`
  ).get(args.condoId) as any;

  // Vendor reputation — joins dispatch stats so the model sees how each
  // vendor has actually performed (responded N out of M, avg response time).
  // The picker preselection uses the same stats client-side; here it shapes
  // the prompt so the AI prefers proven responders over alphabetic-first.
  const serviceContacts = db.prepare(
    `WITH stats AS (
       SELECT service_contact_id,
              SUM(CASE WHEN channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'responded' AND channel IN ('whatsapp','email') THEN 1 ELSE 0 END) AS responded,
              AVG(CASE WHEN status = 'responded' AND responded_at IS NOT NULL
                       THEN (strftime('%s', responded_at) - strftime('%s', created_at))
                       ELSE NULL END) AS avg_response_seconds
       FROM ticket_dispatches
       GROUP BY service_contact_id
     )
     SELECT sc.category, sc.company_name, sc.contact_name, sc.phone, sc.whatsapp, sc.email, sc.website,
            sc.service_scope, sc.notes, sc.emergency_available, sc.preferred, sc.last_used_at,
            COALESCE(stats.sent, 0) AS dispatches_total,
            COALESCE(stats.responded, 0) AS dispatches_responded,
            stats.avg_response_seconds AS avg_response_seconds
     FROM service_contacts sc
     LEFT JOIN stats ON stats.service_contact_id = sc.id
     WHERE sc.condominium_id = ? AND sc.active = 1
     ORDER BY sc.preferred DESC, sc.emergency_available DESC, sc.company_name ASC
     LIMIT 40`
  ).all(args.condoId) as any[];

  // Cost history per vendor — pulled from the expenses ledger so the agent
  // can answer "how much will this cost?" with actual past spend instead of
  // "confirm by quote." Match is `LOWER(expenses.vendor) LIKE company_name
  // + '%'` since the free-text vendor column drifts (admins type 'Otis' or
  // 'Otis Elevadores' or 'Otis - SP'); the prefix match tolerates that.
  // Last 24 months only — older data isn't a useful cost signal.
  const vendorCostHistory = db.prepare(
    `SELECT sc.id           AS service_contact_id,
            sc.company_name AS company_name,
            COUNT(e.id)     AS expense_count,
            SUM(e.amount_cents) AS total_cents,
            AVG(e.amount_cents) AS avg_cents,
            MIN(e.amount_cents) AS min_cents,
            MAX(e.amount_cents) AS max_cents,
            MAX(e.spent_at)     AS last_spent_at,
            (SELECT amount_cents FROM expenses e2
             WHERE e2.condominium_id = sc.condominium_id
               AND LOWER(e2.vendor) LIKE LOWER(sc.company_name) || '%'
             ORDER BY spent_at DESC LIMIT 1) AS last_amount_cents
     FROM service_contacts sc
     LEFT JOIN expenses e
       ON e.condominium_id = sc.condominium_id
      AND LOWER(e.vendor) LIKE LOWER(sc.company_name) || '%'
      AND substr(e.spent_at, 1, 10) >= date('now', '-24 months')
     WHERE sc.condominium_id = ? AND sc.active = 1
     GROUP BY sc.id, sc.company_name
     HAVING expense_count > 0`
  ).all(args.condoId) as Array<{
    service_contact_id: number;
    company_name: string;
    expense_count: number;
    total_cents: number | null;
    avg_cents: number | null;
    min_cents: number | null;
    max_cents: number | null;
    last_spent_at: string | null;
    last_amount_cents: number | null;
  }>;
  const costByVendor = new Map(vendorCostHistory.map((c) => [String(c.company_name).toLowerCase(), c]));

  const amenities = db.prepare(
    `SELECT name, description, capacity, admin_notes
     FROM amenities
     WHERE condominium_id = ? AND active = 1
     ORDER BY name ASC
     LIMIT 12`
  ).all(args.condoId) as any[];

  const recentProposals = db.prepare(
    `SELECT id, title, category, status, estimated_cost, created_at
     FROM proposals
     WHERE condominium_id = ?
     ORDER BY created_at DESC
     LIMIT 8`
  ).all(args.condoId) as any[];

  const openSuggestions = db.prepare(
    `SELECT id, body, category, created_at
     FROM suggestions
     WHERE condominium_id = ? AND status = 'open'
     ORDER BY created_at DESC
     LIMIT 8`
  ).all(args.condoId) as any[];

  // === Building memory ===
  // The agent's biggest weakness was treating every ticket as fresh, even
  // when the same building had resolved an identical symptom 6 weeks ago.
  // Three signals get added to the prompt context:
  //
  //   1) similar_resolved_tickets — past resolutions in the same category
  //      with overlapping title keywords. Lets the agent cite "Em março,
  //      Otis trocou cabo desgastado por R$ 2400 em 4h. Mesma rota?"
  //
  //   2) open_similar_count — count of currently-open tickets in the same
  //      category in the last 30d. When >= 3, the agent surfaces
  //      "padrão detectado — considere vistoria preventiva."
  //
  //   3) current_local_time + is_outside_business_hours — basic temporal
  //      awareness. Stops the agent from cheerfully suggesting "ligar
  //      para Ricardo agora" at 11pm.
  //
  // Detection: derive a likely category from keywords in the task text
  // (cheap, no model call). Then SQL on that.
  const inferredCategory = inferCategoryFromTask(args.task);
  const taskKeywords = extractKeywords(args.task);

  let similarResolved: any[] = [];
  let openSimilarCount = 0;
  if (inferredCategory) {
    // Resolved tickets in same category, last 12 months. Score each by
    // how many of the new task's keywords appear in the title — top 3
    // by (keyword overlap, recency).
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
    ).all(args.condoId, inferredCategory) as any[];

    const scored = candidates.map((c) => ({
      ...c,
      _score: scoreTitleOverlap(taskKeywords, c.title || ''),
    })).sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return String(b.resolved_at || '').localeCompare(String(a.resolved_at || ''));
    });
    similarResolved = scored.slice(0, 3);

    openSimilarCount = (db.prepare(
      `SELECT COUNT(*) AS n FROM tickets
       WHERE condominium_id = ?
         AND category = ?
         AND remediation_status != 'resolved'
         AND substr(created_at, 1, 10) >= date('now', '-30 days')`
    ).get(args.condoId, inferredCategory) as { n: number }).n;
  }

  // Time-of-day context. The local hour comes from the condo's timezone if
  // we ever attach one to condominiums; for now we use UTC + a default of
  // 9-18 business hours. The intent is to stop "ligar agora" at 22h.
  const now = new Date();
  const localHour = now.getUTCHours() - 3; // approx BRT (UTC-3) until tz-per-condo lands
  const normalizedHour = ((localHour % 24) + 24) % 24;
  const isOutsideBusinessHours = normalizedHour < 8 || normalizedHour >= 19;

  const buildingMemory = {
    similar_resolved_tickets: similarResolved.map((t) => {
      let agentPlanCost: number | null = null;
      try {
        if (t.agent_plan) {
          const parsed = JSON.parse(t.agent_plan);
          agentPlanCost = parsed?.proposal_draft?.estimated_cost ?? null;
        }
      } catch { /* malformed plan — leave cost null */ }
      return {
        id: t.id,
        title: clip(t.title, 160),
        resolved_at: t.resolved_at,
        dispatched_vendors: t.dispatched_vendors,
        resolution_note: clip(t.last_vendor_response || t.last_comment || '', 400),
        estimated_cost_brl: agentPlanCost,
      };
    }),
    open_similar_count: openSimilarCount,
    inferred_category: inferredCategory,
    current_local_time: now.toISOString(),
    local_hour: normalizedHour,
    is_outside_business_hours: isOutsideBusinessHours,
  };

  const adminInput: AdminAgentInput = {
    task: args.task,
    mode,
    location: args.location || '',
    budget: args.budget || '',
    urgency: args.urgency || '',
    locale: args.locale || '',
    condo: condo ? { name: condo.name, address: condo.address } : null,
    service_contacts: serviceContacts,
  };

  const context = {
    generated_at: new Date().toISOString(),
    request: {
      task: args.task,
      mode,
      location: adminInput.location || condo?.address || null,
      budget: adminInput.budget || null,
      urgency: adminInput.urgency || null,
      locale: adminInput.locale || null,
    },
    condominium: condo ? {
      name: condo.name,
      address: condo.address,
      buildings: Number(footprint?.buildings || 0),
      units: Number(footprint?.units || 0),
    } : null,
    saved_service_contacts: serviceContacts.map((c) => ({
      category: clip(c.category, 80),
      company_name: clip(c.company_name, 140),
      contact_name: clip(c.contact_name, 120),
      phone: clip(c.phone, 60),
      whatsapp: clip(c.whatsapp, 60),
      email: clip(c.email, 160),
      website: clip(c.website, 240),
      service_scope: clip(c.service_scope, 500),
      notes: clip(c.notes, 700),
      emergency_available: !!c.emergency_available,
      preferred: !!c.preferred,
      last_used_at: c.last_used_at,
      reputation: {
        dispatches_total: Number(c.dispatches_total || 0),
        dispatches_responded: Number(c.dispatches_responded || 0),
        response_rate: c.dispatches_total
          ? Number(c.dispatches_responded) / Number(c.dispatches_total)
          : null,
        avg_response_seconds: c.avg_response_seconds != null
          ? Math.round(Number(c.avg_response_seconds))
          : null,
      },
      // Past spend with this vendor — last 24 months. The agent reads
      // these in BRL (cents → BRL) to anchor estimated_cost_range on
      // real history. Empty when the admin has never logged an expense
      // tied to this vendor.
      cost_history: (() => {
        const hit = costByVendor.get(String(c.company_name || '').toLowerCase());
        if (!hit) return null;
        const centsToBrl = (n: number | null | undefined): number | null =>
          n == null ? null : Math.round(Number(n)) / 100;
        const count = Number(hit.expense_count || 0);
        return {
          expense_count: count,
          last_amount_brl: centsToBrl(hit.last_amount_cents),
          last_spent_at: hit.last_spent_at,
          avg_brl: centsToBrl(hit.avg_cents),
          min_brl: centsToBrl(hit.min_cents),
          max_brl: centsToBrl(hit.max_cents),
          // 3 past expenses = enough for a range. 1-2 = anchor data only;
          // the prompt + UI both downgrade language at low confidence.
          confidence: count >= 3 ? ('high' as const) : ('low' as const),
        };
      })(),
    })),
    amenities: amenities.map((a) => ({
      name: clip(a.name, 120),
      description: clip(a.description, 500),
      capacity: a.capacity,
      admin_notes: clip(a.admin_notes, 700),
    })),
    recent_proposals: recentProposals.map((p) => ({
      id: p.id,
      title: clip(p.title, 220),
      category: p.category,
      status: p.status,
      estimated_cost: p.estimated_cost,
      created_at: p.created_at,
    })),
    open_suggestions: openSuggestions.map((s) => ({
      id: s.id,
      body: clip(s.body, 700),
      category: s.category,
      created_at: s.created_at,
    })),
    building_memory: buildingMemory,
    tool_limitations: 'This route does not perform live web browsing, vendor calls, purchases, bookings, or installation work. It produces a decision-ready plan, search queries, outreach copy, and a proposal draft.',
  };

  let usedFallback = false;
  let raw: any;
  try {
    const text = await chat(
      [
        { role: 'system', content: ADMIN_AGENT_SYS },
        { role: 'user', content: JSON.stringify(context) },
      ],
      { jsonMode: true, maxTokens: 2_000 }
    );
    raw = parseJsonLoose<any>(text);
    if (!raw) {
      raw = fallbackAdminAgent(adminInput);
      usedFallback = true;
    }
  } catch {
    raw = fallbackAdminAgent(adminInput);
    usedFallback = true;
  }

  const plan = sanitizeAdminAgentOutput(raw, adminInput);
  // Decorate the existing_network_fit entries with cost history from the
  // expenses ledger. The model may or may not echo the cost data back; we
  // always have it from the DB, so the UI gets reliable numbers either
  // way. Done after sanitize so we layer on a typed, validated payload.
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
  // Attach the same building_memory the prompt context received, so the
  // UI can render past resolutions / pattern badges / after-hours
  // warnings independently of whether the model echoed them in prose.
  // Filter out empty memory to keep payload size sensible.
  if (buildingMemory.similar_resolved_tickets.length > 0
      || buildingMemory.open_similar_count > 0
      || buildingMemory.is_outside_business_hours) {
    plan.building_memory = buildingMemory;
  } else {
    plan.building_memory = null;
  }
  return { plan, fallback: usedFallback };
}
