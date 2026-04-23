import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/db';
import { claimPendingInvitesForUser } from '../src/lib/invites';
import { canVote, getProposalVoteTally, resolveVoteOutcome } from '../src/lib/proposal-tally';

function resetDb() {
  const tables = [
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
