// Tool registry for the admin agent's ReAct loop (roadmap item 4).
//
// Each tool is a pair: a schema the model sees + a handler the runner
// executes server-side. We deliberately keep the surface narrow — five
// or six well-targeted tools beat thirty fuzzy ones. The model picks
// what it needs; nothing gets preloaded unless it's universally useful
// (condo metadata, the request itself).
//
// Tools available in v2:
//   - search_past_tickets   — past resolved tickets matching a symptom
//   - get_vendor_history    — full dispatch + expense trail for ONE vendor
//   - list_vendors          — active vendors in this condo, optionally filtered
//   - get_open_similar      — pattern detection on demand
//   - research_external_vendors — cited web/vendor research when configured
//   - submit_final_answer   — required terminal call; carries the JSON plan
//
// Why submit_final_answer as a tool instead of just letting the model
// emit text? OpenRouter's tool-use mode replaces structured output
// (response_format=json_object). Forcing the model to call this tool
// when done guarantees we get the AgentResult shape back instead of
// markdown-wrapped JSON or chatty prose.

import db from '../db';
import type { AIToolSchema, AIToolHandler } from './openrouter';
import { inferCategoryFromTask, extractKeywords, scoreTitleOverlap } from './admin-agent-runner';
import { researchExternalVendors } from './web-research';

export interface ToolContext {
  condoId: number;
}

// ---- Tool schemas (what the model sees) ----

export const ADMIN_AGENT_TOOLS: AIToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'search_past_tickets',
      description: 'Find resolved tickets in this building that look similar to a new symptom. Returns up to 5 matches ordered by recency and keyword overlap. Use this FIRST when the user reports a repair / installation / issue — the building\'s own history is the strongest signal.',
      parameters: {
        type: 'object',
        properties: {
          symptom: {
            type: 'string',
            description: 'Short description of the new problem, e.g. "elevador A ruído entre andares". Used to infer category + match against past ticket titles.',
          },
          category_hint: {
            type: 'string',
            description: 'Optional category override if the symptom is ambiguous. One of: elevator, plumbing, electrical, hvac, security, fire_safety, gas, gas_leak, water, water_damage, cleaning, amenity, maintenance.',
          },
        },
        required: ['symptom'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vendor_history',
      description: 'Detailed dispatch + expense trail for ONE saved vendor by company name. Returns last 12 months of expenses, all-time dispatch counts, average response time, and the most recent dispatched ticket. Use when comparing options or before recommending a specific vendor.',
      parameters: {
        type: 'object',
        properties: {
          company_name: {
            type: 'string',
            description: 'Exact saved vendor company_name. Get one from list_vendors first if you\'re not sure.',
          },
        },
        required: ['company_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_vendors',
      description: 'Active saved vendors in this condo. Optionally filtered by category. Returns short cards (id, name, category, has_whatsapp, preferred, dispatches_total, dispatches_responded). Cheap — call this when you need to know what\'s in the network.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Optional category filter, e.g. "elevator", "plumbing", "general_maintenance".',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_open_similar_tickets',
      description: 'Count of currently-open tickets in a category over a window (default 30 days). Use to detect patterns — if ≥3 open in 30 days, recommend a preventive inspection in your final answer.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Category to check, e.g. "plumbing".',
          },
          days: {
            type: 'integer',
            description: 'Lookback window in days. Default 30.',
          },
        },
        required: ['category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_external_vendors',
      description: 'Cited external web research for competitor/vendor options. Use ONLY when the admin asks for competitors, outside vendors, alternatives, or market options. Returns citations with URLs. If configured=false, do not claim live research; return the fallback search URLs as next steps.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Specific vendor/service query, e.g. "empresa manutenção elevador condomínio São Paulo".',
          },
          category: {
            type: 'string',
            description: 'Optional service category, e.g. elevator, plumbing, electrical, gym equipment.',
          },
          location: {
            type: 'string',
            description: 'Optional city/neighborhood/address context to localize vendor results.',
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum cited results to return, 1-8. Default 5.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_final_answer',
      description: 'REQUIRED terminal call. When you have gathered enough context, call this with the full plan JSON. After this, no more tools — your job is done. The plan structure follows the standard ADMIN_AGENT_SYS schema (summary, task_type, options, etc.).',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'object',
            description: 'The complete plan JSON matching the schema defined in ADMIN_AGENT_SYS.',
          },
        },
        required: ['plan'],
      },
    },
  },
];

// ---- Handler implementations ----

export function buildToolHandler(ctx: ToolContext): AIToolHandler {
  return async (name, input) => {
    switch (name) {
      case 'search_past_tickets':
        return searchPastTickets(ctx, input);
      case 'get_vendor_history':
        return getVendorHistory(ctx, input);
      case 'list_vendors':
        return listVendors(ctx, input);
      case 'get_open_similar_tickets':
        return getOpenSimilarTickets(ctx, input);
      case 'research_external_vendors':
        return researchExternalVendors(input);
      case 'submit_final_answer':
        // This one is special — the runner intercepts it before reaching
        // the handler in normal flow, but we still need a safe default
        // in case the model calls it without going through the loop.
        return { acknowledged: true, plan: input?.plan || null };
      default:
        return { error: 'unknown_tool', tool_name: name };
    }
  };
}

function searchPastTickets(ctx: ToolContext, input: any) {
  const symptom = String(input?.symptom || '').slice(0, 500);
  if (!symptom) return { matches: [], error: 'symptom_required' };
  const category = String(input?.category_hint || inferCategoryFromTask(symptom) || '').slice(0, 60);
  if (!category) return { matches: [], note: 'no category could be inferred from symptom' };

  const candidates = db.prepare(
    `SELECT t.id, t.title, t.category, t.priority, t.resolved_at, t.agent_plan,
            GROUP_CONCAT(DISTINCT sc.company_name) AS dispatched_vendors,
            MAX(d.response_summary) AS last_vendor_response,
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
  ).all(ctx.condoId, category) as any[];

  const keywords = extractKeywords(symptom);
  const scored = candidates
    .map((c) => ({ ...c, _score: scoreTitleOverlap(keywords, c.title || '') }))
    .sort((a, b) => (b._score !== a._score ? b._score - a._score : String(b.resolved_at || '').localeCompare(String(a.resolved_at || ''))));

  return {
    inferred_category: category,
    matches: scored.slice(0, 5).map((t) => {
      let costBrl: number | null = null;
      try {
        if (t.agent_plan) {
          const p = JSON.parse(t.agent_plan);
          costBrl = p?.proposal_draft?.estimated_cost ?? null;
        }
      } catch { /* skip */ }
      return {
        id: t.id,
        title: String(t.title || '').slice(0, 160),
        priority: t.priority,
        resolved_at: t.resolved_at,
        dispatched_vendors: t.dispatched_vendors,
        resolution: String(t.last_vendor_response || t.last_comment || '').slice(0, 400),
        estimated_cost_brl: costBrl,
        _keyword_score: t._score,
      };
    }),
  };
}

function getVendorHistory(ctx: ToolContext, input: any) {
  const name = String(input?.company_name || '').trim();
  if (!name) return { error: 'company_name_required' };

  const vendor = db.prepare(
    `SELECT id, category, company_name, contact_name, phone, whatsapp, email,
            service_scope, emergency_available, preferred, last_used_at
     FROM service_contacts
     WHERE condominium_id = ? AND active = 1 AND LOWER(company_name) = LOWER(?)
     LIMIT 1`
  ).get(ctx.condoId, name) as any;
  if (!vendor) return { error: 'vendor_not_found', searched_name: name };

  // SEC-M1 — Scope dispatch joins by condominium_id even though
  // service_contact_id is already condo-bound (vendor.id was fetched
  // WHERE condominium_id = ? above). The defense is for: a future
  // data migration that ever lets service_contact_id span condos, or
  // a vendor row that gets reassigned. The cost of the extra
  // condition is zero — the index already covers the path.
  const dispatches = db.prepare(
    `SELECT d.id, d.channel, d.status, d.created_at, d.responded_at, d.response_summary,
            t.id AS ticket_id, t.title AS ticket_title
     FROM ticket_dispatches d
     JOIN tickets t ON t.id = d.ticket_id
     WHERE d.service_contact_id = ? AND t.condominium_id = ?
     ORDER BY d.created_at DESC
     LIMIT 5`
  ).all(vendor.id, ctx.condoId) as any[];
  // COR-M3 — Align dispatch_stats to the same 24-month window as
  // expense_stats. Previously dispatch totals were all-time while
  // expense counts were 24-month, so the model reasoned about a
  // vendor with "50 dispatches but only 2 expenses (low confidence)"
  // when the real comparison should be "12 dispatches in 24 months
  // vs 2 expenses in 24 months — still low but meaningful". Same
  // window on both sides means the confidence reasoning lines up.
  const dispatchStats = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN d.status = 'responded' THEN 1 ELSE 0 END) AS responded,
            AVG(CASE WHEN d.status = 'responded' AND d.responded_at IS NOT NULL
                     THEN (strftime('%s', d.responded_at) - strftime('%s', d.created_at))
                     ELSE NULL END) AS avg_response_seconds
     FROM ticket_dispatches d
     JOIN tickets t ON t.id = d.ticket_id
     WHERE d.service_contact_id = ? AND t.condominium_id = ?
       AND substr(d.created_at, 1, 10) >= date('now', '-24 months')`
  ).get(vendor.id, ctx.condoId) as any;

  // Expense history.
  const expenses = db.prepare(
    `SELECT id, amount_cents, spent_at, description
     FROM expenses
     WHERE condominium_id = ?
       AND LOWER(vendor) LIKE LOWER(?) || '%'
       AND substr(spent_at, 1, 10) >= date('now', '-24 months')
     ORDER BY spent_at DESC
     LIMIT 10`
  ).all(ctx.condoId, vendor.company_name) as any[];
  const expenseStats = db.prepare(
    `SELECT COUNT(*) AS count, AVG(amount_cents) AS avg_cents,
            MIN(amount_cents) AS min_cents, MAX(amount_cents) AS max_cents
     FROM expenses
     WHERE condominium_id = ?
       AND LOWER(vendor) LIKE LOWER(?) || '%'
       AND substr(spent_at, 1, 10) >= date('now', '-24 months')`
  ).get(ctx.condoId, vendor.company_name) as any;

  return {
    vendor: {
      id: vendor.id,
      company_name: vendor.company_name,
      category: vendor.category,
      contact_name: vendor.contact_name,
      has_whatsapp: !!vendor.whatsapp,
      has_email: !!vendor.email,
      emergency_available: !!vendor.emergency_available,
      preferred: !!vendor.preferred,
      last_used_at: vendor.last_used_at,
      service_scope: vendor.service_scope,
    },
    dispatch_stats: {
      total: Number(dispatchStats?.total || 0),
      responded: Number(dispatchStats?.responded || 0),
      response_rate: dispatchStats?.total
        ? Number(dispatchStats.responded) / Number(dispatchStats.total)
        : null,
      avg_response_seconds: dispatchStats?.avg_response_seconds != null
        ? Math.round(Number(dispatchStats.avg_response_seconds))
        : null,
    },
    recent_dispatches: dispatches.map((d) => ({
      ticket_id: d.ticket_id,
      ticket_title: String(d.ticket_title || '').slice(0, 160),
      channel: d.channel,
      status: d.status,
      at: d.created_at,
      responded_at: d.responded_at,
      response_summary: String(d.response_summary || '').slice(0, 240),
    })),
    expense_stats: {
      count: Number(expenseStats?.count || 0),
      avg_brl: expenseStats?.avg_cents != null ? Math.round(Number(expenseStats.avg_cents)) / 100 : null,
      min_brl: expenseStats?.min_cents != null ? Math.round(Number(expenseStats.min_cents)) / 100 : null,
      max_brl: expenseStats?.max_cents != null ? Math.round(Number(expenseStats.max_cents)) / 100 : null,
      // Confidence tier so the model uses the right language. 3+ samples
      // = histórico; 1-2 = valor de referência.
      confidence: Number(expenseStats?.count || 0) >= 3 ? 'high' : 'low',
    },
    recent_expenses: expenses.map((e) => ({
      amount_brl: Math.round(Number(e.amount_cents)) / 100,
      spent_at: e.spent_at,
      description: String(e.description || '').slice(0, 200),
    })),
  };
}

function listVendors(ctx: ToolContext, input: any) {
  const category = String(input?.category || '').slice(0, 60);
  const rows = db.prepare(
    `SELECT sc.id, sc.company_name, sc.category, sc.preferred, sc.emergency_available,
            sc.last_used_at, (sc.whatsapp IS NOT NULL) AS has_whatsapp, (sc.email IS NOT NULL) AS has_email,
            COUNT(d.id) AS dispatches_total,
            SUM(CASE WHEN d.status = 'responded' THEN 1 ELSE 0 END) AS dispatches_responded
     FROM service_contacts sc
     LEFT JOIN ticket_dispatches d ON d.service_contact_id = sc.id
     WHERE sc.condominium_id = ? AND sc.active = 1
       ${category ? 'AND sc.category = ?' : ''}
     GROUP BY sc.id
     ORDER BY sc.preferred DESC, sc.emergency_available DESC, sc.company_name ASC
     LIMIT 25`
  ).all(...(category ? [ctx.condoId, category] : [ctx.condoId])) as any[];

  return {
    vendors: rows.map((v) => ({
      id: v.id,
      company_name: v.company_name,
      category: v.category,
      has_whatsapp: !!v.has_whatsapp,
      has_email: !!v.has_email,
      preferred: !!v.preferred,
      emergency_available: !!v.emergency_available,
      last_used_at: v.last_used_at,
      dispatches_total: Number(v.dispatches_total || 0),
      dispatches_responded: Number(v.dispatches_responded || 0),
    })),
  };
}

function getOpenSimilarTickets(ctx: ToolContext, input: any) {
  const category = String(input?.category || '').slice(0, 60);
  if (!category) return { error: 'category_required' };
  const days = Math.min(365, Math.max(1, Number(input?.days || 30)));
  const row = db.prepare(
    `SELECT COUNT(*) AS open_count
     FROM tickets
     WHERE condominium_id = ?
       AND category = ?
       AND remediation_status != 'resolved'
       AND substr(created_at, 1, 10) >= date('now', '-' || ? || ' days')`
  ).get(ctx.condoId, category, days) as { open_count: number };

  return {
    category,
    window_days: days,
    open_count: Number(row?.open_count || 0),
    is_pattern: Number(row?.open_count || 0) >= 3,
  };
}
