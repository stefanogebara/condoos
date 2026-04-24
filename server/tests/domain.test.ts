import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db';
import { claimPendingInvitesForUser } from '../src/lib/invites';
import { canVote, getProposalVoteTally, resolveVoteOutcome, computeQuorum, countEligibleVoters } from '../src/lib/proposal-tally';
import { parseJsonLoose } from '../src/ai/openrouter';
import { tickVoteCloser } from '../src/lib/vote-closer';
import {
  canVoteInAssembly,
  resolveProxyVote,
  resolveAgendaOutcome,
  getAgendaTally,
  generateAtaMarkdown,
  listEligibleOwners,
} from '../src/lib/assembly';

function resetDb() {
  const tables = [
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
