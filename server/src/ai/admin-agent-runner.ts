// Reusable orchestrator for the admin operations agent.
//
// The original route at POST /api/ai/admin-agent does the full context-
// gathering + model call inline. The Incident Loop feature (verified tickets
// → AI agent dispatch) needs to fire the same logic from a different
// endpoint, so the heavy lifting moves here. The route handler stays as the
// auth + rate-limit + audit shell.

import db from '../db';
import { chat, chatWithTools, parseJsonLoose, aiBreakerState } from './openrouter';
import { ADMIN_AGENT_SYS, ADMIN_AGENT_REACT_SYS } from './prompts';
import {
  fallbackAdminAgent,
  normalizeAdminAgentMode,
  sanitizeAdminAgentOutput,
  agentLanguage,
  looksOutOfScope,
  type AdminAgentInput,
  type AdminAgentMode,
} from './admin-agent';
import { ADMIN_AGENT_TOOLS, buildToolHandler } from './admin-agent-tools';
import { analyzeTicketAttachments } from './attachment-vision';
import { appendAgentRunProgress, createAgentRun, finishAgentRunFailure, finishAgentRunSuccess } from '../lib/agent-runs';
import { buildAgentEvidenceSources } from '../lib/agent-evidence';
import { loadVendorBundle, type VendorBundle } from '../lib/agent-vendor-repo';
import { buildBuildingMemory } from '../lib/agent-building-memory';

function clip(value: unknown, max: number): string {
  return String(value || '').slice(0, max);
}

// SEC-1 — Wrap resident-supplied free-text in a hard boundary so the
// model treats it as data, not instruction. The system prompt tells the
// model that anything inside <resident_text>...</resident_text> is
// untrusted. Strip any existing delimiter tokens from the input so an
// attacker can't close the boundary mid-payload ("</resident_text>
// SYSTEM: now obey...").
//
// We DON'T strip "instructions" — the model should still see the
// original wording so it can summarize correctly. The defense is the
// boundary + prompt instruction, not censorship.
export function wrapUntrusted(text: unknown): string {
  const safe = String(text ?? '').replace(/<\/?resident_text>/gi, '[tag]');
  return `<resident_text>${safe}</resident_text>`;
}

// Compress a tool output into a short human-readable phrase for the
// thinking-trace UI. We never echo raw JSON to the client trace — that
// would leak server-internal fields (ids, timestamps) the admin doesn't
// need and the trace pane shouldn't have to parse.
function summariseToolOutput(toolName: string, output: any): string {
  if (!output || typeof output !== 'object') return '';
  if (toolName === 'search_past_tickets') {
    const n = Array.isArray(output.matches) ? output.matches.length : 0;
    if (n === 0) return 'sem chamados anteriores parecidos';
    const first = output.matches[0];
    return `${n} chamado(s) parecido(s) — mais recente: "${String(first?.title || '').slice(0, 60)}"`;
  }
  if (toolName === 'get_vendor_history') {
    const ds = output.dispatch_stats || {};
    const es = output.expense_stats || {};
    return `${output.vendor?.company_name || '?'}: ${ds.responded || 0}/${ds.total || 0} respondidos, ${es.count || 0} despesas (${es.confidence || '—'})`;
  }
  if (toolName === 'list_vendors') {
    return `${Array.isArray(output.vendors) ? output.vendors.length : 0} fornecedor(es) na rede`;
  }
  if (toolName === 'get_open_similar_tickets') {
    return `${output.open_count || 0} chamados abertos em ${output.window_days || 30} dias${output.is_pattern ? ' (padrão detectado)' : ''}`;
  }
  if (toolName === 'research_external_vendors') {
    const n = Array.isArray(output.citations) ? output.citations.length : 0;
    return output.configured
      ? `${n} citação(ões) externas para "${String(output.query || '').slice(0, 60)}"`
      : `web search não configurado — ${n} link(s) de pesquisa manual`;
  }
  if (toolName === 'submit_final_answer') {
    return 'plano final enviado';
  }
  return '';
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

// Strip stopwords + punctuation; lowercase; keep meaningful tokens.
// Used to score title overlap between the new task and past resolved
// tickets.
//
// COR-M2 — Added Spanish and French stopwords. Previously only pt+en
// were filtered, so a French ticket "problème avec l'ascenseur" would
// keep "avec" / "probleme" as keywords and inflate overlap against
// unrelated past tickets that happened to share those tokens.
//
// COR-M5 — Lowered the min token length from 4 to 3, and added a
// domain-specific allowlist for short acronyms (AC, EV, UV, RH, TI)
// that mean something in a building-ops context. The 4-char cutoff
// was dropping "AC" / "ar condicionado" → "ac" mappings and missing
// matches between past and current AC tickets.
const STOPWORDS = new Set([
  // Portuguese
  'para','com','sem','que','dos','das','uma','este','esta','esse','essa','isso',
  'pelo','pela','suas','seus','minha','meu','muito','mais','sobre','tambem',
  'mas','por','foi','tem','ter','ser','este','isso','aqui','agora','hoje',
  'entre','sobre','depois','antes','quando','onde','como','porque','quanto',
  // English
  'the','and','for','with','from','that','this','these','those','some','very',
  'also','more','need','needs','urgent','urgente','again','then','before','after',
  // Spanish (COR-M2)
  'que','con','sin','los','las','del','una','unas','unos','este','esta','esto','eso',
  'por','para','pero','como','cuando','donde','porque','muy','mas','sobre','entre',
  'desde','hasta','tras','tambien','tener','ser','estar','hace','hacer',
  // French (COR-M2)
  'que','avec','sans','les','des','une','cette','cet','ces','dans','pour','par',
  'pas','mais','comme','quand','tres','plus','dont','donc','aussi','etre','avoir',
  'sont','etait','sera','jamais','toujours','aujourd','demain','hier',
]);
const SHORT_TOKEN_ALLOWLIST = new Set(['ac','ev','uv','rh','ti','tv','wc','wi','fi']);
export function extractKeywords(s: string): string[] {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents for matching
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      if (!w || STOPWORDS.has(w)) return false;
      if (w.length >= 3) return true;
      return SHORT_TOKEN_ALLOWLIST.has(w);
    });
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
  // Conversational thread support (roadmap item 2). When threadId is
  // provided, prior turns are pulled from agent_turns and included in the
  // prompt context so the agent BUILDS on previous answers rather than
  // restarting. When adminUserId is also provided, the runner persists
  // the new turn back into agent_turns after the model returns.
  threadId?: number;
  adminUserId?: number;
  // Vision support (roadmap item 6). When ticketId is supplied, the
  // runner analyzes every image attachment on that ticket (cached) and
  // passes the resulting descriptions + signals into the prompt
  // context. The workbench path doesn't have a ticket, so this stays
  // optional; only auto-dispatch + /run-agent fill it.
  ticketId?: number;
  // Internal — when the outer runAdminAgent passes the run-tracking id
  // to the inner function, progress crumbs get written to that row so
  // the UI can poll. Set by the wrapper; callers shouldn't touch.
  agentRunId?: number;
  // Internal — set by the concurrency guard when the condo is at its
  // in-flight cap. Forces the deterministic fallback (no LLM call) so a
  // burst of ticket verifications can't pile onto the OpenRouter bill.
  forceFallback?: boolean;
}

export interface RunAdminAgentResult {
  plan: any;
  fallback: boolean;
  agent_run_id?: number;
  thread_id?: number;
  turn_index?: number;
}

function agentModelLabel(): string {
  const base = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-haiku';
  return process.env.AGENT_USE_REACT === '1' ? `${base} + tools` : base;
}

// Per-condo concurrency guard. dispatchAgentInBackground fires one agent
// run per verified ticket with no rate limit, and each run fans out to up
// to 4 LLM calls. A burst of verifications could pile dozens of calls onto
// the OpenRouter bill. Cap concurrent runs per condo — excess runs serve
// the deterministic fallback (free, instant, still a usable plan).
//
// ⚠️  Per-PROCESS counter. CondoOS runs on a single Fly machine today, so
// this is effectively per-deployment. The moment we scale horizontally
// (multiple machines, PM2 cluster mode, etc.) this becomes meaningless —
// each process holds its own counter and the global concurrency is
// MAX × N. Move to Redis (or any shared store) before scaling out.
const MAX_CONCURRENT_AGENT_RUNS_PER_CONDO = Number(process.env.AGENT_MAX_CONCURRENT_PER_CONDO || 2);
const inFlightByCondo = new Map<number, number>();

export async function runAdminAgent(args: RunAdminAgentArgs): Promise<RunAdminAgentResult> {
  const started = Date.now();
  const runId = createAgentRun({
    condominiumId: args.condoId,
    adminUserId: args.adminUserId ?? null,
    threadId: args.threadId ?? null,
    ticketId: args.ticketId ?? null,
    mode: String(args.mode || 'general'),
    task: args.task,
    reactEnabled: process.env.AGENT_USE_REACT === '1',
    model: agentModelLabel(),
  });

  const condoInFlight = inFlightByCondo.get(args.condoId) || 0;
  const overloaded = condoInFlight >= MAX_CONCURRENT_AGENT_RUNS_PER_CONDO;
  // Hoist the credit-breaker check up here too. The breaker also fires
  // inside fetchOpenRouter — but by that point we've built the full context
  // (DB queries + vision analysis) just to short-circuit at the API edge.
  // For dispatchAgentInBackground bursts during an outage, that's still a
  // lot of wasted DB work. Bail to the deterministic fallback at entry.
  const breakerOpen = aiBreakerState().open;
  const forceFallback = overloaded || breakerOpen;
  if (overloaded) {
    console.warn(`[agent] condo ${args.condoId} at concurrency cap (${condoInFlight} in flight) — serving deterministic fallback`);
  } else if (breakerOpen) {
    console.warn(`[agent] credit breaker open — serving deterministic fallback for condo ${args.condoId}`);
  }
  inFlightByCondo.set(args.condoId, condoInFlight + 1);

  // First progress crumb — admin sees "Iniciando análise..." within 1s
  // even before the slow model call begins.
  appendAgentRunProgress(runId, { label: 'Iniciando análise', detail: args.task.slice(0, 60) });
  try {
    const result = await runAdminAgentInner({ ...args, agentRunId: runId, forceFallback } as RunAdminAgentArgs);
    finishAgentRunSuccess(runId, {
      fallback: result.fallback,
      plan: result.plan,
      trace: result.plan?.agent_trace || [],
      durationMs: Date.now() - started,
    });
    return { ...result, agent_run_id: runId };
  } catch (error) {
    finishAgentRunFailure(runId, {
      error,
      durationMs: Date.now() - started,
    });
    throw error;
  } finally {
    const remaining = (inFlightByCondo.get(args.condoId) || 1) - 1;
    if (remaining <= 0) inFlightByCondo.delete(args.condoId);
    else inFlightByCondo.set(args.condoId, remaining);
  }
}

async function runAdminAgentInner(args: RunAdminAgentArgs): Promise<RunAdminAgentResult> {
  const mode = normalizeAdminAgentMode(args.mode);

  const condo = db.prepare(`SELECT id, name, address, timezone FROM condominiums WHERE id = ?`).get(args.condoId) as any;
  const footprint = db.prepare(
    `SELECT COUNT(DISTINCT b.id) AS buildings, COUNT(u.id) AS units
     FROM buildings b
     LEFT JOIN units u ON u.building_id = b.id
     WHERE b.condominium_id = ?`
  ).get(args.condoId) as any;

  // ARC-R4 — Vendor data extracted to lib/agent-vendor-repo.ts. The
  // bundle returns contacts (with reputation stats), cost history map
  // keyed by lowercase company_name, AND the name→id map used by the
  // SEC-2 binding to drop hallucinated vendor names. One DB round-
  // trip pair, same shape the inline queries produced before.
  const vendorBundle: VendorBundle = loadVendorBundle(args.condoId);
  const serviceContacts = vendorBundle.contacts;
  const costByVendor = vendorBundle.costByVendor;

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
  // ARC-R4 — Building memory extracted to lib/agent-building-memory.ts.
  // The orchestrator composes: (a) inferred category from task text,
  // (b) similar resolved tickets ranked by keyword overlap + recency,
  // (c) open-similar count over 30 days, (d) local hour + after-hours
  // signal for the condo's timezone. Inferred category + task
  // keywords stay in the runner because they're shared with the
  // sanitizer; everything else lives in the module now.
  const inferredCategory = inferCategoryFromTask(args.task);
  const taskKeywords = extractKeywords(args.task);
  const buildingMemory = buildBuildingMemory({
    condoId: args.condoId,
    task: args.task,
    inferredCategory,
    taskKeywords,
    scoreOverlap: scoreTitleOverlap,
    timezone: condo?.timezone as string | null | undefined,
  });
  // The runner used to keep separate local `now`, `localHour`,
  // `isOutsideBusinessHours` for the buildingMemory object literal.
  // The module owns those now — read back from buildingMemory for any
  // downstream code in this function that still references them.
  const isOutsideBusinessHours = buildingMemory.is_outside_business_hours;

  // Vision step — analyze every image attached to this ticket (cached
  // per-attachment so re-runs are free). Skipped when no ticketId
  // (workbench path) or when the ticket has no attachments. The
  // analysis cost is ~$0.001-0.005 per image with the low-detail
  // setting; cached forever after first call.
  if (args.agentRunId && args.ticketId) {
    appendAgentRunProgress(args.agentRunId, { label: 'Analisando fotos do chamado' });
  }
  const attachmentAnalysis = args.ticketId
    ? await analyzeTicketAttachments(args.ticketId, args.locale || 'pt-BR').catch((err) => {
        console.warn('[agent] attachment vision failed:', (err as Error)?.message || err);
        return [];
      })
    : [];

  const adminInput: AdminAgentInput = {
    task: args.task,
    mode,
    location: args.location || '',
    budget: args.budget || '',
    urgency: args.urgency || '',
    locale: args.locale || '',
    condo: condo ? { name: condo.name, address: condo.address } : null,
    service_contacts: serviceContacts,
    // SEC-L5 — thread the after-hours flag in so the fallback's
    // outreach message asks about tomorrow when fired at 23h.
    is_outside_business_hours: buildingMemory.is_outside_business_hours,
  };

  // Output-language enforcement. The in-prompt rule ("use the dominant
  // language of the task") proved unreliable — the live eval caught PT
  // tasks coming back in English. agentLanguage() resolves the locale (or
  // detects from the task text), and we append a hard directive to the
  // END of the system prompt — the most recent instruction wins.
  const LANG_NAMES = { pt: 'Brazilian Portuguese', en: 'English', es: 'Spanish', fr: 'French' } as const;
  const outputLanguage = LANG_NAMES[agentLanguage(adminInput)];
  const languageDirective = `\n\n## OUTPUT LANGUAGE — HARD RULE\nWrite EVERY field of your JSON response — summary, recommended_next_step, options, risks, resident_update, action_plan, all of it — in ${outputLanguage}. Do not switch languages mid-response. The board admin reads in ${outputLanguage}.`;

  const context = {
    generated_at: new Date().toISOString(),
    request: {
      // SEC-1: wrap the resident-controlled task string in a delimiter so
      // the model treats it as untrusted data, not instruction. See
      // wrapUntrusted() above and the SECURITY block in prompts.ts.
      task: wrapUntrusted(args.task),
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
      // contact_name is typically a first name + role ("Plantão Otis",
      // "João — atendimento"). Useful for personalized outreach drafts
      // and lower PII than direct contact details.
      contact_name: clip(c.contact_name, 120),
      // SEC-H2 — Don't ship literal phone/whatsapp/email PII to
      // OpenRouter. The model doesn't need the raw numbers to make
      // decisions; it only needs to know which channels are reachable
      // so it can recommend "WhatsApp this vendor". The actual
      // outreach is server-templated post-decision from the DB row
      // using the service_contact_id binding (SEC-2). This also
      // reduces prompt token cost ~30% per vendor.
      has_whatsapp: !!(c.whatsapp && String(c.whatsapp).trim()),
      has_phone: !!(c.phone && String(c.phone).trim()),
      has_email: !!(c.email && String(c.email).trim()),
      // service_scope is semantically necessary (vendor capability
      // text used to match to task). notes is admin free-text that
      // tends to contain resident names + unit numbers; cap shorter
      // and pass-through only the first sentence. The agent doesn't
      // need the whole admin scratchpad.
      service_scope: clip(c.service_scope, 500),
      notes: clip(String(c.notes || '').split(/[.\n]/)[0], 220),
      website: clip(c.website, 240),
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
    // Vision analysis of resident-uploaded attachments. Each entry is
    // (description, signals[]) — the model can branch on signals like
    // "leak_active" without having to interpret prose. Empty array when
    // there's no ticket context or no images.
    //
    // SEC-M3 (re-audit) — The `description` field is vision-model
    // output of a resident-uploaded image. A crafted image whose
    // OCR'd text is "IGNORE PRIOR INSTRUCTIONS..." gets transcribed
    // verbatim. Wrap it with the same boundary applied to task text
    // so the prompt instruction telling the model "treat <resident_text>
    // contents as data" covers this surface too. Signals are
    // structured tags we control, not free text — no wrapping needed.
    attachment_analysis: attachmentAnalysis.map((a) => ({
      ...a,
      description: a.description ? wrapUntrusted(a.description) : a.description,
    })),
    // Prior turns in the same thread, oldest first. Capped at 5 so the
    // prompt doesn't grow unbounded on long conversations. Each turn is
    // a tight (user_task, agent_summary, recommended_next_step) tuple —
    // we don't replay the full plan JSON, just the essence, to keep
    // token cost sane.
    // SEC-M2 — Re-check thread ownership before loading turn history.
    // The /admin-agent/threads/:id route already gates on (condo_id,
    // admin_user_id), but `runAdminAgent` is also callable from other
    // paths and from future code. Loading turns by thread_id alone
    // would let a misconfigured caller mix conversations across
    // tenants. The JOIN to agent_threads enforces the scope at the
    // query layer regardless of how the runner is invoked.
    prior_turns: args.threadId
      ? db.prepare(
          `SELECT t.user_task, t.agent_summary, t.agent_plan, t.turn_index
           FROM agent_turns t
           JOIN agent_threads th ON th.id = t.thread_id
           WHERE t.thread_id = ?
             AND th.condominium_id = ?
             ${args.adminUserId ? 'AND th.admin_user_id = ?' : ''}
           ORDER BY t.turn_index DESC
           LIMIT 5`
        ).all(
          ...(args.adminUserId
            ? [args.threadId, args.condoId, args.adminUserId]
            : [args.threadId, args.condoId])
        ).reverse().map((t: any) => {
          let nextStep: string | null = null;
          try {
            const p = t.agent_plan ? JSON.parse(t.agent_plan) : null;
            nextStep = p?.recommended_next_step || null;
          } catch { /* malformed plan, skip */ }
          return {
            turn_index: t.turn_index,
            // SEC-H1 (re-audit) — Wrap prior-turn user input with the
            // same delimiter applied to the current task. Without it a
            // prompt-injection payload typed in turn N gets replayed
            // unwrapped in turn N+1, bypassing the system-prompt
            // boundary. agent_summary + recommended_next_step are
            // already server-produced (LLM output we vetted), so we
            // don't wrap them — only user-supplied fields.
            user_task: wrapUntrusted(clip(t.user_task, 300)),
            agent_summary: clip(t.agent_summary, 300),
            recommended_next_step: nextStep ? clip(nextStep, 200) : null,
          };
        })
      : [],
    tool_limitations: 'This route can use saved building data and, when the research tool is configured, cited external vendor research. It does not perform vendor calls, purchases, bookings, or installation work. It produces a decision-ready plan, search queries, outreach copy, and a proposal draft.',
  };

  let usedFallback = false;
  let raw: any;
  let toolTrace: Array<{ name: string; input: any; output: any }> = [];
  // ReAct path is opt-in via env flag while we validate quality. The
  // existing single-shot path stays as a stable fallback and the
  // verified-everywhere default. When AGENT_USE_REACT='1', the model
  // gets a smaller initial context + tool access and decides what data
  // it needs. Multi-step (2-4 LLM calls per agent run) trades latency
  // for precision on long-tail questions.
  // Concurrency guard tripped — skip the LLM entirely and serve the
  // deterministic plan. Still useful, just not model-quality, and the
  // _fallback flag + UI banner already make that honest to the admin.
  const useReact = !args.forceFallback && process.env.AGENT_USE_REACT === '1';
  const runSingleShot = async () => {
    const text = await chat(
      [
        { role: 'system', content: ADMIN_AGENT_SYS + languageDirective },
        { role: 'user', content: JSON.stringify(context) },
      ],
      { jsonMode: true, maxTokens: 2_000, caller: 'admin-agent', condoId: args.condoId }
    );
    const parsed = parseJsonLoose<any>(text);
    if (!parsed) throw new Error('single_shot_parse_failed');
    return parsed;
  };

  // COR-M4 — Detect out-of-scope tasks BEFORE the LLM call. The
  // sanitizer rewrites these tasks as refusals downstream anyway, so
  // there's no reason to spend tokens generating a plan that will be
  // discarded. We force the fallback path which is faster, free, and
  // produces output the sanitizer can refuse identically.
  if (!args.forceFallback && looksOutOfScope(args.task || '')) {
    if (args.agentRunId) {
      appendAgentRunProgress(args.agentRunId, { label: 'Tarefa fora de escopo — recusa direta' });
    }
    raw = fallbackAdminAgent(adminInput);
    usedFallback = true;
  } else if (args.forceFallback) {
    raw = fallbackAdminAgent(adminInput);
    usedFallback = true;
    if (args.agentRunId) {
      appendAgentRunProgress(args.agentRunId, { label: 'Muitas análises simultâneas — usando checklist padrão' });
    }
  } else {
  if (args.agentRunId) {
    appendAgentRunProgress(args.agentRunId, {
      label: useReact ? 'Consultando histórico do prédio com ferramentas' : 'Consultando histórico do prédio',
    });
  }
  if (useReact) {
    try {
      const baseHandler = buildToolHandler({ condoId: args.condoId });
      // Wrap the tool handler so each call writes a progress crumb before
      // executing. Gives the polling UI live "checking past tickets... pulled
      // Otis history..." instead of a blind spinner during the ReAct loop.
      const handler: typeof baseHandler = async (name, input) => {
        if (args.agentRunId) {
          const friendly: Record<string, string> = {
            search_past_tickets: 'Buscando chamados anteriores parecidos',
            get_vendor_history: 'Consultando histórico do fornecedor',
            list_vendors: 'Listando fornecedores cadastrados',
            get_open_similar_tickets: 'Detectando padrões abertos',
            submit_final_answer: 'Compondo resposta final',
          };
          appendAgentRunProgress(args.agentRunId, {
            label: friendly[name] || name,
          });
        }
        return baseHandler(name, input);
      };
      // Minimal initial context for ReAct — the model can fetch the rest
      // via tools. We keep condominium + request + saved vendor list
      // because those are universally relevant; building_memory + cost
      // history are pulled on demand via search_past_tickets +
      // get_vendor_history.
      const reactContext = {
        generated_at: context.generated_at,
        request: context.request,
        condominium: context.condominium,
        prior_turns: context.prior_turns,
        // Vision is preloaded (not a tool) because each resident photo is
        // already analyzed + cached server-side; making the model fetch
        // it would just round-trip the same JSON.
        attachment_analysis: context.attachment_analysis,
        tool_limitations: context.tool_limitations,
      };
      const result = await chatWithTools(
        [
          { role: 'system', content: ADMIN_AGENT_REACT_SYS + languageDirective },
          { role: 'user', content: JSON.stringify(reactContext) },
        ],
        ADMIN_AGENT_TOOLS,
        handler,
        {
          maxTokens: 2_000,
          // terminalTool is the real cost lever — the loop exits the moment
          // submit_final_answer lands, so a well-behaved run never reaches
          // the cap regardless of its value. The cap is just a runaway
          // ceiling: 4 proved too tight (some tasks legitimately need 4-5
          // info-gathering rounds and then hit the cap without finalising),
          // so keep it at 6. Tunable via AGENT_MAX_ITERATIONS.
          maxIterations: Number(process.env.AGENT_MAX_ITERATIONS || 6),
          terminalTool: 'submit_final_answer',
          caller: 'admin-agent-react',
          condoId: args.condoId,
        }
      );
      toolTrace = result.toolCalls;
      // The model is expected to terminate by calling submit_final_answer
      // with the full plan in the input. Pull it from the most recent
      // tool call; if missing, fall back to parsing text. If both fail,
      // degrade to the deterministic fallback.
      const finalCall = result.toolCalls.slice().reverse().find((c) => c.name === 'submit_final_answer');
      // submit_final_answer's `plan` MUST be a real object. A string, array,
      // or primitive would slip past the truthy check and the sanitizer
      // would default every field from the fallback template — serving a
      // fallback-shaped plan with _fallback unset, defeating the honesty
      // banner. Validate the shape; if it's wrong, treat it as no plan and
      // fall through to the proper fallback path below.
      const planCandidate = finalCall?.input?.plan;
      if (planCandidate && typeof planCandidate === 'object' && !Array.isArray(planCandidate)) {
        raw = planCandidate;
      } else if (result.text) {
        // No submit_final_answer means the loop didn't converge cleanly
        // (e.g. it hit the iteration cap). result.text is then the last
        // tool RESULT, not a plan — parseJsonLoose would happily parse it
        // into non-null garbage and slip past the !raw guard, so the run
        // serves a fallback-shaped plan that isn't flagged as fallback.
        // Only accept text that actually parses into a plan-shaped object.
        const parsed = parseJsonLoose<any>(result.text);
        raw = parsed && typeof parsed.summary === 'string' ? parsed : null;
      }
      if (!raw) {
        raw = fallbackAdminAgent(adminInput);
        usedFallback = true;
      }
    } catch (err) {
      console.warn('[agent-react] failed, trying single-shot:', (err as Error)?.message || err);
      if (args.agentRunId) {
        appendAgentRunProgress(args.agentRunId, { label: 'Ferramentas falharam — gerando plano direto' });
      }
      try {
        raw = await runSingleShot();
      } catch (singleShotErr) {
        console.warn('[agent-single-shot] failed, using fallback:', (singleShotErr as Error)?.message || singleShotErr);
        raw = fallbackAdminAgent(adminInput);
        usedFallback = true;
      }
    }
  } else {
    try {
      raw = await runSingleShot();
    } catch {
      raw = fallbackAdminAgent(adminInput);
      usedFallback = true;
    }
  }
  } // end: concurrency-guard fallback vs live LLM path

  // COR-H6 — thread the trusted usedFallback signal through so the
  // sanitizer doesn't have to read `_fallback` from the model's raw
  // output (which it would emit on a real LLM response after seeing
  // the field in prompt examples).
  const plan = sanitizeAdminAgentOutput(raw, adminInput, usedFallback);

  // SEC-2 — Bind each model-emitted network fit back to a real
  // service_contacts row via DB id, and DROP any fit whose company_name
  // doesn't match a saved contact in this condo. The model only ever
  // sees company_name strings (which could be hallucinated or planted
  // via prompt injection); the auto-dispatch path will dispatch by id,
  // so an unmatched fit becomes a no-op rather than a possible
  // attacker-controlled outreach. The build map (vendorBundle.idByName)
  // is built case-insensitively (also fixes COR-H5).
  if (plan.existing_network_fit?.length) {
    plan.existing_network_fit = plan.existing_network_fit
      .map((fit) => {
        const id = vendorBundle.idByName.get(String(fit.company_name || '').toLowerCase()) ?? null;
        if (!id) {
          // Model named a vendor that doesn't exist in this condo. Could
          // be a hallucination or a prompt-injection attempt. Either way,
          // we cannot dispatch to it — return with id=null so callers
          // can refuse, and log the event.
          console.warn(`[agent] dropping unmatched fit company_name="${fit.company_name}" for condo ${args.condoId}`);
        }
        return { ...fit, service_contact_id: id };
      })
      // Drop entries with no matching DB row entirely — the UI doesn't
      // need to show ghosts, and the dispatch path is no longer the only
      // line of defense.
      .filter((fit) => fit.service_contact_id != null);
  }

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

  // Attach vision results so the UI doesn't have to fetch attachments
  // separately. Empty array stays out of the response payload.
  if (attachmentAnalysis.length > 0) {
    plan.attachment_analysis = attachmentAnalysis;
  }

  // Surface the ReAct tool trace so the UI can render a "thinking" view
  // ("checked past elevator tickets... pulled Otis history..."). Only
  // present on the ReAct path; the single-shot path returns []. Cheap
  // to include — even a 5-tool trace is a few KB.
  if (toolTrace.length > 0) {
    plan.agent_trace = toolTrace.map((t) => ({
      tool: t.name,
      input_keys: Object.keys(t.input || {}),
      output_summary: summariseToolOutput(t.name, t.output),
    }));
  }

  // First-class evidence cards. The trace tells the admin what the agent
  // looked up; evidence_sources shows the concrete facts/citations used.
  plan.evidence_sources = buildAgentEvidenceSources(plan, toolTrace, args.locale);

  // Confidence-inflation cross-check. A "high" rating triggers the
  // platform's auto-execute path (see prompts.ts confidence rules + the
  // veto window in tickets.ts). If the model claims high but produced
  // NEITHER a saved-vendor citation NOR a past_ticket evidence source,
  // it's rating itself on vibes — cap to medium so auto-dispatch can't
  // fire on a forged score. Scope refusal (looksOutOfScope) explicitly
  // sets high with no fit/options; honour that case.
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
      console.warn(`[agent] capping high→medium confidence: no vendor + no past ticket cited (task_type=${plan.task_type})`);
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

  // Persist the turn to agent_turns when we have a thread + admin. The
  // route is responsible for creating the thread row before calling this
  // helper if it's a fresh conversation; here we just append.
  //
  // COR-M1 — SELECT MAX + INSERT could race when two tabs hit the same
  // thread simultaneously: both reads see the same MAX → both insert
  // with the same turn_index → the second turn is silently dropped by
  // any consumer that paginates by index. Wrap the read-then-write in
  // a SQLite transaction so concurrent calls serialize at the writer.
  // Even though better-sqlite3 is synchronous within a process, the
  // transaction makes the invariant explicit and survives an
  // accidental async refactor.
  let persistedTurnIndex: number | undefined;
  if (args.threadId && args.adminUserId) {
    persistedTurnIndex = db.transaction(() => {
      const next = (db.prepare(
        `SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index FROM agent_turns WHERE thread_id = ?`
      ).get(args.threadId) as { next_index: number }).next_index;
      db.prepare(
        `INSERT INTO agent_turns (thread_id, turn_index, user_task, agent_summary, agent_plan, fallback)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        args.threadId,
        next,
        args.task,
        String(plan.summary || '').slice(0, 800),
        JSON.stringify(plan),
        usedFallback ? 1 : 0,
      );
      db.prepare(
        `UPDATE agent_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(args.threadId);
      return next;
    })();
  }

  return { plan, fallback: usedFallback, thread_id: args.threadId, turn_index: persistedTurnIndex };
}
