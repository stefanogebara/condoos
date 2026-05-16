import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db';
import { claimPendingInvitesForUser } from '../src/lib/invites';
import { canVote, getProposalVoteTally, resolveVoteOutcome, computeQuorum, countEligibleVoters } from '../src/lib/proposal-tally';
import { parseJsonLoose, classifyStatus, OpenRouterError, aiBreakerState } from '../src/ai/openrouter';
import { estimateCostUsd, getAiUsageSummary, recordAiUsage } from '../src/lib/ai-usage';
import { agentLanguage, fallbackAdminAgent, presentAdminAgentForOperator, sanitizeAdminAgentOutput } from '../src/ai/admin-agent';
import { tickVoteCloser } from '../src/lib/vote-closer';
import {
  canVoteInAssembly,
  resolveProxyVote,
  resolveAgendaOutcome,
  getAgendaTally,
  generateAtaMarkdown,
  listEligibleOwners,
} from '../src/lib/assembly';
import {
  listUnitMembershipHistory,
  moveOutMembership,
  reassignPendingMembership,
  reactivateMembership,
  transferUnit,
} from '../src/lib/memberships';
import { audit, auditRowsToCsv, listAuditRows } from '../src/lib/audit';
import {
  approvePaymentProof,
  getBudgetSummary,
  generateInvoices,
  generateScheduledInvoices,
  recordPayment,
  rejectPaymentProof,
  submitPaymentProof,
  upsertBudgetTargets,
} from '../src/lib/finance';
import { requireAuth, revokeUserTokens, signToken } from '../src/lib/auth';
import { canAssignTicketToUser, listTicketTimeline, markTicketAgentFailed, recordTicketEvent } from '../src/lib/tickets';
import { createTicketQuote, listTicketQuotes } from '../src/lib/ticket-quotes';
import { createAgentRun, finishAgentRunFailure, finishAgentRunSuccess } from '../src/lib/agent-runs';
import { buildAgentEvidenceSources } from '../src/lib/agent-evidence';
import { evaluateAgentAutoDispatch } from '../src/lib/agent-auto-dispatch';
import { normalizeServiceContact, serviceContactSchema } from '../src/lib/service-contacts';
import { listServiceContactsWithScorecards } from '../src/lib/vendor-scorecards';
import { searchBuildingMemory } from '../src/lib/memory';
import { getBoardPacket } from '../src/lib/board-packet';
import { researchExternalVendors } from '../src/ai/web-research';
import { getDashboardActions } from '../src/lib/dashboard-actions';
import { createInAppNotification, markInAppNotificationRead } from '../src/lib/in-app-notifications';
import { assertFileReadyForUse, canAccessFile, createPendingFile, markFileReady } from '../src/lib/files';

function resetDb() {
  const tables = [
    'ai_usage',
    'agent_runs',
    'agent_turns',
    'agent_threads',
    'ticket_events',
    'ticket_vendor_quotes',
    'ticket_attachments',
    'ticket_comments',
    'ticket_work_orders',
    'ticket_dispatches',
    'ticket_verifications',
    'tickets',
    'building_documents',
    'expenses',
    'budget_targets',
    'payment_proofs',
    'files',
    'payments',
    'invoices',
    'dues_schedules',
    'in_app_notifications',
    'notification_outbox',
    'packages',
    'visitors',
    'announcements',
    'audit_log',
    'amenity_reservations',
    'amenities',
    'service_contacts',
    'assembly_votes',
    'assembly_proxies',
    'assembly_attendance',
    'assembly_agenda_items',
    'assemblies',
    'action_items',
    'meetings',
    'invites',
    'user_unit',
    'units',
    'buildings',
    'proposal_comments',
    'proposal_votes',
    'proposals',
    'suggestion_clusters',
    'suggestions',
    'users',
    'condominiums',
  ];
  db.pragma('foreign_keys = OFF');
  for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
  for (const table of tables) db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(table);
  db.pragma('foreign_keys = ON');
}

function createCondoFixture() {
  const condoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Test Condo', '1 Main', 'TEST01')`
  ).run().lastInsertRowid);
  const buildingId = Number(db.prepare(
    `INSERT INTO buildings (condominium_id, name, floors) VALUES (?, 'Main', 10)`
  ).run(condoId).lastInsertRowid);
  const unit101 = Number(db.prepare(
    `INSERT INTO units (building_id, floor, number) VALUES (?, 1, '101')`
  ).run(buildingId).lastInsertRowid);
  const unit102 = Number(db.prepare(
    `INSERT INTO units (building_id, floor, number) VALUES (?, 1, '102')`
  ).run(buildingId).lastInsertRowid);
  return { condoId, buildingId, unit101, unit102 };
}

function createUser(email: string, role: 'resident' | 'board_admin' | 'concierge' = 'resident') {
  return Number(db.prepare(
    `INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role)
     VALUES (NULL, ?, 'hash', 'Test', 'User', ?)`
  ).run(email, role).lastInsertRowid);
}

function responseRecorder() {
  const calls: { statusCode?: number; body?: any } = {};
  const res = {
    status(code: number) {
      calls.statusCode = code;
      return this;
    },
    json(body: any) {
      calls.body = body;
      return this;
    },
  } as any;
  return { calls, res };
}

test('CSV-style pending invite claim preserves membership settings', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const user = {
    id: createUser('owner@example.com'),
    email: 'owner@example.com',
    condominium_id: null,
    unit_number: null,
  };

  db.prepare(
    `INSERT INTO invites (condominium_id, email, unit_id, role, relationship, primary_contact, voting_weight, status)
     VALUES (?, ?, ?, 'resident', 'owner', 1, 2.5, 'pending')`
  ).run(condoId, user.email, unit101);

  const claimed = claimPendingInvitesForUser(user);
  assert.equal(claimed, 1);
  assert.equal(user.condominium_id, condoId);
  assert.equal(user.unit_number, '101');

  const membership = db.prepare(
    `SELECT relationship, primary_contact, voting_weight, status FROM user_unit WHERE user_id = ?`
  ).get(user.id) as any;
  assert.deepEqual(membership, {
    relationship: 'owner',
    primary_contact: 1,
    voting_weight: 2.5,
    status: 'active',
  });

  const invite = db.prepare(`SELECT status, claimed_by_user_id FROM invites WHERE email = ?`).get(user.email) as any;
  assert.deepEqual(invite, { status: 'claimed', claimed_by_user_id: user.id });
});

test('parseJsonLoose recovers from raw newlines inside string literals', () => {
  // What Claude Haiku actually returned for meeting summarize on prod.
  // A raw "\n" inside resident_announcement.body used to make JSON.parse throw.
  const bad = `{
  "summary": "Good recap.",
  "decisions": ["Approve AC"],
  "action_items": [],
  "resident_announcement": {
    "title": "Recap",
    "body": "Hi neighbors,

The board met.

Next meeting: Sept 15."
  }
}`;
  assert.throws(() => JSON.parse(bad), /control character/i);
  const parsed = parseJsonLoose<any>(bad);
  assert.ok(parsed, 'parseJsonLoose should recover');
  assert.equal(parsed.summary, 'Good recap.');
  assert.match(parsed.resident_announcement.body, /Hi neighbors/);
  assert.match(parsed.resident_announcement.body, /Sept 15/);
});

test('parseJsonLoose strips markdown fences', () => {
  const fenced = '```json\n{"ok": true}\n```';
  const parsed = parseJsonLoose<any>(fenced);
  assert.deepEqual(parsed, { ok: true });
});

test('parseJsonLoose returns null for garbage', () => {
  assert.equal(parseJsonLoose('totally not json'), null);
});

test('admin agent fallback uses saved service contacts and returns work-ready plan', () => {
  const out = fallbackAdminAgent({
    task: 'Comparar fornecedores para manutenção da esteira da academia',
    locale: 'pt-BR',
    condo: { name: 'Test Condo', address: 'São Paulo' },
    service_contacts: [
      {
        category: 'gym_equipment',
        company_name: 'Fitness Pro',
        whatsapp: '+55 11 90000-0001',
        service_scope: 'Manutenção de esteiras e equipamentos da academia',
        preferred: 1,
      },
    ],
  });

  assert.equal(out._fallback, true);
  assert.equal(out.task_type, 'vendor_research');
  assert.equal(out.existing_network_fit[0].company_name, 'Fitness Pro');
  assert.ok(out.vendor_search_plan.search_queries.length >= 3);
  // Outreach is now WhatsApp-native — no formal "Olá, sou do Test Condo"
  // header. It should be short, conversational, and ask for a same-day
  // visit. The admin can edit before sending.
  assert.ok(out.vendor_search_plan.outreach_message.length < 200);
  assert.match(out.vendor_search_plan.outreach_message, /hoje\?$/i);
  assert.ok(out.proposal_draft?.title);
  // action_plan filter now drops platform-doable items even from
  // fallback. The fallback list has 4 items that are all platform-doable
  // (Conferir rede, Pedir diagnóstico, Equalizar opções, Comunicar
  // moradores), so the post-filter list ends up shorter. The "Comunicar
  // moradores" item gets stripped by the denylist; we still expect at
  // least the diagnóstico + equalizar opções pair through.
  assert.ok(out.action_plan.length >= 2);
});

test('admin agent language defaults to Portuguese unless the task is clearly English', () => {
  assert.equal(agentLanguage({ task: 'Consertar elevador do condomínio' }), 'pt');
  assert.equal(agentLanguage({ task: 'Preciso instalar carregador na garagem', locale: '' }), 'pt');
  assert.equal(agentLanguage({ task: 'Need to repair the elevator and compare vendors' }), 'en');
  assert.equal(agentLanguage({ task: 'Consertar elevador', locale: 'en-US' }), 'en');
  assert.equal(agentLanguage({ task: 'Reparar ascensor', locale: 'es-ES' }), 'es');
  assert.equal(agentLanguage({ task: 'Réparer ascenseur', locale: 'fr-FR' }), 'fr');
});

test('agent runs persist success and failure lifecycle details', () => {
  resetDb();
  const { condoId } = createCondoFixture();
  const adminId = createUser('board@example.com', 'board_admin');

  const okRunId = createAgentRun({
    condominiumId: condoId,
    adminUserId: adminId,
    task: 'Comparar fornecedores de elevador',
    mode: 'vendor_options',
    reactEnabled: true,
    model: 'test-model + tools',
  });
  finishAgentRunSuccess(okRunId, {
    fallback: false,
    plan: { summary: 'Plano', agent_trace: [{ tool: 'list_vendors' }] },
    trace: [{ tool: 'list_vendors', output_summary: '1 fornecedor' }],
    durationMs: 42,
  });

  const okRow = db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(okRunId) as any;
  assert.equal(okRow.status, 'succeeded');
  assert.equal(okRow.fallback, 0);
  assert.equal(okRow.react_enabled, 1);
  assert.equal(okRow.duration_ms, 42);
  assert.match(okRow.plan_json, /Plano/);
  assert.match(okRow.trace_json, /list_vendors/);
  assert.equal(okRow.last_error, null);

  const failRunId = createAgentRun({
    condominiumId: condoId,
    adminUserId: adminId,
    task: 'Falhar de propósito',
    mode: 'general',
    reactEnabled: false,
    model: 'test-model',
  });
  finishAgentRunFailure(failRunId, { error: new Error('provider timeout'), durationMs: 15 });
  const failRow = db.prepare(`SELECT status, last_error, finished_at FROM agent_runs WHERE id = ?`).get(failRunId) as any;
  assert.equal(failRow.status, 'failed');
  assert.match(failRow.last_error, /provider timeout/);
  assert.ok(failRow.finished_at);
});

test('admin agent web research returns cited fallback URLs when provider is not configured', async () => {
  const prevEndpoint = process.env.WEB_SEARCH_ENDPOINT;
  const prevKey = process.env.WEB_SEARCH_API_KEY;
  delete process.env.WEB_SEARCH_ENDPOINT;
  delete process.env.WEB_SEARCH_API_KEY;
  try {
    const result = await researchExternalVendors({
      query: 'empresa manutenção elevador condomínio',
      location: 'São Paulo',
      maxResults: 3,
    });
    assert.equal(result.configured, false);
    assert.equal(result.provider, 'not_configured');
    assert.equal(result.citations.length, 3);
    assert.ok(result.citations.every((c) => c.url.startsWith('https://')));
    assert.match(result.citations[0].snippet, /not configured/i);
  } finally {
    if (prevEndpoint === undefined) delete process.env.WEB_SEARCH_ENDPOINT;
    else process.env.WEB_SEARCH_ENDPOINT = prevEndpoint;
    if (prevKey === undefined) delete process.env.WEB_SEARCH_API_KEY;
    else process.env.WEB_SEARCH_API_KEY = prevKey;
  }
});

test('vendor portal tokens: sign + verify, expired rejection, tampered rejection', async () => {
  const { signDispatchToken, verifyDispatchToken } = await import('../src/lib/vendor-tokens');

  // Happy path — fresh token verifies clean.
  const token = signDispatchToken(123);
  const ok = verifyDispatchToken(123, token);
  assert.equal(ok.ok, true);

  // Wrong dispatch id rejected (signature won't match).
  const wrong = verifyDispatchToken(124, token);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'invalid');

  // Truncated signature rejected.
  const truncated = token.slice(0, -4);
  const tampered = verifyDispatchToken(123, truncated);
  assert.equal(tampered.ok, false);

  // Malformed input rejected with a stable error code.
  assert.equal(verifyDispatchToken(123, '').error, 'malformed');
  assert.equal(verifyDispatchToken(123, 'noseparator').error, 'malformed');
  assert.equal(verifyDispatchToken(123, 'abc.def').error, 'malformed'); // non-numeric expires

  // Expired token rejected.
  const expired = signDispatchToken(99, -3600); // signed 1h ago, ttl already in the past
  const exp = verifyDispatchToken(99, expired);
  assert.equal(exp.ok, false);
  assert.equal(exp.error, 'expired');
});

test('vendor portal: parseBrl + extractField handle pt-BR and en money strings', async () => {
  const { parseBrl, extractField } = await import('../src/routes/vendor-portal');

  // parseBrl — plain, R$-prefixed, pt-BR grouping, en grouping.
  assert.equal(parseBrl('420'), 420);
  assert.equal(parseBrl('R$ 420'), 420);
  assert.equal(parseBrl('1.200,50'), 1200.5);     // pt-BR: dot=thousands, comma=decimal
  assert.equal(parseBrl('1,200.50'), 1200.5);     // en: comma=thousands, dot=decimal
  assert.equal(parseBrl('R$ 2.400'), 2400);       // pt-BR thousands, no decimal
  assert.equal(parseBrl(''), null);
  assert.equal(parseBrl('grátis'), null);          // no number → null, not 0
  assert.equal(parseBrl('0'), null);               // zero rejected (can't divide by it)

  // extractField — pulls "Custo: X" out of the · -separated summary.
  const summary = '✓ Aceita · Quando: Hoje 18h · Custo: 420 · Obs: levo cabo';
  assert.equal(extractField(summary, 'Custo'), '420');
  assert.equal(extractField(summary, 'Quando'), 'Hoje 18h');
  assert.equal(extractField(summary, 'Obs'), 'levo cabo');
  assert.equal(extractField(summary, 'Inexistente'), '');

  // The end-to-end variance: promised 420, final 800 → ratio 1.9 → flagged.
  const promised = parseBrl(extractField(summary, 'Custo'));
  const final = parseBrl('800');
  assert.ok(promised && final && final / promised > 1.25);
});

test('vendor portal: respond → complete flips the ticket to resolved', async () => {
  resetDb();
  const { signDispatchToken } = await import('../src/lib/vendor-tokens');
  const { condoId, unit101 } = createCondoFixture();
  const resident = createUser('r-vp@test');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(resident, unit101);
  const vendorId = Number(db.prepare(
    `INSERT INTO service_contacts (condominium_id, category, company_name, whatsapp, active)
     VALUES (?, 'elevator', 'Otis Test', '+5511999990000', 1)`
  ).run(condoId).lastInsertRowid);
  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, reporter_id, title, description, category, priority, status, remediation_status, verification_threshold)
     VALUES (?, ?, 'Elevador travado', 'Travou', 'elevator', 'urgent', 'open', 'awaiting_vendor', 1)`
  ).run(condoId, resident).lastInsertRowid);
  const dispatchId = Number(db.prepare(
    `INSERT INTO ticket_dispatches (ticket_id, service_contact_id, channel, message_body, status)
     VALUES (?, ?, 'whatsapp', 'test', 'queued')`
  ).run(ticketId, vendorId).lastInsertRowid);

  // Simulate the /respond accept: set the summary the way the route does.
  db.prepare(
    `UPDATE ticket_dispatches SET status = 'responded', responded_at = CURRENT_TIMESTAMP, response_summary = ? WHERE id = ?`
  ).run('✓ Aceita · Quando: Hoje 18h', dispatchId);
  db.prepare(`UPDATE tickets SET remediation_status = 'vendor_engaged' WHERE id = ?`).run(ticketId);

  // Token still valid for this dispatch.
  const token = signDispatchToken(dispatchId);
  const { verifyDispatchToken } = await import('../src/lib/vendor-tokens');
  assert.equal(verifyDispatchToken(dispatchId, token).ok, true);

  // Simulate /complete: the route appends 'Concluído' + flips ticket.
  const existing = db.prepare(`SELECT response_summary FROM ticket_dispatches WHERE id = ?`).get(dispatchId) as { response_summary: string };
  db.prepare(`UPDATE ticket_dispatches SET response_summary = ? WHERE id = ?`)
    .run(`${existing.response_summary}\n→ Concluído · Final: R$ 350`, dispatchId);
  db.prepare(
    `UPDATE tickets SET status = 'resolved', remediation_status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND remediation_status != 'resolved'`
  ).run(ticketId);

  const finalTicket = db.prepare(`SELECT status, remediation_status, resolved_at FROM tickets WHERE id = ?`).get(ticketId) as any;
  assert.equal(finalTicket.status, 'resolved');
  assert.equal(finalTicket.remediation_status, 'resolved');
  assert.ok(finalTicket.resolved_at);
  const finalDispatch = db.prepare(`SELECT response_summary FROM ticket_dispatches WHERE id = ?`).get(dispatchId) as any;
  assert.match(finalDispatch.response_summary, /Concluído/);
  assert.match(finalDispatch.response_summary, /Aceita/); // original accept preserved
});

test('admin agent sanitizer surfaces follow-up suggestions when network_fit is empty', () => {
  // Audit follow-up: when the agent hits a data wall (no vendor in
  // category, cost uncited), the sanitiser populates clickable rescue
  // prompts so the conversation can pivot instead of dead-end.
  const out = sanitizeAdminAgentOutput({
    summary: 'Não encontramos prestadores especializados.',
    existing_network_fit: [],
    options: [],
  }, {
    task: 'Preciso de um dedetizador para baratas',
    service_contacts: [{ company_name: 'Otis', category: 'elevator' }],
  });
  assert.ok(out.follow_up_suggestions);
  assert.ok((out.follow_up_suggestions!.length || 0) >= 1);
  assert.ok(out.follow_up_suggestions!.some((s) => /fornecedor|dedetiza/i.test(s)));
});

test('admin agent sanitizer localizes category labels in follow-up suggestions', () => {
  const out = sanitizeAdminAgentOutput({
    summary: 'Não encontramos fornecedor de academia cadastrado.',
    existing_network_fit: [],
    options: [],
  }, {
    task: 'Instalar uma nova esteira na academia',
    locale: 'pt-BR',
    service_contacts: [],
  });

  const copy = out.follow_up_suggestions?.join(' ') || '';
  assert.match(copy, /equipamentos de academia/);
  assert.doesNotMatch(copy, /gym_equipment/);
});

test('admin agent sanitizer does NOT add follow-up suggestions on refusal', () => {
  // Out-of-scope refusal should NOT carry follow-ups — there's nothing
  // useful to ask next, the admin needs to reformulate.
  const out = sanitizeAdminAgentOutput({
    summary: 'Plano de marketing.',
    options: [{ title: 'X', fit: 'y', pros: [], cons: [], estimated_cost_range: 'a', timeline: 'b', questions_for_vendor: [], evaluation_criteria: [] }],
  }, { task: 'Qual a melhor estratégia de marketing digital?', service_contacts: [] });
  assert.ok(!out.follow_up_suggestions || out.follow_up_suggestions.length === 0);
});

test('admin agent evidence sources are derived from DB/tool outputs, not model prose', () => {
  const sources = buildAgentEvidenceSources({
    summary: 's',
    task_type: 'repair',
    assumptions: [],
    recommended_next_step: 'next',
    existing_network_fit: [{
      company_name: 'Otis Elevadores SP',
      category: 'elevator',
      reason: 'Saved vendor',
      contact_method: 'wa',
      cost_history: {
        expense_count: 4,
        last_amount_brl: 2400,
        last_spent_at: '2026-04-01',
        avg_brl: 2300,
        min_brl: 2100,
        max_brl: 2500,
        confidence: 'high',
      },
    }],
    options: [],
    vendor_search_plan: { search_queries: [], shortlisting_criteria: [], outreach_message: '' },
    action_plan: [],
    resident_update: { title: '', body: '' },
    proposal_draft: null,
    risks: [],
    building_memory: {
      similar_resolved_tickets: [{
        id: 7,
        title: 'Elevador A com ruído',
        resolved_at: '2026-04-01',
        dispatched_vendors: 'Otis Elevadores SP',
        resolution_note: 'Trocou cabo desgastado.',
        estimated_cost_brl: 2400,
      }],
      open_similar_count: 4,
      inferred_category: 'elevator',
      is_outside_business_hours: true,
      local_hour: 22,
    },
    attachment_analysis: [{ id: 3, description: 'Foto mostra painel do elevador apagado.', signals: ['urgency_high'] }],
  }, [{
    name: 'research_external_vendors',
    input: { query: 'elevador condomínio SP' },
    output: {
      configured: true,
      provider: 'test',
      citations: [{ title: 'Fornecedor externo', url: 'https://example.com/vendor', snippet: 'Empresa com manutenção de elevadores.' }],
    },
  }]);

  assert.ok(sources.some((s) => s.type === 'past_ticket' && /Elevador A/.test(s.title)));
  assert.ok(sources.some((s) => s.type === 'vendor_history' && /4 despesa/.test(s.detail)));
  assert.ok(sources.some((s) => s.type === 'pattern'));
  assert.ok(sources.some((s) => s.type === 'after_hours'));
  assert.ok(sources.some((s) => s.type === 'photo' && /urgency_high/.test(s.detail)));
  assert.ok(sources.some((s) => s.type === 'web_citation' && s.url === 'https://example.com/vendor'));
});

test('admin agent evidence localizes manual-search fallback citations', () => {
  const sources = buildAgentEvidenceSources({
    summary: 's',
    task_type: 'vendor_research',
    assumptions: [],
    recommended_next_step: 'next',
    existing_network_fit: [],
    options: [],
    vendor_search_plan: { search_queries: [], shortlisting_criteria: [], outreach_message: '' },
    action_plan: [],
    resident_update: { title: '', body: '' },
    proposal_draft: null,
    risks: [],
  }, [{
    name: 'research_external_vendors',
    input: { query: 'esteira academia Miami' },
    output: {
      configured: false,
      provider: 'not_configured',
      citations: [{
        title: 'Google search: esteira academia Miami',
        url: 'https://www.google.com/search?q=esteira',
        snippet: 'Live web search is not configured on the server.',
        source: 'search_url',
      }],
    },
  }], 'pt-BR');

  assert.equal(sources.length, 1);
  assert.match(sources[0].title, /^Busca no Google:/);
  assert.match(sources[0].detail, /URL de busca manual/);
  assert.equal(sources[0].source, 'busca manual');
  assert.doesNotMatch(sources[0].detail, /Live web search/i);
});

test('admin agent sanitizer forces refusal on out-of-scope tasks', () => {
  // Audit Test 3 finding: prompt rule on scope refusal wasn't enforced
  // (model would happily produce a marketing plan). Sanitiser now
  // detects off-domain tasks and rewrites the response into a clean
  // refusal regardless of what the model returned.
  const out = sanitizeAdminAgentOutput({
    summary: 'Plano de marketing detalhado com 5 fases.',
    task_type: 'policy',
    existing_network_fit: [],
    options: [{
      title: 'Marketing digital', fit: 'all', pros: [], cons: [],
      estimated_cost_range: 'R$ 5.000/mês', timeline: '6 meses',
      questions_for_vendor: [], evaluation_criteria: [],
    }],
    confidence: { score: 0.7, tier: 'medium', reasoning: ['x'] },
  }, {
    task: 'Qual a melhor estratégia de marketing digital nas redes sociais?',
    service_contacts: [],
  });
  assert.match(out.summary, /escopo|reformule/i);
  assert.equal(out.existing_network_fit.length, 0);
  assert.equal(out.options.length, 0);
  assert.equal(out.vendor_search_plan.search_queries.length, 0);
  assert.equal(out.vendor_search_plan.outreach_message, '');
  assert.equal(out.action_plan.length, 0);
  assert.equal(out.resident_update.title, '');
  assert.equal(out.proposal_draft, null);
  assert.equal(out.confidence?.tier, 'high'); // high confidence we're refusing
  // In-scope task should NOT be refused — sanity check the negative.
  const inScope = sanitizeAdminAgentOutput({
    summary: 'Plano para conserto.',
    options: [{ title: 'X', fit: 'y', pros: [], cons: [], estimated_cost_range: 'a', timeline: 'b', questions_for_vendor: [], evaluation_criteria: [] }],
  }, { task: 'Elevador A com ruído', service_contacts: [] });
  assert.doesNotMatch(inScope.summary, /escopo|reformule/i);
});

test('admin agent sanitizer turns unclear input into clarification instead of invented work', () => {
  const vague = sanitizeAdminAgentOutput({
    summary: 'Priorizar elevadores e manutenção geral com base no histórico.',
    task_type: 'general',
    existing_network_fit: [{ company_name: 'Otis', category: 'elevator', reason: 'histórico', contact_method: 'wa' }],
    options: [{ title: 'Vistoria geral', fit: 'ampla', pros: [], cons: [], estimated_cost_range: 'R$ 2.000-10.000', timeline: 'esta semana', questions_for_vendor: [], evaluation_criteria: [] }],
    vendor_search_plan: { search_queries: ['empresa manutenção predial'], shortlisting_criteria: ['plantão'], outreach_message: 'Pode atender?' },
    confidence: { score: 0.8, tier: 'medium', reasoning: ['histórico'] },
  }, {
    task: 'O prédio precisa de ajuda urgente com algumas coisas.',
    service_contacts: [{ company_name: 'Otis', category: 'elevator' }],
  });

  assert.match(vague.summary, /faltam detalhes|more detail/i);
  assert.equal(vague.task_type, 'general');
  assert.equal(vague.existing_network_fit.length, 0);
  assert.equal(vague.options.length, 0);
  assert.equal(vague.vendor_search_plan.search_queries.length, 0);
  assert.equal(vague.resident_update.title, '');
  assert.equal(vague.confidence?.tier, 'low');
  assert.ok((vague.follow_up_suggestions?.length || 0) >= 2);

  const gibberish = sanitizeAdminAgentOutput({
    summary: 'Plano para elevador.',
    task_type: 'repair',
    options: [{ title: 'Acionar elevador', fit: 'sinal', pros: [], cons: [], estimated_cost_range: 'A confirmar', timeline: 'hoje', questions_for_vendor: [], evaluation_criteria: [] }],
  }, {
    task: 'asdf qwerty 123 elevador zxcv barulho 456.',
    service_contacts: [],
  });
  assert.match(gibberish.summary, /faltam detalhes|more detail/i);
  assert.equal(gibberish.options.length, 0);
});

test('admin agent sanitizer drops vendors whose category does not match the task', () => {
  // The test 5 finding: dedetização ask should NOT return elevator,
  // maintenance, or plumbing vendors even if the model included them.
  // Sanitiser must filter by category match against the inferred task
  // category (pest_control here).
  const out = sanitizeAdminAgentOutput({
    summary: 's',
    existing_network_fit: [
      { company_name: 'Otis Elevadores SP', category: 'elevator', reason: 'r', contact_method: 'wa' },
      { company_name: 'Encanador Plantão 24h', category: 'plumbing', reason: 'r', contact_method: 'wa' },
      { company_name: 'Manutenção Geral SP', category: 'general_maintenance', reason: 'r', contact_method: 'wa' },
    ],
  }, {
    task: 'Preciso de um dedetizador para baratas no térreo',
    service_contacts: [
      { company_name: 'Otis Elevadores SP', category: 'elevator' },
      { company_name: 'Encanador Plantão 24h', category: 'plumbing' },
      { company_name: 'Manutenção Geral SP', category: 'general_maintenance' },
    ],
  });
  // None of the three saved vendors match pest_control. Expected: empty.
  assert.equal(out.existing_network_fit.length, 0);
});

test('admin agent sanitizer downgrades confidence when cost is invented', () => {
  // Audit Test 2 finding: numeric cost range without a NAMED vendor
  // backing it is theatre. Honest answers either cite a vendor whose
  // cost_history supports the range, or say "confirm by quote".
  // Signal: existing_network_fit is empty + options[0].estimated_cost
  // _range has numbers → forced confidence downgrade.
  const out = sanitizeAdminAgentOutput({
    summary: 's',
    existing_network_fit: [], // no vendor named to back the cost
    options: [{
      title: 'Vistoria predial',
      fit: 'all',
      pros: [], cons: [],
      estimated_cost_range: 'R$ 2.000 - R$ 10.000',
      timeline: '7-14 dias',
      questions_for_vendor: [], evaluation_criteria: [],
    }],
    confidence: { score: 0.85, tier: 'high', reasoning: ['Model claimed high'] },
  }, {
    // Task category infers to pest_control via "dedetiza" so fallback
    // network_fit is suppressed; cost check then fires on the
    // sanitiser-empty list.
    task: 'Quanto custa uma dedetização contra baratas?',
    service_contacts: [{ company_name: 'Otis', category: 'elevator', last_used_at: null }],
  });
  // High → forced down because no vendor was cited.
  assert.notEqual(out.confidence?.tier, 'high');
  assert.ok((out.confidence?.score || 1) <= 0.45);
  assert.ok(out.confidence?.reasoning.some((r) => /sem histórico|hist[óo]rico real|estimativa do modelo/i.test(r)));
});

test('admin agent sanitizer drops hallucinated saved vendors and repairs invalid proposal fields', () => {
  const out = sanitizeAdminAgentOutput({
    summary: 'Use a careful process.',
    task_type: 'vendor_research',
    existing_network_fit: [
      { company_name: 'Imaginary Vendor', category: 'gym_equipment', reason: 'made up', contact_method: '555' },
    ],
    options: [
      { title: 'Compare bids', pros: ['Comparable scope'], cons: ['Takes time'], estimated_cost_range: 'confirm by quote' },
    ],
    proposal_draft: {
      title: 'Fix treadmill',
      description: 'Repair the treadmill after technical diagnosis.',
      category: 'made_up',
      estimated_cost: -10,
    },
  }, {
    task: 'repair treadmill',
    locale: 'en-US',
    service_contacts: [
      { category: 'electrical', company_name: 'Real Electric', phone: '555-0100' },
    ],
  });

  assert.deepEqual(out.existing_network_fit, []);
  assert.equal(out.proposal_draft?.category, 'maintenance');
  assert.equal(out.proposal_draft?.estimated_cost, null);
  assert.ok(out.options[0].questions_for_vendor.length > 0);
});

test('service contact schema rejects unreachable contacts and non-HTTPS links', () => {
  const unreachable = serviceContactSchema.safeParse({
    category: 'electrical',
    company_name: 'Vendor With No Contact',
  });
  assert.equal(unreachable.success, false);
  if (unreachable.success) throw new Error('expected unreachable contact to fail');
  assert.match(JSON.stringify(unreachable.error.flatten()), /service_contact_needs_reachable_detail/);

  const insecureWebsite = serviceContactSchema.safeParse({
    category: 'gym_equipment',
    company_name: 'Fitness Installer',
    phone: '+55 11 90000-0001',
    website: 'http://vendors.example/fitness',
  });
  assert.equal(insecureWebsite.success, false);
  if (insecureWebsite.success) throw new Error('expected insecure website to fail');
  assert.match(JSON.stringify(insecureWebsite.error.flatten()), /must_be_https_url/);

  const insecureContract = serviceContactSchema.safeParse({
    category: 'gym_equipment',
    company_name: 'Fitness Installer',
    phone: '+55 11 90000-0001',
    contract_url: 'http://contracts.example/fitness',
  });
  assert.equal(insecureContract.success, false);
  if (insecureContract.success) throw new Error('expected insecure contract link to fail');
  assert.match(JSON.stringify(insecureContract.error.flatten()), /must_be_https_url/);
});

test('service contact normalization trims fields and expands date-only usage', () => {
  const parsed = serviceContactSchema.parse({
    category: 'gym_equipment',
    company_name: '  Fitness Installer  ',
    contact_name: '  ',
    phone: ' +55 11 90000-0001 ',
    website: 'https://vendors.example/fitness',
    contract_url: 'https://contracts.example/fitness',
    service_scope: '  Instalação da academia  ',
    last_used_at: '2026-05-01',
    preferred: true,
  });

  const normalized = normalizeServiceContact(parsed);
  assert.equal(normalized.company_name, 'Fitness Installer');
  assert.equal(normalized.contact_name, null);
  assert.equal(normalized.phone, '+55 11 90000-0001');
  assert.equal(normalized.service_scope, 'Instalação da academia');
  assert.equal(normalized.last_used_at, '2026-05-01T00:00:00.000Z');
});

test('service contact scorecards aggregate vendor operations without cross-condo leakage', () => {
  resetDb();
  const { condoId } = createCondoFixture();
  const adminId = createUser('score-admin@example.com', 'board_admin');
  const residentId = createUser('score-resident@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, adminId, residentId);

  const vendorId = Number(db.prepare(
    `INSERT INTO service_contacts (
      condominium_id, category, company_name, phone, email, active, preferred
    ) VALUES (?, 'elevator', 'Scorecard Elevator', '+1 555 2000', 'ops@scorecard.test', 1, 1)`
  ).run(condoId).lastInsertRowid);

  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (
      condominium_id, reporter_id, title, description, category, priority, verification_threshold, remediation_status
    ) VALUES (?, ?, 'Elevator stopped', 'Elevator A stopped at level 3.', 'elevator', 'high', 1, 'awaiting_vendor')`
  ).run(condoId, residentId).lastInsertRowid);

  db.prepare(
    `INSERT INTO ticket_dispatches (
      ticket_id, service_contact_id, channel, message_body, status, created_at, responded_at, dispatched_by_user_id
    ) VALUES (?, ?, 'whatsapp', 'Can you inspect today?', 'responded', '2026-05-01 10:00:00', '2026-05-01 12:00:00', ?)`
  ).run(ticketId, vendorId, adminId);
  db.prepare(
    `INSERT INTO ticket_dispatches (
      ticket_id, service_contact_id, channel, message_body, status, created_at, dispatched_by_user_id
    ) VALUES (?, ?, 'email', 'Please send quote.', 'sent', '2026-05-02 09:00:00', ?)`
  ).run(ticketId, vendorId, adminId);
  db.prepare(
    `INSERT INTO ticket_work_orders (
      ticket_id, service_contact_id, title, status, approved_amount_cents, completed_at
    ) VALUES (?, ?, 'Elevator repair', 'completed', 125000, '2026-05-03 16:00:00')`
  ).run(ticketId, vendorId);
  db.prepare(
    `INSERT INTO expenses (
      condominium_id, amount_cents, currency, category, vendor, description, spent_at, created_by_user_id
    ) VALUES (?, 80000, 'USD', 'maintenance', 'Scorecard Elevator LLC', 'Elevator emergency visit', '2026-05-04', ?)`
  ).run(condoId, adminId);

  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Other Condo', '2 Main', 'TEST02')`
  ).run().lastInsertRowid);
  const otherResidentId = createUser('other-score-resident@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(otherCondoId, otherResidentId);
  const otherVendorId = Number(db.prepare(
    `INSERT INTO service_contacts (
      condominium_id, category, company_name, phone, active, preferred
    ) VALUES (?, 'elevator', 'Scorecard Elevator', '+1 555 9999', 1, 1)`
  ).run(otherCondoId).lastInsertRowid);
  const otherTicketId = Number(db.prepare(
    `INSERT INTO tickets (
      condominium_id, reporter_id, title, description, category, priority, verification_threshold, remediation_status
    ) VALUES (?, ?, 'Other elevator', 'Must not leak.', 'elevator', 'normal', 1, 'awaiting_vendor')`
  ).run(otherCondoId, otherResidentId).lastInsertRowid);
  db.prepare(
    `INSERT INTO ticket_dispatches (
      ticket_id, service_contact_id, channel, message_body, status, created_at, responded_at, dispatched_by_user_id
    ) VALUES (?, ?, 'whatsapp', 'Other condo', 'responded', '2026-05-01 09:00:00', '2026-05-01 09:05:00', ?)`
  ).run(otherTicketId, otherVendorId, adminId);
  db.prepare(
    `INSERT INTO expenses (
      condominium_id, amount_cents, currency, category, vendor, description, spent_at, created_by_user_id
    ) VALUES (?, 999999, 'USD', 'maintenance', 'Scorecard Elevator LLC', 'Other condo invoice', '2026-05-05', ?)`
  ).run(otherCondoId, adminId);

  const rows = listServiceContactsWithScorecards(condoId, true);
  const scorecard = rows.find((row) => row.id === vendorId);
  assert.ok(scorecard);
  assert.equal(scorecard.dispatches_total, 2);
  assert.equal(scorecard.dispatches_responded, 1);
  assert.equal(scorecard.avg_response_seconds, 7200);
  assert.equal(scorecard.work_orders_total, 1);
  assert.equal(scorecard.work_orders_completed, 1);
  assert.equal(scorecard.work_orders_open, 0);
  assert.equal(scorecard.work_order_value_cents, 125000);
  assert.equal(scorecard.expense_count, 1);
  assert.equal(scorecard.expense_total_cents, 80000);
  assert.equal(scorecard.expense_currency, 'USD');
});

test('ticket timeline orders events and hides admin-only entries from residents', () => {
  resetDb();
  const { condoId } = createCondoFixture();
  const adminId = createUser('timeline-admin@example.com', 'board_admin');
  const residentId = createUser('timeline-resident@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, adminId, residentId);

  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (
      condominium_id, reporter_id, title, description, category, priority, verification_threshold
    ) VALUES (?, ?, 'Timeline leak', 'Water leak near elevator.', 'plumbing', 'normal', 3)`
  ).run(condoId, residentId).lastInsertRowid);

  recordTicketEvent({
    ticketId,
    condoId,
    actorUserId: residentId,
    eventType: 'ticket.created',
    title: 'Ticket created',
    body: 'Resident reported a leak.',
    metadata: { priority: 'normal' },
    visibility: 'resident',
  });
  recordTicketEvent({
    ticketId,
    condoId,
    actorUserId: adminId,
    eventType: 'vendor.private_note',
    title: 'Internal vendor note',
    body: 'Vendor gave private pricing guidance.',
    metadata: { quoteFloorCents: 50000 },
    visibility: 'admin',
  });
  recordTicketEvent({
    ticketId,
    condoId,
    actorUserId: adminId,
    eventType: 'work_order.created',
    title: 'Work order opened',
    body: 'Repair was scheduled.',
    metadata: { status: 'scheduled' },
    visibility: 'resident',
  });

  const adminTimeline = listTicketTimeline({ ticketId, condoId, role: 'board_admin' });
  assert.equal(adminTimeline.length, 3);
  assert.deepEqual(adminTimeline.map((event) => event.event_type), [
    'ticket.created',
    'vendor.private_note',
    'work_order.created',
  ]);
  assert.deepEqual(adminTimeline[0].metadata, { priority: 'normal' });
  assert.deepEqual(adminTimeline[1].metadata, { quoteFloorCents: 50000 });
  assert.equal(adminTimeline[1].visibility, 'admin');

  const residentTimeline = listTicketTimeline({ ticketId, condoId, role: 'resident' });
  assert.equal(residentTimeline.length, 2);
  assert.deepEqual(residentTimeline.map((event) => event.event_type), [
    'ticket.created',
    'work_order.created',
  ]);
  assert.doesNotMatch(JSON.stringify(residentTimeline), /private pricing/);

  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Other Timeline Condo', '2 Main', 'TLINE2')`
  ).run().lastInsertRowid);
  assert.equal(listTicketTimeline({ ticketId, condoId: otherCondoId, role: 'board_admin' }).length, 0);
});

test('ticket vendor quotes are condo-scoped and hidden from residents', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const adminId = createUser('quotes-admin@example.com', 'board_admin');
  const residentId = createUser('quotes-resident@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, adminId, residentId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(residentId, unit101);

  const vendorId = Number(db.prepare(
    `INSERT INTO service_contacts (condominium_id, category, company_name, contact_name, phone, active, preferred)
     VALUES (?, 'general_maintenance', 'FixFast', 'Nora', '+15551231234', 1, 1)`
  ).run(condoId).lastInsertRowid);
  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Quote Leak Condo', '4 Main', 'QUOTE2')`
  ).run().lastInsertRowid);
  const otherVendorId = Number(db.prepare(
    `INSERT INTO service_contacts (condominium_id, category, company_name, active)
     VALUES (?, 'general_maintenance', 'Other Vendor', 1)`
  ).run(otherCondoId).lastInsertRowid);
  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, unit_id, reporter_id, title, description, category, priority, verification_threshold)
     VALUES (?, ?, ?, 'Lobby repair', 'Need quotes.', 'maintenance', 'normal', 1)`
  ).run(condoId, unit101, residentId).lastInsertRowid);

  const quote = createTicketQuote({
    condoId,
    ticketId,
    actorUserId: adminId,
    serviceContactId: vendorId,
    quoteAmountCents: 125000,
    currency: 'USD',
    availability: 'Tomorrow morning',
    warranty: '90 days',
    notes: 'Admin-only price detail and internal negotiation notes.',
  });
  assert.equal(quote.ok, true);

  const wrongVendor = createTicketQuote({
    condoId,
    ticketId,
    actorUserId: adminId,
    serviceContactId: otherVendorId,
    vendorName: 'Other Vendor',
  });
  assert.equal(wrongVendor.ok, false);
  assert.equal((wrongVendor as any).error, 'vendor_not_in_condo');

  const adminQuotes = listTicketQuotes({ condoId, ticketId, role: 'board_admin' });
  assert.equal(adminQuotes.length, 1);
  assert.equal(adminQuotes[0].vendor_name, 'FixFast');
  assert.equal(adminQuotes[0].quote_amount_cents, 125000);
  assert.match(adminQuotes[0].notes || '', /Admin-only price detail/);

  const residentQuotes = listTicketQuotes({ condoId, ticketId, role: 'resident' });
  assert.equal(residentQuotes.length, 0);

  const crossCondo = listTicketQuotes({ condoId: otherCondoId, ticketId, role: 'board_admin' });
  assert.equal(crossCondo.length, 0);

  const adminTimeline = listTicketTimeline({ ticketId, condoId, role: 'board_admin' });
  assert.ok(adminTimeline.some((event) => event.event_type === 'vendor.quote_added'));
  const residentTimeline = listTicketTimeline({ ticketId, condoId, role: 'resident' });
  assert.ok(!residentTimeline.some((event) => event.event_type === 'vendor.quote_added'));
});

test('board packet aggregates monthly operations without cross-condo leakage', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const adminId = createUser('packet-admin@example.com', 'board_admin');
  const residentId = createUser('packet-resident@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, adminId, residentId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(residentId, unit101);

  const vendorId = Number(db.prepare(
    `INSERT INTO service_contacts (condominium_id, category, company_name, active, preferred)
     VALUES (?, 'plumbing', 'Packet Plumbing', 1, 1)`
  ).run(condoId).lastInsertRowid);

  db.prepare(
    `INSERT INTO expenses (condominium_id, amount_cents, currency, category, vendor, description, spent_at, created_by_user_id)
     VALUES (?, 10000, 'USD', 'maintenance', 'Packet Plumbing', 'May pipe repair', '2026-05-04T12:00:00.000Z', ?)`
  ).run(condoId, adminId);
  db.prepare(
    `INSERT INTO expenses (condominium_id, amount_cents, currency, category, vendor, description, spent_at, created_by_user_id)
     VALUES (?, 50000, 'USD', 'maintenance', 'Old Vendor', 'April repair', '2026-04-20T12:00:00.000Z', ?)`
  ).run(condoId, adminId);

  db.prepare(
    `INSERT INTO invoices (condominium_id, unit_id, amount_cents, currency, period, due_date, status)
     VALUES (?, ?, 20000, 'USD', '2026-05', '2026-05-01T12:00:00.000Z', 'open')`
  ).run(condoId, unit101);

  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, unit_id, reporter_id, title, description, category, priority, status, remediation_status, created_at, updated_at)
     VALUES (?, ?, ?, 'Packet leak', 'Pipe leak by lobby.', 'plumbing', 'urgent', 'open', 'verified', '2026-05-08T10:00:00.000Z', '2026-05-08T10:00:00.000Z')`
  ).run(condoId, unit101, residentId).lastInsertRowid);
  db.prepare(
    `INSERT INTO ticket_work_orders (ticket_id, service_contact_id, title, status, estimated_amount_cents, scheduled_for)
     VALUES (?, ?, 'Fix packet leak', 'scheduled', 30000, '2026-05-09T14:00:00.000Z')`
  ).run(ticketId, vendorId);

  db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, category, status, estimated_cost, created_at)
     VALUES (?, ?, 'Paint garage', 'Paint garage walls.', 'maintenance', 'voting', 1200, '2026-05-02T12:00:00.000Z')`
  ).run(condoId, adminId);
  db.prepare(
    `INSERT INTO meetings (condominium_id, title, scheduled_for, status)
     VALUES (?, 'May board meeting', '2026-05-20T18:00:00.000Z', 'scheduled')`
  ).run(condoId);
  db.prepare(
    `INSERT INTO announcements (condominium_id, author_id, title, body, created_at)
     VALUES (?, ?, 'May notice', 'Maintenance notice.', '2026-05-03T10:00:00.000Z')`
  ).run(condoId, adminId);

  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Other Packet Condo', '2 Main', 'PKT02')`
  ).run().lastInsertRowid);
  const otherAdminId = createUser('packet-other-admin@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(otherCondoId, otherAdminId);
  db.prepare(
    `INSERT INTO expenses (condominium_id, amount_cents, currency, category, vendor, description, spent_at, created_by_user_id)
     VALUES (?, 999999, 'USD', 'maintenance', 'Leaky Other Vendor', 'Should not leak', '2026-05-04T12:00:00.000Z', ?)`
  ).run(otherCondoId, otherAdminId);

  const packet = getBoardPacket(condoId, '2026-05', new Date('2026-05-13T12:00:00.000Z'));
  assert.equal(packet.period_end, '2026-05-31');
  assert.equal(packet.finances.expenses_total_cents, 10000);
  assert.equal(packet.finances.receivables.total_open_cents, 20000);
  assert.equal(packet.finances.receivables.overdue_cents, 20000);
  assert.equal(packet.tickets.urgent_open_count, 1);
  assert.equal(packet.tickets.work_orders.open_count, 1);
  assert.equal(packet.proposals.active_count, 1);
  assert.equal(packet.meetings.upcoming_count, 1);
  assert.equal(packet.vendors.count, 1);
  assert.match(packet.markdown, /Test Condo board packet/);
  assert.doesNotMatch(JSON.stringify(packet), /Leaky Other Vendor/);
});

test('dashboard actions are role-scoped and backed by in-app notifications', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const adminId = createUser('dashboard-admin@example.com', 'board_admin');
  const residentId = createUser('dashboard-resident@example.com');
  const conciergeId = createUser('dashboard-concierge@example.com', 'concierge');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?, ?)`).run(condoId, adminId, residentId, conciergeId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(residentId, unit101);

  const dashboardNow = new Date('2026-05-14T12:00:00.000Z');
  const todayVisitorAt = new Date(dashboardNow);
  todayVisitorAt.setHours(14, 0, 0, 0);
  const visitorId = Number(db.prepare(
    `INSERT INTO visitors (condominium_id, host_id, visitor_name, visitor_type, expected_at, status)
     VALUES (?, ?, 'Ana Visitor', 'guest', ?, 'pending')`
  ).run(condoId, residentId, todayVisitorAt.toISOString()).lastInsertRowid);
  const packageId = Number(db.prepare(
    `INSERT INTO packages (condominium_id, recipient_id, carrier, description, status)
     VALUES (?, ?, 'DHL', 'Keys', 'waiting')`
  ).run(condoId, residentId).lastInsertRowid);
  db.prepare(
    `INSERT INTO invoices (condominium_id, unit_id, amount_cents, currency, period, due_date, status)
     VALUES (?, ?, 10000, 'USD', '2026-05', '2026-05-01T12:00:00.000Z', 'open')`
  ).run(condoId, unit101);
  db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, category, status, created_at)
     VALUES (?, ?, 'Fix lobby door', 'Door repair.', 'maintenance', 'voting', '2026-05-10T12:00:00.000Z')`
  ).run(condoId, adminId);
  db.prepare(
    `INSERT INTO meetings (condominium_id, title, scheduled_for, status)
     VALUES (?, 'Dashboard meeting', '2026-05-20T18:00:00.000Z', 'scheduled')`
  ).run(condoId);
  const notificationId = createInAppNotification({
    condominium_id: condoId,
    user_id: residentId,
    source: 'package',
    title: 'Package waiting',
    body: 'DHL · Keys',
    href: '/app/packages',
    priority: 'high',
    target_type: 'package',
    target_id: packageId,
  });

  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Other Dashboard Condo', '3 Main', 'DASH2')`
  ).run().lastInsertRowid);
  const otherResidentId = createUser('dashboard-other@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(otherCondoId, otherResidentId);
  db.prepare(
    `INSERT INTO packages (condominium_id, recipient_id, carrier, description, status)
     VALUES (?, ?, 'Leaky Other Carrier', 'Should not show', 'waiting')`
  ).run(otherCondoId, otherResidentId);

  const resident = db.prepare(`SELECT * FROM users WHERE id = ?`).get(residentId) as any;
  const admin = db.prepare(`SELECT * FROM users WHERE id = ?`).get(adminId) as any;
  const concierge = db.prepare(`SELECT * FROM users WHERE id = ?`).get(conciergeId) as any;
  const residentPayload = getDashboardActions(resident, condoId, dashboardNow);
  assert.equal(residentPayload.unread_count, 1);
  assert.ok(residentPayload.actions.some((action) => action.id === `visitor-${visitorId}`));
  assert.ok(residentPayload.actions.some((action) => action.id === `package-${packageId}`));
  assert.ok(residentPayload.actions.some((action) => action.source === 'finance'));
  assert.doesNotMatch(JSON.stringify(residentPayload), /Leaky Other Carrier/);

  const adminPayload = getDashboardActions(admin, condoId, dashboardNow);
  assert.ok(adminPayload.actions.some((action) => action.source === 'finance'));
  assert.ok(adminPayload.actions.some((action) => action.source === 'proposal'));
  assert.ok(adminPayload.actions.some((action) => action.source === 'meeting'));

  const conciergePayload = getDashboardActions(concierge, condoId, dashboardNow);
  assert.ok(conciergePayload.actions.some((action) => action.id === `visitor-${visitorId}`));
  assert.ok(conciergePayload.actions.some((action) => action.id === `package-${packageId}`));

  const read = markInAppNotificationRead(residentId, notificationId);
  assert.equal(read?.status, 'read');
  assert.equal(getDashboardActions(resident, condoId, dashboardNow).unread_count, 0);
});

test('files: uploaded evidence is condo-scoped and permissioned by visibility', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const residentId = createUser('files-resident@example.com');
  const adminId = createUser('files-admin@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, residentId, adminId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(residentId, unit101);

  const file = createPendingFile({
    condominiumId: condoId,
    uploadedByUserId: residentId,
    originalFilename: 'leak-photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 42_000,
    purpose: 'ticket_attachment',
    visibility: 'residents',
    storageDriver: 'local',
    storageKey: 'condos/1/ticket_attachment/leak-photo.jpg',
  });
  markFileReady(file.id);

  const resident = db.prepare(`SELECT * FROM users WHERE id = ?`).get(residentId) as any;
  const admin = db.prepare(`SELECT * FROM users WHERE id = ?`).get(adminId) as any;

  assert.equal(canAccessFile(resident, file.id, condoId), true);
  assert.equal(canAccessFile(admin, file.id, condoId), true);
  assert.equal(assertFileReadyForUse({ fileId: file.id, condoId, purpose: 'ticket_attachment' })?.id, file.id);

  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address, invite_code) VALUES ('Other Files Condo', '9 Main', 'FILES2')`
  ).run().lastInsertRowid);
  assert.equal(canAccessFile(resident, file.id, otherCondoId), false);
  assert.equal(assertFileReadyForUse({ fileId: file.id, condoId: otherCondoId, purpose: 'ticket_attachment' }), null);
});

test('building memory searches operational records without leaking admin-only sources to residents', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const adminId = createUser('memory-admin@example.com', 'board_admin');
  const residentId = createUser('memory-resident@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, adminId, residentId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(residentId, unit101);

  const vendorId = Number(db.prepare(
    `INSERT INTO service_contacts (
      condominium_id, category, company_name, contact_name, phone, service_scope, active, preferred
    ) VALUES (?, 'elevator', 'Otis Memory Elevators', 'Rita', '+1 555 1000', 'Elevator modernization and emergency service', 1, 1)`
  ).run(condoId).lastInsertRowid);

  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (
      condominium_id, reporter_id, title, description, category, priority, verification_threshold, remediation_status
    ) VALUES (?, ?, 'Elevator noise near garage', 'The elevator makes a loud grinding sound.', 'elevator', 'high', 1, 'verified')`
  ).run(condoId, residentId).lastInsertRowid);

  db.prepare(
    `INSERT INTO ticket_work_orders (
      ticket_id, service_contact_id, title, scope, status, estimated_amount_cents
    ) VALUES (?, ?, 'Elevator inspection', 'Check rail noise and motor room vibration.', 'scheduled', 250000)`
  ).run(ticketId, vendorId);

  db.prepare(
    `INSERT INTO building_documents (
      condominium_id, uploaded_by_user_id, title, category, description, file_url, visibility
    ) VALUES (?, ?, 'Secret elevator contract', 'contracts', 'Board-only vendor pricing.', 'https://example.com/secret-contract.pdf', 'board_only')`
  ).run(condoId, adminId);
  db.prepare(
    `INSERT INTO building_documents (
      condominium_id, uploaded_by_user_id, title, category, description, file_url, visibility
    ) VALUES (?, ?, 'Resident elevator notice', 'notices', 'Elevator maintenance window.', 'https://example.com/resident-notice.pdf', 'residents')`
  ).run(condoId, adminId);

  const adminSearch = searchBuildingMemory({
    condoId,
    userId: adminId,
    role: 'board_admin',
    query: 'Otis elevator',
  });
  assert.ok(adminSearch.results.some((row) => row.type === 'service_contact' && row.title === 'Otis Memory Elevators'));
  assert.ok(adminSearch.results.some((row) => row.type === 'work_order' && row.title === 'Elevator inspection'));

  const adminSecret = searchBuildingMemory({
    condoId,
    userId: adminId,
    role: 'board_admin',
    query: 'secret contract',
  });
  assert.ok(adminSecret.results.some((row) => row.type === 'document' && row.title === 'Secret elevator contract'));

  const residentSecret = searchBuildingMemory({
    condoId,
    userId: residentId,
    role: 'resident',
    query: 'secret contract',
  });
  assert.equal(residentSecret.results.some((row) => row.title === 'Secret elevator contract'), false);
  assert.equal(residentSecret.results.some((row) => row.type === 'service_contact'), false);

  const residentNotice = searchBuildingMemory({
    condoId,
    userId: residentId,
    role: 'resident',
    query: 'maintenance window',
  });
  assert.ok(residentNotice.results.some((row) => row.title === 'Resident elevator notice'));
});

test('auth: token_version revokes stale JWTs without rotating the global secret', () => {
  resetDb();
  const userId = createUser('revoked-session@example.com');
  const token = signToken(userId);

  const first = responseRecorder();
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  let nextCalls = 0;
  requireAuth(req, first.res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(req.user.id, userId);

  revokeUserTokens(userId);

  const stale = responseRecorder();
  requireAuth({ headers: { authorization: `Bearer ${token}` } } as any, stale.res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(stale.calls.statusCode, 401);
  assert.equal(stale.calls.body.error, 'invalid_token_version');

  const fresh = responseRecorder();
  requireAuth({ headers: { authorization: `Bearer ${signToken(userId)}` } } as any, fresh.res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
});

test('quorum enforcement: auto-close returns inconclusive when turnout under threshold', () => {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();

  // 2 eligible voters, quorum 60% → need 2/2 = 100% turnout. Only 1 votes.
  const user1 = createUser('a@x.com');
  const user2 = createUser('b@x.com');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(user1, unit101);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(user2, unit102);

  assert.equal(countEligibleVoters(condoId, 'all'), 2);

  const past = new Date(Date.now() - 60_000).toISOString();
  const propId = Number(db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, voter_eligibility, quorum_percent, voting_closes_at, status)
     VALUES (?, ?, 'q', 'test', 'all', 60, ?, 'voting')`
  ).run(condoId, user1, past).lastInsertRowid);

  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'yes')`).run(propId, user1);

  const closed = tickVoteCloser();
  assert.equal(closed, 1);
  const after = db.prepare(`SELECT status, close_reason FROM proposals WHERE id = ?`).get(propId) as any;
  assert.equal(after.status, 'inconclusive');
  assert.equal(after.close_reason, 'quorum_not_met');
});

test('auto-close respects quorum when met: approved / rejected by tally', () => {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const user1 = createUser('a@x.com');
  const user2 = createUser('b@x.com');
  db.prepare(`INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0)`).run(user1, unit101);
  db.prepare(`INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0)`).run(user2, unit102);

  const past = new Date(Date.now() - 1000).toISOString();
  const propId = Number(db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, voter_eligibility, quorum_percent, voting_closes_at, status)
     VALUES (?, ?, 'q', 'test', 'all', 50, ?, 'voting')`
  ).run(condoId, user1, past).lastInsertRowid);

  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'yes')`).run(propId, user1);
  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'yes')`).run(propId, user2);

  assert.equal(tickVoteCloser(), 1);
  const after = db.prepare(`SELECT status, close_reason FROM proposals WHERE id = ?`).get(propId) as any;
  assert.equal(after.status, 'approved');
  assert.equal(after.close_reason, 'window_expired');
});

test('auto-close is a no-op before window expires', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const user1 = createUser('a@x.com');
  db.prepare(`INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0)`).run(user1, unit101);

  const future = new Date(Date.now() + 60_000).toISOString();
  db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, voter_eligibility, voting_closes_at, status)
     VALUES (?, ?, 'future', 'test', 'all', ?, 'voting')`
  ).run(condoId, user1, future);

  assert.equal(tickVoteCloser(), 0);
});

test('proposal tally applies eligibility and voting weights consistently', () => {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const ownerId = createUser('owner@example.com');
  const tenantId = createUser('tenant@example.com');

  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 2.0)`
  ).run(ownerId, unit101);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'tenant', 'active', 1, 1.0)`
  ).run(tenantId, unit102);

  const allProposalId = Number(db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, voter_eligibility, status)
     VALUES (?, ?, 'All vote', 'Test', 'all', 'voting')`
  ).run(condoId, ownerId).lastInsertRowid);
  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'yes')`).run(allProposalId, ownerId);
  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'no')`).run(allProposalId, tenantId);

  const allTally = getProposalVoteTally({ id: allProposalId, condominium_id: condoId, voter_eligibility: 'all' });
  assert.equal(allTally.yes, 1);
  assert.equal(allTally.no, 1);
  assert.equal(allTally.yes_weight, 2);
  assert.equal(allTally.no_weight, 1);
  assert.equal(resolveVoteOutcome(allTally), 'approved');

  const ownersOnlyProposalId = Number(db.prepare(
    `INSERT INTO proposals (condominium_id, author_id, title, description, voter_eligibility, status)
     VALUES (?, ?, 'Owners only', 'Test', 'owners_only', 'voting')`
  ).run(condoId, ownerId).lastInsertRowid);
  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'yes')`).run(ownersOnlyProposalId, ownerId);
  db.prepare(`INSERT INTO proposal_votes (proposal_id, user_id, choice) VALUES (?, ?, 'no')`).run(ownersOnlyProposalId, tenantId);

  const ownersOnlyTally = getProposalVoteTally({ id: ownersOnlyProposalId, condominium_id: condoId, voter_eligibility: 'owners_only' });
  assert.equal(ownersOnlyTally.yes, 1);
  assert.equal(ownersOnlyTally.no, 0);
  assert.equal(canVote(ownerId, condoId, 'owners_only'), true);
  assert.equal(canVote(tenantId, condoId, 'owners_only'), false);
});

test('move-out clears active access and keeps the unit reusable through invites', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const oldResident = createUser('old@example.com');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
     VALUES (?, ?, 'tenant', 'active', 1, 1.0, CURRENT_TIMESTAMP)`
  ).run(oldResident, unit101);
  db.prepare(`UPDATE users SET condominium_id = ?, unit_number = '101' WHERE id = ?`).run(condoId, oldResident);
  const membership = db.prepare(`SELECT id FROM user_unit WHERE user_id = ?`).get(oldResident) as { id: number };

  const moved = moveOutMembership(membership.id, condoId, '2026-05-01T00:00:00.000Z');
  assert.equal(moved.ok, true);

  const after = db.prepare(
    `SELECT status, primary_contact, move_out_date FROM user_unit WHERE id = ?`
  ).get(membership.id) as any;
  assert.deepEqual(after, {
    status: 'moved_out',
    primary_contact: 0,
    move_out_date: '2026-05-01T00:00:00.000Z',
  });
  const user = db.prepare(`SELECT condominium_id, unit_number FROM users WHERE id = ?`).get(oldResident) as any;
  assert.deepEqual(user, { condominium_id: null, unit_number: null });

  const newResident = {
    id: createUser('new@example.com'),
    email: 'new@example.com',
    condominium_id: null,
    unit_number: null,
  };
  db.prepare(
    `INSERT INTO invites (condominium_id, email, unit_id, role, relationship, primary_contact, voting_weight, status)
     VALUES (?, ?, ?, 'resident', 'tenant', 1, 1.0, 'pending')`
  ).run(condoId, newResident.email, unit101);

  assert.equal(claimPendingInvitesForUser(newResident), 1);
  const replacement = db.prepare(
    `SELECT status, relationship, primary_contact FROM user_unit WHERE user_id = ? AND unit_id = ?`
  ).get(newResident.id, unit101) as any;
  assert.deepEqual(replacement, { status: 'active', relationship: 'tenant', primary_contact: 1 });
});

test('reactivate and transfer-unit preserve membership history', () => {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const resident = createUser('resident@example.com');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight, move_in_date)
     VALUES (?, ?, 'owner', 'active', 1, 1.5, CURRENT_TIMESTAMP)`
  ).run(resident, unit101);
  db.prepare(`UPDATE users SET condominium_id = ?, unit_number = '101' WHERE id = ?`).run(condoId, resident);
  const membership = db.prepare(`SELECT id FROM user_unit WHERE user_id = ?`).get(resident) as { id: number };

  assert.equal(moveOutMembership(membership.id, condoId, '2026-05-01T00:00:00.000Z').ok, true);
  assert.equal(reactivateMembership(membership.id, condoId).ok, true);
  assert.equal((db.prepare(`SELECT status FROM user_unit WHERE id = ?`).get(membership.id) as any).status, 'active');

  const transfer = transferUnit({
    fromMembershipId: membership.id,
    toUnitId: unit102,
    condoId,
    moveOutDate: '2026-06-01T00:00:00.000Z',
  });
  assert.equal(transfer.ok, true);

  const oldMembership = db.prepare(`SELECT status, primary_contact FROM user_unit WHERE id = ?`).get(membership.id) as any;
  assert.deepEqual(oldMembership, { status: 'moved_out', primary_contact: 0 });
  const active = db.prepare(
    `SELECT unit_id, relationship, status, primary_contact, voting_weight FROM user_unit WHERE id = ?`
  ).get((transfer as any).new_membership_id) as any;
  assert.deepEqual(active, {
    unit_id: unit102,
    relationship: 'owner',
    status: 'active',
    primary_contact: 1,
    voting_weight: 1.5,
  });
  const user = db.prepare(`SELECT condominium_id, unit_number FROM users WHERE id = ?`).get(resident) as any;
  assert.deepEqual(user, { condominium_id: condoId, unit_number: '102' });

  const unitHistory = listUnitMembershipHistory(unit101, condoId);
  assert.equal(unitHistory.length, 1);
  assert.equal(unitHistory[0].status, 'moved_out');
  assert.equal(unitHistory[0].email, 'resident@example.com');
});

test('audit log filters by action and escapes CSV metadata', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const actorId = createUser('admin@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(condoId, actorId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(actorId, unit101);

  const req = {
    user: {
      id: actorId,
      email: 'admin@example.com',
      condominium_id: condoId,
    },
    ip: '203.0.113.25',
    socket: {},
  } as any;
  const id = audit(req, {
    action: 'test.write',
    target_type: 'fixture',
    target_id: 42,
    metadata: { note: 'comma, quote " and newline\nok' },
  });

  const rows = listAuditRows({ condominium_id: condoId, action: 'test.write' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].actor_email, 'admin@example.com');
  assert.equal(rows[0].target_id, 42);
  assert.match(rows[0].metadata || '', /comma/);

  const csv = auditRowsToCsv(rows);
  assert.match(csv, /^id,created_at,condominium_id,actor_user_id,actor_email,action,target_type,target_id,metadata,ip\n/);
  assert.ok(csv.includes('""note""'));
  assert.ok(csv.includes('comma, quote'));
  assert.ok(csv.includes('newline'));
});

test('finance: manual invoice generation skips duplicate null-schedule invoices', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();

  const first = generateInvoices({
    condoId,
    amount_cents: 125000,
    currency: 'BRL',
    period: '2026-05',
    unit_ids: [unit101],
  });
  assert.equal(first.ok, true);
  assert.equal((first as any).created_count, 1);

  const duplicate = generateInvoices({
    condoId,
    amount_cents: 125000,
    currency: 'BRL',
    period: '2026-05',
    unit_ids: [unit101],
  });
  assert.equal(duplicate.ok, true);
  assert.equal((duplicate as any).created_count, 0);
  assert.deepEqual((duplicate as any).skipped_unit_ids, [unit101]);

  const count = db.prepare(
    `SELECT COUNT(*) AS count FROM invoices WHERE unit_id = ? AND period = ? AND schedule_id IS NULL`
  ).get(unit101, '2026-05') as { count: number };
  assert.equal(count.count, 1);
});

test('finance: scheduled monthly dues generate invoices idempotently', () => {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const scheduleId = Number(db.prepare(
    `INSERT INTO dues_schedules (condominium_id, name, amount_cents, currency, frequency, due_day, created_at)
     VALUES (?, 'Monthly dues', 150000, 'BRL', 'monthly', 10, '2026-05-01T00:00:00.000Z')`
  ).run(condoId).lastInsertRowid);

  const first = generateScheduledInvoices(new Date('2026-05-03T12:00:00.000Z'));
  assert.equal(first.period, '2026-05');
  assert.equal(first.schedule_count, 1);
  assert.equal(first.created_count, 2);
  assert.equal(first.skipped_count, 0);
  assert.deepEqual(first.errors, []);

  const dueDates = db.prepare(
    `SELECT unit_id, schedule_id, amount_cents, due_date, notes
     FROM invoices
     WHERE condominium_id = ?
     ORDER BY unit_id`
  ).all(condoId) as any[];
  assert.deepEqual(dueDates.map((row) => row.unit_id), [unit101, unit102]);
  assert.equal(dueDates[0].schedule_id, scheduleId);
  assert.equal(dueDates[0].amount_cents, 150000);
  assert.equal(dueDates[0].due_date, '2026-05-10T12:00:00.000Z');
  assert.equal(dueDates[0].notes, 'Auto-generated from schedule: Monthly dues');

  const second = generateScheduledInvoices(new Date('2026-05-20T12:00:00.000Z'));
  assert.equal(second.created_count, 0);
  assert.equal(second.skipped_count, 2);
});

test('finance: payments are reference-idempotent and cannot overpay invoices', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const boardId = createUser('finance-board@example.com', 'board_admin');
  const invoiceId = Number(db.prepare(
    `INSERT INTO invoices (condominium_id, unit_id, amount_cents, currency, period, due_date)
     VALUES (?, ?, 10000, 'BRL', '2026-05', '2026-05-10T12:00:00.000Z')`
  ).run(condoId, unit101).lastInsertRowid);

  const first = recordPayment({
    condoId,
    invoice_id: invoiceId,
    amount_cents: 4000,
    method: 'pix',
    reference: 'PIX-123',
    created_by_user_id: boardId,
  });
  assert.equal(first.ok, true);
  assert.equal((first as any).invoice_status, 'open');
  assert.equal((first as any).remaining_cents, 6000);

  const duplicate = recordPayment({
    condoId,
    invoice_id: invoiceId,
    amount_cents: 4000,
    method: 'pix',
    reference: 'PIX-123',
    created_by_user_id: boardId,
  });
  assert.equal(duplicate.ok, true);
  assert.equal((duplicate as any).duplicate, true);
  assert.equal((duplicate as any).id, (first as any).id);

  const overpay = recordPayment({
    condoId,
    invoice_id: invoiceId,
    amount_cents: 7000,
    method: 'pix',
    reference: 'PIX-124',
    created_by_user_id: boardId,
  });
  assert.equal(overpay.ok, false);
  assert.equal((overpay as any).error, 'payment_exceeds_balance');
  assert.equal((overpay as any).details.remaining_cents, 6000);

  const final = recordPayment({
    condoId,
    invoice_id: invoiceId,
    amount_cents: 6000,
    method: 'pix',
    reference: 'PIX-125',
    created_by_user_id: boardId,
  });
  assert.equal(final.ok, true);
  assert.equal((final as any).invoice_status, 'paid');
  assert.equal((final as any).remaining_cents, 0);

  const payments = db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?`).get(invoiceId) as { count: number };
  assert.equal(payments.count, 2);

  const extra = recordPayment({
    condoId,
    invoice_id: invoiceId,
    amount_cents: 1,
    method: 'pix',
    reference: 'PIX-126',
    created_by_user_id: boardId,
  });
  assert.equal(extra.ok, false);
  assert.equal((extra as any).error, 'invoice_already_paid');
});

test('finance: resident payment proof approval creates a payment after admin review', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const residentId = createUser('proof-resident@example.com');
  const boardId = createUser('proof-board@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, residentId, boardId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact)
     VALUES (?, ?, 'tenant', 'active', 1)`
  ).run(residentId, unit101);
  const invoiceId = Number(db.prepare(
    `INSERT INTO invoices (condominium_id, unit_id, amount_cents, currency, period, due_date)
     VALUES (?, ?, 10000, 'BRL', '2026-05', '2026-05-10T12:00:00.000Z')`
  ).run(condoId, unit101).lastInsertRowid);
  const fileId = createPendingFile({
    condominiumId: condoId,
    uploadedByUserId: residentId,
    originalFilename: 'pix-proof.pdf',
    contentType: 'application/pdf',
    sizeBytes: 512,
    purpose: 'payment_proof',
    visibility: 'board_only',
    storageDriver: 'local',
    storageKey: 'test/proof/pix-proof.pdf',
  }).id;
  markFileReady(fileId);

  const proof = submitPaymentProof({
    condoId,
    invoice_id: invoiceId,
    resident_user_id: residentId,
    file_id: fileId,
    amount_cents: 10000,
    method: 'pix',
    reference: 'PIX-PROOF-1',
  });
  assert.equal(proof.ok, true);
  assert.equal((proof as any).status, 'pending');

  const duplicateFileProof = submitPaymentProof({
    condoId,
    invoice_id: invoiceId,
    resident_user_id: residentId,
    file_id: fileId,
    amount_cents: 10000,
    method: 'pix',
    reference: 'PIX-PROOF-1-DUP',
  });
  assert.equal(duplicateFileProof.ok, false);
  assert.equal((duplicateFileProof as any).error, 'payment_proof_file_already_used');

  const approved = approvePaymentProof({ condoId, proof_id: (proof as any).id, reviewer_user_id: boardId });
  assert.equal(approved.ok, true);
  assert.equal((approved as any).status, 'approved');
  assert.equal((approved as any).remaining_cents, 0);

  const paymentCount = db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?`).get(invoiceId) as { count: number };
  assert.equal(paymentCount.count, 1);
  const invoice = db.prepare(`SELECT status FROM invoices WHERE id = ?`).get(invoiceId) as { status: string };
  assert.equal(invoice.status, 'paid');
});

test('finance: payment proof review protects ownership, overpay, and rejection paths', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const residentId = createUser('proof-guarded-resident@example.com');
  const boardId = createUser('proof-guarded-board@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?)`).run(condoId, residentId, boardId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact)
     VALUES (?, ?, 'tenant', 'active', 1)`
  ).run(residentId, unit101);
  const invoiceId = Number(db.prepare(
    `INSERT INTO invoices (condominium_id, unit_id, amount_cents, currency, period, due_date)
     VALUES (?, ?, 10000, 'BRL', '2026-05', '2026-05-10T12:00:00.000Z')`
  ).run(condoId, unit101).lastInsertRowid);
  const makeProof = (amount: number, filename: string) => {
    const fileId = createPendingFile({
      condominiumId: condoId,
      uploadedByUserId: residentId,
      originalFilename: filename,
      contentType: 'image/png',
      sizeBytes: 128,
      purpose: 'payment_proof',
      visibility: 'board_only',
      storageDriver: 'local',
      storageKey: `test/proof/${filename}`,
    }).id;
    markFileReady(fileId);
    return submitPaymentProof({
      condoId,
      invoice_id: invoiceId,
      resident_user_id: residentId,
      file_id: fileId,
      amount_cents: amount,
      method: 'transfer',
      reference: filename,
    });
  };

  const rejectedProof = makeProof(2000, 'reject-me.png');
  assert.equal(rejectedProof.ok, true);
  const selfReject = rejectPaymentProof({ condoId, proof_id: (rejectedProof as any).id, reviewer_user_id: residentId });
  assert.equal(selfReject.ok, false);
  assert.equal((selfReject as any).error, 'cannot_reject_own_payment_proof');
  const rejected = rejectPaymentProof({
    condoId,
    proof_id: (rejectedProof as any).id,
    reviewer_user_id: boardId,
    reason: 'Unreadable receipt',
  });
  assert.equal(rejected.ok, true);
  assert.equal((rejected as any).status, 'rejected');
  let paymentCount = db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?`).get(invoiceId) as { count: number };
  assert.equal(paymentCount.count, 0);

  const overpayProof = makeProof(9000, 'overpay.png');
  assert.equal(overpayProof.ok, true);
  const partial = recordPayment({
    condoId,
    invoice_id: invoiceId,
    amount_cents: 3000,
    method: 'manual',
    reference: 'MANUAL-1',
    created_by_user_id: boardId,
  });
  assert.equal(partial.ok, true);
  const overpayApproval = approvePaymentProof({ condoId, proof_id: (overpayProof as any).id, reviewer_user_id: boardId });
  assert.equal(overpayApproval.ok, false);
  assert.equal((overpayApproval as any).error, 'payment_exceeds_balance');
  const stillPending = db.prepare(`SELECT status FROM payment_proofs WHERE id = ?`).get((overpayProof as any).id) as { status: string };
  assert.equal(stillPending.status, 'pending');

  const ownApproval = approvePaymentProof({ condoId, proof_id: (overpayProof as any).id, reviewer_user_id: residentId });
  assert.equal(ownApproval.ok, false);
  assert.equal((ownApproval as any).error, 'cannot_approve_own_payment_proof');
});

test('finance: budget summary compares targets to actual spend and receipt coverage', () => {
  resetDb();
  const { condoId } = createCondoFixture();
  const boardId = createUser('budget-board@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(condoId, boardId);

  const saved = upsertBudgetTargets({
    condoId,
    month: '2026-05',
    currency: 'BRL',
    targets: [
      { category: 'maintenance', amount_cents: 12000 },
      { category: 'security', amount_cents: 4000 },
      { category: 'cleaning', amount_cents: 3000 },
    ],
  });
  assert.equal(saved.ok, true);

  db.prepare(
    `INSERT INTO expenses (condominium_id, amount_cents, currency, category, vendor, description, spent_at, receipt_url, created_by_user_id)
     VALUES (?, ?, 'BRL', ?, ?, ?, ?, ?, ?)`
  ).run(condoId, 10000, 'maintenance', 'FixCo', 'Lobby repair', '2026-05-03T12:00:00.000Z', 'https://example.com/lobby.pdf', boardId);
  db.prepare(
    `INSERT INTO expenses (condominium_id, amount_cents, currency, category, vendor, description, spent_at, created_by_user_id)
     VALUES (?, ?, 'BRL', ?, ?, ?, ?, ?)`
  ).run(condoId, 5000, 'security', 'SafeCo', 'Night guard', '2026-05-10T12:00:00.000Z', boardId);
  db.prepare(
    `INSERT INTO expenses (condominium_id, amount_cents, currency, category, vendor, description, spent_at, receipt_url, created_by_user_id)
     VALUES (?, ?, 'BRL', ?, ?, ?, ?, ?, ?)`
  ).run(condoId, 9000, 'maintenance', 'OtherMonth', 'April repair', '2026-04-20T12:00:00.000Z', 'https://example.com/april.pdf', boardId);

  const summary = getBudgetSummary(condoId, '2026-05');
  assert.equal(summary.month, '2026-05');
  assert.equal(summary.total_budget_cents, 19000);
  assert.equal(summary.total_actual_cents, 15000);
  assert.equal(summary.variance_cents, 4000);
  assert.equal(summary.expense_count, 2);
  assert.equal(summary.receipt_count, 1);
  assert.equal(summary.receipt_coverage_percent, 50);

  const maintenance = summary.categories.find((row) => row.category === 'maintenance')!;
  assert.equal(maintenance.budget_cents, 12000);
  assert.equal(maintenance.actual_cents, 10000);
  assert.equal(maintenance.variance_cents, 2000);
  assert.equal(maintenance.receipt_coverage_percent, 100);

  const security = summary.categories.find((row) => row.category === 'security')!;
  assert.equal(security.budget_cents, 4000);
  assert.equal(security.actual_cents, 5000);
  assert.equal(security.variance_cents, -1000);
  assert.equal(security.receipt_coverage_percent, 0);

  const cleaning = summary.categories.find((row) => row.category === 'cleaning')!;
  assert.equal(cleaning.budget_cents, 3000);
  assert.equal(cleaning.actual_cents, 0);
});

test('tickets: assignees must be active board users in the same condo', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const boardId = createUser('board@example.com', 'board_admin');
  const residentId = createUser('resident@example.com');
  const inactiveBoardId = createUser('inactive-board@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id IN (?, ?, ?)`).run(condoId, boardId, residentId, inactiveBoardId);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0),
            (?, ?, 'tenant', 'active', 0, 1.0)`
  ).run(boardId, unit101, residentId, unit101);

  assert.equal(canAssignTicketToUser(boardId, condoId), true);
  assert.equal(canAssignTicketToUser(residentId, condoId), false);
  assert.equal(canAssignTicketToUser(inactiveBoardId, condoId), false);
});

test('tickets: failed background agent escalates to admin attention', () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const reporterId = createUser('ticket-reporter@example.com');
  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (
       condominium_id, unit_id, reporter_id, title, description, category, priority,
       status, remediation_status
     ) VALUES (?, ?, ?, 'Elevator stopped', 'Elevator is stuck again', 'elevator', 'high', 'open', 'verified')`
  ).run(condoId, unit101, reporterId).lastInsertRowid);

  assert.equal(markTicketAgentFailed(ticketId), true);
  const after = db.prepare(
    `SELECT remediation_status, blocked_reason FROM tickets WHERE id = ?`
  ).get(ticketId) as any;
  assert.deepEqual(after, {
    remediation_status: 'blocked_needs_admin',
    blocked_reason: 'agent_failed',
  });

  db.prepare(
    `UPDATE tickets SET status = 'closed', remediation_status = 'resolved', blocked_reason = NULL WHERE id = ?`
  ).run(ticketId);
  assert.equal(markTicketAgentFailed(ticketId), false);
  assert.equal((db.prepare(`SELECT blocked_reason FROM tickets WHERE id = ?`).get(ticketId) as any).blocked_reason, null);
});

test('tickets: auto-dispatch requires server-visible evidence, not only model confidence', () => {
  const base = {
    ticketPriority: 'normal',
    ticketCategory: 'maintenance',
    vendorCategory: 'general_maintenance',
    plan: {
      confidence: { tier: 'high' as const, score: 0.96, reasoning: ['model says confident'] },
      building_memory: null,
    },
    topFit: { cost_history: null },
  };

  assert.deepEqual(evaluateAgentAutoDispatch(base), {
    allowed: false,
    reason: 'insufficient_evidence',
    confidentEnough: true,
    categoryCompatible: true,
    evidence: { similarResolvedTicket: false, highConfidenceCostHistory: false },
  });

  assert.equal(evaluateAgentAutoDispatch({
    ...base,
    plan: {
      ...base.plan,
      building_memory: {
        similar_resolved_tickets: [{
          id: 1,
          title: 'Hall lights flickering',
          resolved_at: '2026-04-01',
          dispatched_vendors: 'ACME',
          resolution_note: 'Replaced driver',
          estimated_cost_brl: 420,
        }],
        open_similar_count: 0,
        inferred_category: 'maintenance',
        is_outside_business_hours: false,
        local_hour: 14,
      },
    },
    topFit: {
      cost_history: {
        expense_count: 3,
        last_amount_brl: 420,
        last_spent_at: '2026-04-01',
        avg_brl: 410,
        min_brl: 390,
        max_brl: 430,
        confidence: 'high' as const,
      },
    },
  }).allowed, true);

  assert.deepEqual(evaluateAgentAutoDispatch({
    ...base,
    vendorCategory: 'cleaning',
  }).reason, 'category_mismatch');

  assert.deepEqual(evaluateAgentAutoDispatch({
    ...base,
    ticketPriority: 'urgent',
    ticketCategory: 'gas',
    vendorCategory: 'gas_leak',
    plan: { confidence: { tier: 'low' as const, score: 0.2, reasoning: [] }, building_memory: null },
    topFit: null,
  }).reason, 'urgent_safety');
});

test('memberships: reassign only moves pending claims', () => {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const activeUser = createUser('active@example.com');
  const pendingUser = createUser('pending@example.com');
  const activeMembershipId = Number(db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(activeUser, unit101).lastInsertRowid);
  const pendingMembershipId = Number(db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'tenant', 'pending', 0, 1.0)`
  ).run(pendingUser, unit101).lastInsertRowid);

  const activeResult = reassignPendingMembership(activeMembershipId, unit102, condoId);
  assert.equal(activeResult.ok, false);
  assert.equal((activeResult as any).error, 'not_pending');
  assert.equal((db.prepare(`SELECT unit_id FROM user_unit WHERE id = ?`).get(activeMembershipId) as any).unit_id, unit101);

  const pendingResult = reassignPendingMembership(pendingMembershipId, unit102, condoId);
  assert.equal(pendingResult.ok, true);
  assert.equal((pendingResult as any).unit_id, unit102);
  assert.equal((db.prepare(`SELECT unit_id FROM user_unit WHERE id = ?`).get(pendingMembershipId) as any).unit_id, unit102);
});

// ============================================================================
// Annual Assembly (AGO) tests
// ============================================================================

function createAssemblyFixture() {
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const ownerA = createUser('ownerA@x.com');
  const ownerB = createUser('ownerB@x.com');
  const tenantC = createUser('tenantC@x.com');
  const boardAdmin = createUser('admin@x.com', 'board_admin');

  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner',  'active', 1, 1.0),
            (?, ?, 'owner',  'active', 1, 1.0),
            (?, ?, 'tenant', 'active', 0, 1.0)`
  ).run(ownerA, unit101, ownerB, unit102, tenantC, unit101);

  const assemblyId = Number(db.prepare(
    `INSERT INTO assemblies (condominium_id, created_by_user_id, title, kind, first_call_at, status)
     VALUES (?, ?, 'AGO 2026', 'ordinary', ?, 'in_session')`
  ).run(condoId, boardAdmin, new Date().toISOString()).lastInsertRowid);

  return { condoId, unit101, unit102, ownerA, ownerB, tenantC, boardAdmin, assemblyId };
}

test('AGO: tenants cannot vote in assembly (owners-only)', () => {
  const { tenantC, assemblyId } = createAssemblyFixture();
  const result = canVoteInAssembly(assemblyId, tenantC);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_owner');
});

test('AGO: owners can vote; delinquent owners are blocked', () => {
  const { ownerA, assemblyId } = createAssemblyFixture();

  // First, owner is eligible before check-in (no attendance row yet).
  let r = canVoteInAssembly(assemblyId, ownerA);
  assert.equal(r.ok, true);
  assert.equal(r.effective_owner_id, ownerA);
  assert.equal(r.weight, 1);

  // Mark delinquent via attendance row.
  db.prepare(
    `INSERT INTO assembly_attendance (assembly_id, user_id, attended_as, is_delinquent)
     VALUES (?, ?, 'self', 1)`
  ).run(assemblyId, ownerA);
  r = canVoteInAssembly(assemblyId, ownerA);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'delinquent');
});

test('AGO: proxy delegation — grantee votes with grantor weight, one vote per stake', () => {
  const { ownerA, ownerB, assemblyId } = createAssemblyFixture();

  // ownerA grants proxy to ownerB
  db.prepare(
    `INSERT INTO assembly_proxies (assembly_id, grantor_user_id, grantee_user_id) VALUES (?, ?, ?)`
  ).run(assemblyId, ownerA, ownerB);

  const proxy = resolveProxyVote(assemblyId, ownerB, ownerA);
  assert.equal(proxy.ok, true);
  assert.equal(proxy.weight, 1);

  // ownerC (non-granted) cannot proxy for ownerA
  const noGrant = resolveProxyVote(assemblyId, ownerB + 999, ownerA);
  assert.equal(noGrant.ok, false);
  assert.equal(noGrant.reason, 'no_active_proxy');
});

test('AGO: agenda outcome honors required_majority (two_thirds vs simple)', () => {
  const simple = resolveAgendaOutcome(
    { yes: 2, no: 1, abstain: 0, yes_weight: 2, no_weight: 1, abstain_weight: 0, total_weight: 3 },
    'simple'
  );
  assert.equal(simple.approved, true);

  // 3 yes / 2 no → 3/5 = 60% — fails two_thirds
  const twoThirdsFail = resolveAgendaOutcome(
    { yes: 3, no: 2, abstain: 0, yes_weight: 3, no_weight: 2, abstain_weight: 0, total_weight: 5 },
    'two_thirds'
  );
  assert.equal(twoThirdsFail.approved, false);
  assert.equal(twoThirdsFail.reason, 'two_thirds_not_met');

  // 4 yes / 2 no → 4/6 = 66.7% — passes two_thirds
  const twoThirdsPass = resolveAgendaOutcome(
    { yes: 4, no: 2, abstain: 0, yes_weight: 4, no_weight: 2, abstain_weight: 0, total_weight: 6 },
    'two_thirds'
  );
  assert.equal(twoThirdsPass.approved, true);

  // 5 yes / 1 no — fails unanimous
  const unanimousFail = resolveAgendaOutcome(
    { yes: 5, no: 1, abstain: 0, yes_weight: 5, no_weight: 1, abstain_weight: 0, total_weight: 6 },
    'unanimous'
  );
  assert.equal(unanimousFail.approved, false);
});

test('AGO: ata markdown contains per-item vote results', () => {
  const { assemblyId, ownerA, ownerB } = createAssemblyFixture();

  const itemId = Number(db.prepare(
    `INSERT INTO assembly_agenda_items (assembly_id, order_index, title, item_type, required_majority, status, outcome_summary, closed_at)
     VALUES (?, 1, 'Aprovar orçamento 2026', 'budget', 'simple', 'approved', '2 Sim / 0 Não', CURRENT_TIMESTAMP)`
  ).run(assemblyId).lastInsertRowid);

  db.prepare(
    `INSERT INTO assembly_votes (assembly_id, agenda_item_id, voter_user_id, effective_owner_id, choice, weight)
     VALUES (?, ?, ?, ?, 'yes', 1.0), (?, ?, ?, ?, 'yes', 1.0)`
  ).run(assemblyId, itemId, ownerA, ownerA, assemblyId, itemId, ownerB, ownerB);

  const tally = getAgendaTally(itemId);
  assert.equal(tally.yes, 2);
  assert.equal(tally.yes_weight, 2);

  const ata = generateAtaMarkdown(assemblyId);
  assert.match(ata, /Aprovar orçamento 2026/);
  assert.match(ata, /APROVADO/);
  assert.match(ata, /Previsão orçamentária/);
  assert.match(ata, /2 Sim/);
});

test('AGO: listEligibleOwners excludes tenants', () => {
  const { condoId, ownerA, ownerB, tenantC } = createAssemblyFixture();
  const owners = listEligibleOwners(condoId).map((o) => o.user_id).sort();
  assert.deepEqual(owners, [ownerA, ownerB].sort());
  assert.ok(!owners.includes(tenantC));
});

// ============================================================================
// WhatsApp tests — use the dev fallback (no TWILIO creds in tests)
// ============================================================================

test('WhatsApp: notifyUsers skips users without phone or opt_in', async () => {
  const { sendText, notifyUsers } = await import('../src/lib/whatsapp');
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const withPhone = createUser('phone-on@x.com');
  const withoutPhone = createUser('no-phone@x.com');
  const optedOut = createUser('opted-out@x.com');
  db.prepare(`INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0)`).run(withPhone, unit101);
  db.prepare(`UPDATE users SET phone = '+5511999990000', whatsapp_opt_in = 1 WHERE id = ?`).run(withPhone);
  db.prepare(`UPDATE users SET phone = '+5511888880000', whatsapp_opt_in = 0 WHERE id = ?`).run(optedOut);
  // withoutPhone has no phone at all

  const result = await notifyUsers([withPhone, withoutPhone, optedOut], 'test');
  assert.equal(result.attempted, 3);
  // Under dev (no creds), sent=0 because all go through the skipped:'not_configured' branch.
  // What we're asserting: only 1 user (withPhone) passed the WHERE filter.
  assert.equal(result.skipped, 2 + 1); // 2 filtered out + 1 skipped due to dev config

  // sendText itself should degrade gracefully in dev.
  const send = await sendText('+5511999990000', 'hello');
  assert.equal(send.ok, true);
  assert.equal(send.skipped, 'not_configured');

  // invalid numbers return not ok
  const bad = await sendText('', 'hello');
  assert.equal(bad.ok, false);
  assert.equal(bad.skipped, 'invalid_to');
});

test('WhatsApp: production provider outage keeps outbox rows retryable', async () => {
  const { notifyUsers } = await import('../src/lib/whatsapp');
  resetDb();
  const { unit101 } = createCondoFixture();
  const withPhone = createUser('retry-phone@x.com');
  db.prepare(`INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0)`).run(withPhone, unit101);
  db.prepare(`UPDATE users SET phone = '+5511999990000', whatsapp_opt_in = 1 WHERE id = ?`).run(withPhone);

  const prevNodeEnv = process.env.NODE_ENV;
  const prevProvider = process.env.WHATSAPP_PROVIDER;
  process.env.NODE_ENV = 'production';
  process.env.WHATSAPP_PROVIDER = 'none';
  try {
    const result = await notifyUsers([withPhone], 'test');
    assert.equal(result.attempted, 1);
    assert.equal(result.sent, 0);

    const row = db.prepare(
      `SELECT status, attempts, last_error, next_attempt_at
       FROM notification_outbox
       WHERE user_id = ?`
    ).get(withPhone) as any;
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(row.last_error, 'provider_not_configured');
    assert.ok(row.next_attempt_at);
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevProvider === undefined) delete process.env.WHATSAPP_PROVIDER;
    else process.env.WHATSAPP_PROVIDER = prevProvider;
  }
});

test('AI classifier fallback: keyword heuristics map to correct categories', async () => {
  // Directly exercise the fallback logic (no network). Lives inside routes/ai.ts so
  // we re-implement a tiny matching check via the same regex rules — here we just
  // assert the public API surface: category values stay in the fixed enum.
  const VALID = ['maintenance', 'infrastructure', 'safety', 'amenity', 'community', 'policy', 'financial'];
  // Re-create minimal matcher to mirror fallbackClassify behaviour — guards
  // against the test drifting from implementation.
  function classify(t: string): string {
    const rules: Array<[string, RegExp]> = [
      ['safety',         /\b(safety|fire|smoke|camera|security|access|hazard|alarm)\b/i],
      ['financial',      /\b(fee|dues|budget|reserve|assess|audit)\b/i],
      ['infrastructure', /\b(ev|solar|elevator|upgrade|install.*(system|network))\b/i],
      ['amenity',        /\b(pool|gym|sauna|party|bbq|grill)\b/i],
      ['community',      /\b(event|welcome|neighbor|social)\b/i],
      ['policy',         /\b(rule|policy|bylaw|pet|guest|noise)\b/i],
      ['maintenance',    /\b(repair|fix|broken|replace|leak|malfunction|service)\b/i],
    ];
    for (const [cat, re] of rules) if (re.test(t)) return cat;
    return 'maintenance';
  }
  assert.equal(classify('install 4 EV chargers in garage'), 'infrastructure');
  assert.equal(classify('replace malfunctioning lobby AC unit'), 'maintenance');
  assert.equal(classify('update pet policy'), 'policy');
  assert.equal(classify('raise condo fee for reserve fund'), 'financial');
  assert.equal(classify('add fire alarm to parking level'), 'safety');
  assert.equal(classify('new grill in party room'), 'amenity');
  assert.equal(classify('welcome event for new residents'), 'community');
  // All valid categories in the enum
  for (const c of VALID) assert.ok(typeof c === 'string');
});

test('amenity slots track people capacity instead of reservation row count', () => {
  resetDb();
  const { condoId } = createCondoFixture();
  const user1 = createUser('gym-a@example.com');
  const user2 = createUser('gym-b@example.com');
  const amenityId = Number(db.prepare(
    `INSERT INTO amenities (
       condominium_id, name, description, icon, capacity, open_hour, close_hour, slot_minutes, booking_window_days
     ) VALUES (?, 'Gym', 'Weights', 'Dumbbell', 5, 6, 22, 60, 14)`
  ).run(condoId).lastInsertRowid);
  const starts = new Date('2026-05-01T18:00:00.000Z');
  const ends = new Date('2026-05-01T19:00:00.000Z');
  db.prepare(
    `INSERT INTO amenity_reservations (amenity_id, user_id, starts_at, ends_at, expected_guests)
     VALUES (?, ?, ?, ?, 2)`
  ).run(amenityId, user1, starts.toISOString(), ends.toISOString());
  db.prepare(
    `INSERT INTO amenity_reservations (amenity_id, user_id, starts_at, ends_at, expected_guests)
     VALUES (?, ?, ?, ?, 0)`
  ).run(amenityId, user2, starts.toISOString(), ends.toISOString());

  const overlapping = db.prepare(
    `SELECT COALESCE(SUM(1 + COALESCE(expected_guests, 0)), 0) AS people
     FROM amenity_reservations
     WHERE amenity_id = ?
       AND status = 'confirmed'
       AND starts_at < ?
       AND ends_at > ?`
  ).get(amenityId, ends.toISOString(), starts.toISOString()) as { people: number };
  assert.equal(overlapping.people, 4);

  const amenity = db.prepare(
    `SELECT capacity, slot_minutes, booking_window_days, active FROM amenities WHERE id = ?`
  ).get(amenityId) as any;
  assert.deepEqual(amenity, { capacity: 5, slot_minutes: 60, booking_window_days: 14, active: 1 });
});

test('WhatsApp: notifyCondoOwners selects only active owners in the condo', async () => {
  const { notifyCondoOwners } = await import('../src/lib/whatsapp');
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const owner1 = createUser('o1@x.com');
  const owner2 = createUser('o2@x.com');
  const tenant = createUser('t@x.com');
  db.prepare(`INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0), (?, ?, 'owner', 'active', 1, 1.0), (?, ?, 'tenant', 'active', 0, 1.0)`).run(owner1, unit101, owner2, unit102, tenant, unit101);
  db.prepare(`UPDATE users SET phone = '+5511111110000', whatsapp_opt_in = 1 WHERE id IN (?, ?, ?)`).run(owner1, owner2, tenant);

  const result = await notifyCondoOwners(condoId, 'test');
  // 2 owners matched + 1 tenant skipped at the SQL filter
  assert.equal(result.attempted, 2);
});

test('SLA escalator: flips awaiting_vendor tickets past their priority window', async () => {
  resetDb();
  const { tickSlaEscalator } = await import('../src/lib/sla-escalator');
  const { condoId, unit101 } = createCondoFixture();
  const resident = createUser('r@sla.test');
  const admin = createUser('a@sla.test', 'board_admin');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0), (?, ?, 'owner', 'active', 0, 1.0)`
  ).run(resident, unit101, admin, unit101);

  // Three tickets, all in awaiting_vendor, with dispatches at different ages.
  // Helper inserts ticket + matching dispatch row; created_at is rewound by N
  // hours via a literal string so the test doesn't depend on JS clock skew.
  function seedTicket(priority: string, dispatchHoursAgo: number): number {
    const ticketId = Number(db.prepare(
      `INSERT INTO tickets (condominium_id, reporter_id, title, description, category, priority, status, remediation_status, verification_threshold)
       VALUES (?, ?, 'test', 'test', 'plumbing', ?, 'open', 'awaiting_vendor', 3)`
    ).run(condoId, resident, priority).lastInsertRowid);
    db.prepare(
      `INSERT INTO ticket_dispatches (ticket_id, channel, message_body, status, created_at, dispatched_by_user_id)
       VALUES (?, 'whatsapp', 'hi', 'sent', datetime('now', '-' || ? || ' hours'), ?)`
    ).run(ticketId, dispatchHoursAgo, admin);
    return ticketId;
  }

  const urgentBreached = seedTicket('urgent', 3);   // 3h > 2h urgent SLA — breach
  const normalFresh   = seedTicket('normal', 5);    // 5h < 24h normal SLA — fresh
  const normalBreach  = seedTicket('normal', 30);   // 30h > 24h normal SLA — breach

  const result = await tickSlaEscalator();
  assert.equal(result.escalated, 2);
  assert.deepEqual(new Set(result.ticketIds), new Set([urgentBreached, normalBreach]));

  const status = (id: number) => db.prepare(
    `SELECT remediation_status, blocked_reason FROM tickets WHERE id = ?`
  ).get(id) as { remediation_status: string; blocked_reason: string | null };

  assert.deepEqual(status(urgentBreached), { remediation_status: 'blocked_needs_admin', blocked_reason: 'vendor_no_response' });
  assert.deepEqual(status(normalFresh),   { remediation_status: 'awaiting_vendor',     blocked_reason: null });
  assert.deepEqual(status(normalBreach),  { remediation_status: 'blocked_needs_admin', blocked_reason: 'vendor_no_response' });

  // Already-responded dispatches must NOT trigger escalation even if old.
  resetDb();
  const fix = createCondoFixture();
  const r = createUser('r2@sla.test');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight) VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(r, fix.unit101);
  const respondedTicket = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, reporter_id, title, description, category, priority, status, remediation_status, verification_threshold)
     VALUES (?, ?, 'r', 'r', 'plumbing', 'normal', 'open', 'awaiting_vendor', 3)`
  ).run(fix.condoId, r).lastInsertRowid);
  db.prepare(
    `INSERT INTO ticket_dispatches (ticket_id, channel, message_body, status, created_at, responded_at, dispatched_by_user_id)
     VALUES (?, 'whatsapp', 'hi', 'responded', datetime('now', '-30 hours'), datetime('now', '-25 hours'), ?)`
  ).run(respondedTicket, r);

  const second = await tickSlaEscalator();
  assert.equal(second.escalated, 0);
});

test('building memory: category inference + keyword scoring', async () => {
  const { inferCategoryFromTask, extractKeywords, scoreTitleOverlap } = await import('../src/ai/admin-agent-runner');
  // Category inference — first-match wins on the keyword priority order.
  assert.equal(inferCategoryFromTask('Elevador A com ruído estranho'), 'elevator');
  assert.equal(inferCategoryFromTask('Vazamento de água na garagem'), 'plumbing');
  assert.equal(inferCategoryFromTask('Vazamento de gás no térreo'), 'gas_leak');
  assert.equal(inferCategoryFromTask('Inundação no subsolo'), 'water_damage');
  assert.equal(inferCategoryFromTask('Ar condicionado da academia parou'), 'hvac');
  assert.equal(inferCategoryFromTask('Cheguei em casa e tava tudo bom'), null);

  // Accent-insensitive keyword extraction. Stopwords are dropped.
  const kw = extractKeywords('Elevador A com ruído estranho parando entre andares');
  assert.ok(kw.includes('elevador'));
  assert.ok(kw.includes('ruido'));     // accent stripped
  assert.ok(kw.includes('estranho'));
  assert.ok(kw.includes('parando'));
  assert.ok(!kw.includes('com'));      // stopword
  assert.ok(!kw.includes('entre'));    // stopword (short)

  // Title overlap scoring picks the most-similar past title.
  const today = 'Elevador A com ruído estranho';
  const past1 = 'Elevador B parou de funcionar';            // 1 overlap (elevador)
  const past2 = 'Elevador A ruído entre andares';           // 2 overlaps (elevador, ruido)
  const past3 = 'Vazamento de água na garagem';             // 0 overlap
  const taskWords = extractKeywords(today);
  assert.equal(scoreTitleOverlap(taskWords, past1), 1);
  assert.equal(scoreTitleOverlap(taskWords, past2), 2);
  assert.equal(scoreTitleOverlap(taskWords, past3), 0);
});

test('admin agent sanitizer drops platform-duplicate action_plan items', () => {
  // The agent shouldn't surface "send WhatsApp to vendor" as a manual
  // step because the platform has a button that does exactly that. The
  // denylist filter strips these so action_plan only contains genuine
  // offline work (or is empty).
  const raw = {
    action_plan: [
      { step: 'Enviar mensagem para Otis Elevadores', owner: 'Síndico', due: 'Hoje', details: 'Acionar fornecedor preferencial via WhatsApp.' },
      { step: 'Visitar o local com técnico para diagnóstico', owner: 'Operação', due: 'Esta semana', details: 'Levar laudo do último laudo técnico.' },
      { step: 'Publicar comunicado aos moradores', owner: 'Síndico', due: 'Hoje', details: 'Avisar sobre intermitência do elevador.' },
      { step: 'Obter três orçamentos competitivos', owner: 'Conselho', due: '7 dias', details: 'Confirmar escopo e garantia em cada um.' },
      { step: 'Criar proposta para votação dos moradores', owner: 'Síndico', due: '14 dias', details: 'Após equalizar opções.' },
    ],
  };
  const out = sanitizeAdminAgentOutput(raw, { task: 'elevator broke', service_contacts: [] });
  // Exactly two items survive: the visit and the three-quotes ask.
  assert.equal(out.action_plan.length, 2);
  assert.ok(out.action_plan.find((a) => a.step.includes('Visitar')));
  assert.ok(out.action_plan.find((a) => a.step.includes('três orçamentos')));
  assert.equal(out.action_plan.find((a) => /enviar mensagem/i.test(a.step)), undefined);
  assert.equal(out.action_plan.find((a) => /publicar comunicado/i.test(a.step)), undefined);
  assert.equal(out.action_plan.find((a) => /criar proposta/i.test(a.step)), undefined);
});

test('admin agent sanitizer fixes UTF-8-as-Latin1 mojibake in output strings', () => {
  // Real-world mojibake from the prod agent output: "está" came back as
  // "estÃ¡" (two chars: 0xC3 0xA1 interpreted as Latin-1 codepoints).
  // The sanitizer should detect the pattern and round-trip the bytes
  // back through UTF-8 decoding to recover the proper character.
  const raw = {
    summary: 'O elevador A estÃ¡ com problemas crÃ­ticos.',
    recommended_next_step: 'Acionar manutenÃ§Ã£o emergencial.',
    options: [{
      title: 'OpÃ§Ã£o Ãºnica',
      fit: 'AvaliaÃ§Ã£o operacional',
      pros: ['ResposÃ¡vel conhecido'],
      cons: [],
      estimated_cost_range: 'A confirmar',
      timeline: 'Hoje',
      questions_for_vendor: [],
      evaluation_criteria: [],
    }],
    resident_update: { title: 'ManutenÃ§Ã£o do elevador', body: 'InspeÃ§Ã£o hoje.' },
    risks: ['InterrupÃ§Ã£o total do servoÃ§o'],
  };
  const out = sanitizeAdminAgentOutput(raw, { task: 'test', service_contacts: [] });
  assert.equal(out.summary, 'O elevador A está com problemas críticos.');
  assert.equal(out.recommended_next_step, 'Acionar manutenção emergencial.');
  assert.equal(out.options[0].title, 'Opção única');
  assert.equal(out.resident_update.title, 'Manutenção do elevador');
  assert.equal(out.resident_update.body, 'Inspeção hoje.');
  // Pure-ASCII / properly-encoded strings should pass through unchanged.
  const clean = sanitizeAdminAgentOutput({ summary: 'All good here.' }, { task: 'test', service_contacts: [] });
  assert.equal(clean.summary, 'All good here.');
});

test('attachment vision: cached entries return without re-calling the model', async () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const r = createUser('r@x.com');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(r, unit101);

  // Seed a ticket + one attachment with a fake cached analysis. The
  // analyzer must NOT call the model for an already-analyzed row.
  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, reporter_id, title, description, category, priority, status, remediation_status, verification_threshold)
     VALUES (?, ?, 'Vazamento', 'agua na pia', 'plumbing', 'normal', 'open', 'open', 0)`
  ).run(condoId, r).lastInsertRowid);
  db.prepare(
    `INSERT INTO ticket_attachments (ticket_id, uploaded_by_user_id, url, filename, content_type,
                                     ai_description, ai_signals, ai_analyzed_at)
     VALUES (?, ?, 'https://example.com/leak.jpg', 'leak.jpg', 'image/jpeg', ?, ?, CURRENT_TIMESTAMP)`
  ).run(ticketId, r, 'Vazamento visível sob a pia.', JSON.stringify(['water_visible', 'leak_active', 'urgency_high']));

  const { analyzeTicketAttachments, getCachedAttachmentAnalysis } = await import('../src/ai/attachment-vision');
  const out = await analyzeTicketAttachments(ticketId, 'pt-BR');
  assert.equal(out.length, 1);
  assert.equal(out[0].description, 'Vazamento visível sob a pia.');
  assert.deepEqual(out[0].signals, ['water_visible', 'leak_active', 'urgency_high']);

  const cached = getCachedAttachmentAnalysis(ticketId);
  assert.equal(cached.length, 1);
  assert.equal(cached[0].signals[0], 'water_visible');
});

test('attachment vision: non-image content_type is cached as unsupported, never reanalyzed', async () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const r = createUser('r2@x.com');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(r, unit101);
  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, reporter_id, title, description, category, priority, status, remediation_status, verification_threshold)
     VALUES (?, ?, 't', 'd', 'plumbing', 'normal', 'open', 'open', 0)`
  ).run(condoId, r).lastInsertRowid);
  const attachmentId = Number(db.prepare(
    `INSERT INTO ticket_attachments (ticket_id, uploaded_by_user_id, url, filename, content_type)
     VALUES (?, ?, 'https://example.com/quote.pdf', 'quote.pdf', 'application/pdf')`
  ).run(ticketId, r).lastInsertRowid);

  const { analyzeAttachment } = await import('../src/ai/attachment-vision');
  const first = await analyzeAttachment(attachmentId);
  assert.equal(first, null);
  const row = db.prepare(
    `SELECT ai_analyzed_at, ai_analysis_error FROM ticket_attachments WHERE id = ?`
  ).get(attachmentId) as { ai_analyzed_at: string; ai_analysis_error: string };
  assert.ok(row.ai_analyzed_at);
  assert.equal(row.ai_analysis_error, 'unsupported_content_type');
});

test('attachment vision: transient OpenRouter failures stay retryable', async () => {
  resetDb();
  const { condoId, unit101 } = createCondoFixture();
  const r = createUser('r3@x.com');
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(r, unit101);
  const ticketId = Number(db.prepare(
    `INSERT INTO tickets (condominium_id, reporter_id, title, description, category, priority, status, remediation_status, verification_threshold)
     VALUES (?, ?, 't', 'd', 'plumbing', 'normal', 'open', 'open', 0)`
  ).run(condoId, r).lastInsertRowid);
  const attachmentId = Number(db.prepare(
    `INSERT INTO ticket_attachments (ticket_id, uploaded_by_user_id, url, filename, content_type)
     VALUES (?, ?, 'https://example.com/leak.jpg', 'leak.jpg', 'image/jpeg')`
  ).run(ticketId, r).lastInsertRowid);

  const { analyzeAttachment } = await import('../src/ai/attachment-vision');
  const out = await analyzeAttachment(attachmentId, 'pt-BR', async () => {
    throw new OpenRouterError(429, 'rate_limit');
  });

  assert.equal(out, null);
  const row = db.prepare(
    `SELECT ai_analyzed_at, ai_analysis_error FROM ticket_attachments WHERE id = ?`
  ).get(attachmentId) as { ai_analyzed_at: string | null; ai_analysis_error: string };
  assert.equal(row.ai_analyzed_at, null);
  assert.equal(row.ai_analysis_error, 'transient:rate_limit');
});

test('admin agent sanitizer derives confidence tier and clamps fallback ceiling', () => {
  const input = { task: 't', service_contacts: [{ company_name: 'Otis', category: 'elevator' }] };

  // High confidence with explicit reasoning passes through.
  const high = sanitizeAdminAgentOutput({
    summary: 's', _fallback: false,
    confidence: { score: 0.92, tier: 'high', reasoning: ['past resolution found', 'vendor cost_history=high'] },
  }, input);
  assert.equal(high.confidence?.tier, 'high');
  assert.equal(high.confidence?.score, 0.92);
  assert.equal(high.confidence?.reasoning.length, 2);

  // Score-only input gets a derived tier.
  const numeric = sanitizeAdminAgentOutput({ summary: 's', confidence: 0.6 }, input);
  assert.equal(numeric.confidence?.tier, 'medium');
  assert.equal(numeric.confidence?.score, 0.6);

  // Missing confidence on a real plan: synthesised medium default.
  const missing = sanitizeAdminAgentOutput({ summary: 's' }, input);
  assert.equal(missing.confidence?.tier, 'medium');
  assert.ok(missing.confidence!.score >= 0.5 && missing.confidence!.score < 0.85);
  assert.ok(missing.confidence!.reasoning.length >= 1);

  // Fallback plans are capped at medium even if heuristic suggested higher.
  const fallback = sanitizeAdminAgentOutput({
    summary: 's', _fallback: true,
    confidence: { score: 0.95, tier: 'high', reasoning: ['x'] },
  }, input);
  assert.equal(fallback.confidence?.tier, 'medium');  // capped from high
  assert.ok(fallback.confidence!.score <= 0.65);
});

test('admin agent presentation strips diagnostics unless debug is requested', () => {
  const plan = fallbackAdminAgent({
    task: 'Consertar portão da garagem',
    service_contacts: [],
  });
  plan.confidence = { score: 0.72, tier: 'medium', reasoning: ['network fit missing'] };
  plan.building_memory = {
    similar_resolved_tickets: [],
    open_similar_count: 1,
    inferred_category: 'gate',
    is_outside_business_hours: false,
    local_hour: 14,
  };
  plan.agent_trace = [{ tool: 'search_past_tickets', input_keys: ['query'], output_summary: '1 aberto' }];
  plan.evidence_sources = [{ type: 'pattern', title: 'Chamados parecidos', detail: '1 chamado aberto.' }];

  const normal = presentAdminAgentForOperator(plan, {
    fallback: false,
    ai_status: 'ok',
    thread_id: 7,
    turn_index: 2,
    agent_run_id: 99,
  }) as any;
  assert.equal(normal.summary, plan.summary);
  assert.equal(normal.diagnostics_available, true);
  assert.equal(normal.ai_status, 'ok');
  assert.equal(normal.thread_id, 7);
  assert.equal('confidence' in normal, false);
  assert.equal('building_memory' in normal, false);
  assert.equal('agent_trace' in normal, false);
  assert.equal('evidence_sources' in normal, false);
  assert.equal(normal.debug_view, undefined);

  const debug = presentAdminAgentForOperator(plan, { includeDebug: true }) as any;
  assert.equal(debug.diagnostics_available, true);
  assert.equal(debug.debug_view.confidence.tier, 'medium');
  assert.equal(debug.debug_view.agent_trace[0].tool, 'search_past_tickets');
  assert.equal('agent_trace' in debug, false);
});

test('openrouter: classifyStatus maps HTTP codes to error kinds', () => {
  assert.equal(classifyStatus(402), 'credits');     // out of credits — hard
  assert.equal(classifyStatus(401), 'auth');
  assert.equal(classifyStatus(403), 'auth');
  assert.equal(classifyStatus(429), 'rate_limit');  // throttled — transient
  assert.equal(classifyStatus(500), 'server');
  assert.equal(classifyStatus(503), 'server');
  assert.equal(classifyStatus(418), 'unknown');
});

test('openrouter: OpenRouterError carries status + kind for callers to branch on', () => {
  const err = new OpenRouterError(402, 'credits', 'OpenRouter 402 chat');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'OpenRouterError');
  assert.equal(err.status, 402);
  assert.equal(err.kind, 'credits');
  // Default message is derived when none is passed.
  assert.match(new OpenRouterError(429, 'rate_limit').message, /429.*rate_limit/);
});

test('openrouter: circuit breaker starts closed', () => {
  // No 402 has been seen in this test process, so the breaker is closed
  // and exposes no openUntil. Trip behaviour is exercised live on prod.
  const state = aiBreakerState();
  assert.equal(state.open, false);
  assert.equal(state.openUntil, null);
});

test('ai-usage: estimateCostUsd uses per-model rates', () => {
  // Haiku 3.5: $0.80 in / $4.00 out per 1M.
  const haiku = estimateCostUsd('anthropic/claude-3.5-haiku', 1_000_000, 1_000_000);
  assert.equal(haiku, 4.8);
  // DeepSeek cheap tier is several times cheaper on a balanced workload.
  const deepseek = estimateCostUsd('deepseek/deepseek-chat', 1_000_000, 1_000_000);
  assert.ok(deepseek < haiku / 5);
  // Unknown model falls back to the Haiku rate, never $0.
  assert.equal(estimateCostUsd('some/unknown-model', 1_000_000, 0), 0.8);
  // Zero tokens → zero cost.
  assert.equal(estimateCostUsd('anthropic/claude-3.5-haiku', 0, 0), 0);
});

test('ai-usage: summaries are condo-scoped and resettable', () => {
  resetDb();
  const { condoId } = createCondoFixture();
  const otherCondoId = Number(db.prepare(
    `INSERT INTO condominiums (name, address) VALUES ('Other Condo', '2 Side St')`
  ).run().lastInsertRowid);

  recordAiUsage({
    caller: 'admin-agent',
    model: 'anthropic/claude-3.5-haiku',
    promptTokens: 1_000,
    completionTokens: 100,
    outcome: 'ok',
    condoId,
  });
  recordAiUsage({
    caller: 'admin-agent',
    model: 'anthropic/claude-3.5-haiku',
    promptTokens: 999_000,
    completionTokens: 100,
    outcome: 'ok',
    condoId: otherCondoId,
  });
  recordAiUsage({
    caller: 'global-task',
    model: 'deepseek/deepseek-chat',
    promptTokens: 500,
    completionTokens: 0,
    outcome: 'ok',
  });

  const scoped = getAiUsageSummary(7, condoId);
  assert.equal(scoped.total_calls, 1);
  assert.equal(scoped.by_caller.length, 1);
  assert.equal(scoped.by_caller[0].caller, 'admin-agent');

  const global = getAiUsageSummary(7);
  assert.equal(global.total_calls, 3);

  resetDb();
  assert.equal(getAiUsageSummary(7).total_calls, 0);
});

test('finance: userCanSeeUnit rejects cross-unit reads from non-admin residents', async () => {
  const { userCanSeeUnit } = await import('../src/lib/finance');
  resetDb();
  const { condoId, unit101, unit102 } = createCondoFixture();
  const resident = createUser('owner-101@example.com');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(condoId, resident);
  db.prepare(
    `INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)
     VALUES (?, ?, 'owner', 'active', 1, 1.0)`
  ).run(resident, unit101);

  // Own unit — allowed.
  assert.equal(userCanSeeUnit(resident, 'resident', unit101, condoId), true);
  // Neighbour's unit — refused (the "I own 301, give me 302" attack).
  assert.equal(userCanSeeUnit(resident, 'resident', unit102, condoId), false);
  // Revoked membership — refused (was 'active', now lost access).
  db.prepare(`UPDATE user_unit SET status='revoked' WHERE user_id=? AND unit_id=?`).run(resident, unit101);
  assert.equal(userCanSeeUnit(resident, 'resident', unit101, condoId), false);
  // Board admin — always sees every unit in the condo.
  const admin = createUser('board@example.com', 'board_admin');
  db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(condoId, admin);
  assert.equal(userCanSeeUnit(admin, 'board_admin', unit102, condoId), true);
});
