import db from '../db';

export const MEMORY_TYPES = [
  'ticket',
  'work_order',
  'expense',
  'proposal',
  'announcement',
  'document',
  'meeting',
  'service_contact',
] as const;

export type MemoryType = typeof MEMORY_TYPES[number];
export type MemoryRole = 'resident' | 'board_admin' | 'concierge';

export interface MemoryResult {
  type: MemoryType;
  id: number;
  title: string;
  subtitle?: string;
  body?: string;
  status?: string;
  date?: string;
  amount_cents?: number | null;
  url?: string;
  meta?: Record<string, string | number | null | undefined>;
}

export interface MemorySearchInput {
  condoId: number;
  userId: number;
  role: MemoryRole;
  query?: string;
  types?: MemoryType[];
  limit?: number;
}

export interface MemorySearchOutput {
  query: string;
  results: MemoryResult[];
  total: number;
  counts: Partial<Record<MemoryType, number>>;
  suggested_queries: string[];
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokensFor(query: string): string[] {
  return Array.from(new Set(normalizeText(query).split(/\s+/).filter((t) => t.length >= 2))).slice(0, 8);
}

function selectedTypes(raw?: MemoryType[]): Set<MemoryType> {
  const allowed = new Set<MemoryType>(MEMORY_TYPES);
  const chosen = (raw || []).filter((type): type is MemoryType => allowed.has(type));
  return new Set(chosen.length ? chosen : MEMORY_TYPES);
}

function canUse(input: MemorySearchInput, type: MemoryType) {
  if (type === 'service_contact') return input.role === 'board_admin';
  return true;
}

function routeFor(role: MemoryRole, type: MemoryType, id: number): string {
  const base = role === 'board_admin' ? '/board' : role === 'concierge' ? '/concierge' : '/app';
  if (type === 'proposal') return `${base === '/board' ? '/board' : '/app'}/proposals/${id}`;
  if (type === 'ticket' || type === 'work_order') return `${base === '/board' ? '/board' : '/app'}/tickets`;
  if (type === 'expense') return base === '/board' ? '/board/financas' : '/app/transparencia';
  if (type === 'document') return base === '/board' ? '/board/documents' : '/app/documents';
  if (type === 'meeting') return base === '/board' ? '/board/meetings' : '/app/meetings';
  if (type === 'announcement') return base === '/board' ? '/board/announcements' : '/app/announcements';
  if (type === 'service_contact') return '/board/services';
  return base;
}

function scoreResult(item: MemoryResult, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const title = normalizeText(item.title);
  const subtitle = normalizeText(item.subtitle);
  const body = normalizeText(item.body);
  const meta = normalizeText(Object.values(item.meta || {}).join(' '));
  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 6;
    if (subtitle.includes(token)) score += 3;
    if (body.includes(token)) score += 2;
    if (meta.includes(token)) score += 1;
  }
  return score;
}

function addRanked(
  bucket: Array<{ item: MemoryResult; score: number }>,
  item: MemoryResult,
  tokens: string[],
) {
  const score = scoreResult(item, tokens);
  if (tokens.length > 0 && score <= 0) return;
  bucket.push({ item, score });
}

function parseMaybeJsonSummary(value: unknown): string {
  if (!value) return '';
  const raw = String(value);
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed.summary) return String(parsed.summary);
    if (parsed.resident_announcement?.body) return String(parsed.resident_announcement.body);
    return JSON.stringify(parsed).slice(0, 500);
  } catch {
    return raw;
  }
}

function ticketVisibilityWhere(input: MemorySearchInput) {
  if (input.role === 'board_admin') return { sql: '', params: [] as unknown[] };
  return { sql: ' AND (t.reporter_id = ? OR t.verification_threshold > 0)', params: [input.userId] as unknown[] };
}

export function searchBuildingMemory(input: MemorySearchInput): MemorySearchOutput {
  const query = String(input.query || '').trim().slice(0, 160);
  const tokens = tokensFor(query);
  const types = selectedTypes(input.types);
  const limit = Math.min(Math.max(Number(input.limit || 40), 1), 80);
  const ranked: Array<{ item: MemoryResult; score: number }> = [];
  const recentLimit = tokens.length ? 180 : limit;

  if (types.has('ticket') && canUse(input, 'ticket')) {
    const visibility = ticketVisibilityWhere(input);
    const rows = db.prepare(
      `SELECT t.id, t.title, t.description, t.category, t.priority, t.status,
              t.remediation_status, t.updated_at, t.created_at, t.resolved_at,
              u.number AS unit_number,
              r.first_name AS reporter_first, r.last_name AS reporter_last
       FROM tickets t
       JOIN users r ON r.id = t.reporter_id
       LEFT JOIN units u ON u.id = t.unit_id
       WHERE t.condominium_id = ?${visibility.sql}
       ORDER BY t.updated_at DESC
       LIMIT ?`
    ).all(input.condoId, ...visibility.params, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'ticket',
        id: row.id,
        title: row.title,
        subtitle: [row.category, row.priority, row.unit_number ? `Unit ${row.unit_number}` : null].filter(Boolean).join(' · '),
        body: row.description,
        status: row.remediation_status || row.status,
        date: row.resolved_at || row.updated_at || row.created_at,
        url: routeFor(input.role, 'ticket', row.id),
        meta: {
          reporter: [row.reporter_first, row.reporter_last].filter(Boolean).join(' '),
          category: row.category,
          priority: row.priority,
        },
      }, tokens);
    }
  }

  if (types.has('work_order') && canUse(input, 'work_order')) {
    const visibility = ticketVisibilityWhere(input);
    const rows = db.prepare(
      `SELECT wo.id, wo.title, wo.scope, wo.status, wo.scheduled_for, wo.started_at,
              wo.completed_at, wo.estimated_amount_cents, wo.approved_amount_cents,
              wo.completion_note, wo.invoice_url, wo.photo_url,
              t.id AS ticket_id, t.title AS ticket_title, t.reporter_id, t.verification_threshold,
              sc.company_name AS vendor_name
       FROM ticket_work_orders wo
       JOIN tickets t ON t.id = wo.ticket_id
       LEFT JOIN service_contacts sc ON sc.id = wo.service_contact_id
       WHERE t.condominium_id = ?${visibility.sql}
       ORDER BY wo.updated_at DESC
       LIMIT ?`
    ).all(input.condoId, ...visibility.params, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'work_order',
        id: row.id,
        title: row.title || row.ticket_title,
        subtitle: [row.vendor_name, row.scheduled_for].filter(Boolean).join(' · '),
        body: [row.scope, row.completion_note].filter(Boolean).join('\n\n'),
        status: row.status,
        date: row.completed_at || row.scheduled_for || row.started_at,
        amount_cents: row.approved_amount_cents ?? row.estimated_amount_cents,
        url: routeFor(input.role, 'work_order', row.ticket_id),
        meta: {
          ticket: row.ticket_title,
          vendor: row.vendor_name,
          invoice_url: row.invoice_url,
          photo_url: row.photo_url,
        },
      }, tokens);
    }
  }

  if (types.has('expense') && canUse(input, 'expense')) {
    const rows = db.prepare(
      `SELECT e.id, e.category, e.vendor, e.description, e.amount_cents, e.currency,
              e.spent_at, e.receipt_url, p.title AS proposal_title
       FROM expenses e
       LEFT JOIN proposals p ON p.id = e.related_proposal_id
       WHERE e.condominium_id = ?
       ORDER BY e.spent_at DESC
       LIMIT ?`
    ).all(input.condoId, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'expense',
        id: row.id,
        title: row.description,
        subtitle: [row.category, row.vendor].filter(Boolean).join(' · '),
        body: row.proposal_title || '',
        date: row.spent_at,
        amount_cents: row.amount_cents,
        url: routeFor(input.role, 'expense', row.id),
        meta: {
          category: row.category,
          vendor: row.vendor,
          receipt_url: row.receipt_url,
          currency: row.currency,
        },
      }, tokens);
    }
  }

  if (types.has('proposal') && canUse(input, 'proposal')) {
    const rows = db.prepare(
      `SELECT p.id, p.title, p.description, p.category, p.estimated_cost,
              p.cost_breakdown, p.risk_summary, p.status, p.created_at, p.updated_at,
              COUNT(v.user_id) AS vote_count
       FROM proposals p
       LEFT JOIN proposal_votes v ON v.proposal_id = p.id
       WHERE p.condominium_id = ?
       GROUP BY p.id
       ORDER BY p.updated_at DESC
       LIMIT ?`
    ).all(input.condoId, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'proposal',
        id: row.id,
        title: row.title,
        subtitle: [row.category, row.status, `${row.vote_count || 0} votes`].filter(Boolean).join(' · '),
        body: [row.description, row.cost_breakdown, row.risk_summary].filter(Boolean).join('\n\n'),
        status: row.status,
        date: row.updated_at || row.created_at,
        amount_cents: row.estimated_cost ? Math.round(Number(row.estimated_cost) * 100) : null,
        url: routeFor(input.role, 'proposal', row.id),
        meta: { category: row.category, vote_count: row.vote_count },
      }, tokens);
    }
  }

  if (types.has('announcement') && canUse(input, 'announcement')) {
    const rows = db.prepare(
      `SELECT id, title, body, source, pinned, created_at
       FROM announcements
       WHERE condominium_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(input.condoId, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'announcement',
        id: row.id,
        title: row.title,
        subtitle: row.source,
        body: row.body,
        status: row.pinned ? 'pinned' : undefined,
        date: row.created_at,
        url: routeFor(input.role, 'announcement', row.id),
      }, tokens);
    }
  }

  if (types.has('document') && canUse(input, 'document')) {
    const visibility = input.role === 'board_admin' ? '' : " AND visibility = 'residents'";
    const rows = db.prepare(
      `SELECT id, title, category, description, file_url, document_date, visibility, updated_at
       FROM building_documents
       WHERE condominium_id = ? AND active = 1${visibility}
       ORDER BY COALESCE(document_date, updated_at) DESC
       LIMIT ?`
    ).all(input.condoId, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'document',
        id: row.id,
        title: row.title,
        subtitle: [row.category, row.visibility].filter(Boolean).join(' · '),
        body: row.description,
        status: row.visibility,
        date: row.document_date || row.updated_at,
        url: routeFor(input.role, 'document', row.id),
        meta: { file_url: row.file_url, category: row.category },
      }, tokens);
    }
  }

  if (types.has('meeting') && canUse(input, 'meeting')) {
    const rows = db.prepare(
      `SELECT id, title, agenda, ai_summary, status, scheduled_for
       FROM meetings
       WHERE condominium_id = ?
       ORDER BY scheduled_for DESC
       LIMIT ?`
    ).all(input.condoId, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'meeting',
        id: row.id,
        title: row.title,
        subtitle: row.status,
        body: [row.agenda, parseMaybeJsonSummary(row.ai_summary)].filter(Boolean).join('\n\n'),
        status: row.status,
        date: row.scheduled_for,
        url: routeFor(input.role, 'meeting', row.id),
      }, tokens);
    }
  }

  if (types.has('service_contact') && canUse(input, 'service_contact')) {
    const rows = db.prepare(
      `SELECT id, category, company_name, contact_name, phone, whatsapp, email,
              website, service_scope, notes, contract_url, emergency_available,
              preferred, last_used_at, updated_at
       FROM service_contacts
       WHERE condominium_id = ? AND active = 1
       ORDER BY preferred DESC, last_used_at DESC NULLS LAST, company_name ASC
       LIMIT ?`
    ).all(input.condoId, recentLimit) as Array<any>;
    for (const row of rows) {
      addRanked(ranked, {
        type: 'service_contact',
        id: row.id,
        title: row.company_name,
        subtitle: [row.category, row.contact_name].filter(Boolean).join(' · '),
        body: [row.service_scope, row.notes].filter(Boolean).join('\n\n'),
        status: row.preferred ? 'preferred' : row.emergency_available ? 'emergency' : undefined,
        date: row.last_used_at || row.updated_at,
        url: routeFor(input.role, 'service_contact', row.id),
        meta: {
          phone: row.phone,
          whatsapp: row.whatsapp,
          email: row.email,
          website: row.website,
          contract_url: row.contract_url,
        },
      }, tokens);
    }
  }

  const sorted = ranked
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.item.date || '').localeCompare(String(a.item.date || ''));
    })
    .slice(0, limit)
    .map((entry) => entry.item);

  const counts = sorted.reduce<Partial<Record<MemoryType, number>>>((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});

  return {
    query,
    results: sorted,
    total: sorted.length,
    counts,
    suggested_queries: ['lobby air conditioner', 'gym treadmill', 'insurance', 'EV chargers', 'pool maintenance'],
  };
}
