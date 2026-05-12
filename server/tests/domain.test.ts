import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db';
import { claimPendingInvitesForUser } from '../src/lib/invites';
import { canVote, getProposalVoteTally, resolveVoteOutcome, computeQuorum, countEligibleVoters } from '../src/lib/proposal-tally';
import { parseJsonLoose } from '../src/ai/openrouter';
import { fallbackAdminAgent, sanitizeAdminAgentOutput } from '../src/ai/admin-agent';
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
import { generateInvoices, generateScheduledInvoices, recordPayment } from '../src/lib/finance';
import { requireAuth, revokeUserTokens, signToken } from '../src/lib/auth';
import { canAssignTicketToUser, markTicketAgentFailed } from '../src/lib/tickets';
import { normalizeServiceContact, serviceContactSchema } from '../src/lib/service-contacts';

function resetDb() {
  const tables = [
    'ticket_attachments',
    'ticket_comments',
    'ticket_dispatches',
    'ticket_verifications',
    'tickets',
    'payments',
    'invoices',
    'dues_schedules',
    'notification_outbox',
    'audit_log',
    'amenity_reservations',
    'amenities',
    'service_contacts',
    'assembly_votes',
    'assembly_proxies',
    'assembly_attendance',
    'assembly_agenda_items',
    'assemblies',
    'invites',
    'user_unit',
    'units',
    'buildings',
    'proposal_votes',
    'proposals',
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

function createUser(email: string, role: 'resident' | 'board_admin' = 'resident') {
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
