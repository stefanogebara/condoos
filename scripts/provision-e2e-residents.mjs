#!/usr/bin/env node
// Provision additional E2E resident accounts in the prod DB so the
// multi-user-loop spec can assert a 3-voter (or 4-voter) tally.
//
// What this does, end-to-end:
//   1. Reads NEW_PASSWORD from --password or PROD_E2E_PASSWORD env.
//      Same length requirement as reset-e2e-prod-passwords.mjs.
//   2. Generates a single bcrypt(12) hash locally so the plaintext
//      never crosses the SSH wire.
//   3. SSHes into the prod Fly machine and, for each requested email:
//        - skips if the user already exists (idempotent)
//        - else inserts into users (role='resident', condominium_id =
//          the same condo as the primary e2e-resident@) and into
//          user_unit (status='active', relationship='tenant',
//          voting_weight=1.0). Voting eligibility 'all' on the
//          proposals spec only needs the user_unit row to be active.
//   4. Prints a JSON summary so the operator can verify each account.
//
// What this does NOT do:
//   - It does NOT set GitHub Actions secrets. After running, you must:
//       gh secret set E2E_RESIDENT2_EMAIL    --body "e2e-resident2@condoos.test"
//       gh secret set E2E_RESIDENT2_PASSWORD --body "<the password>"
//       gh secret set E2E_RESIDENT3_EMAIL    --body "e2e-resident3@condoos.test"
//       gh secret set E2E_RESIDENT3_PASSWORD --body "<the password>"
//
// Usage:
//   node scripts/provision-e2e-residents.mjs --password '<at-least-16-chars>'
//   node scripts/provision-e2e-residents.mjs --password '...' --emails 'e2e-resident2@condoos.test,e2e-resident3@condoos.test'
//
// Requires: flyctl on PATH, authenticated against the condoos-api app.

import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';

const APP = process.env.FLY_APP || 'condoos-api';
const DB_PATH = process.env.DB_PATH || '/data/condoos.sqlite';
const PRIMARY_RESIDENT_EMAIL = process.env.PRIMARY_RESIDENT_EMAIL || 'e2e-resident@condoos.test';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] || null : null;
}

const password = argValue('--password') || process.env.PROD_E2E_PASSWORD;
if (!password) {
  console.error('error: pass --password "<passphrase>" or set PROD_E2E_PASSWORD env');
  process.exit(2);
}
if (password.length < 16) {
  console.error('error: passphrase must be at least 16 characters');
  process.exit(2);
}

const emailsArg = argValue('--emails') || 'e2e-resident2@condoos.test,e2e-resident3@condoos.test';
const targetEmails = emailsArg.split(',').map((e) => e.trim()).filter(Boolean);
if (targetEmails.length === 0) {
  console.error('error: --emails must contain at least one address');
  process.exit(2);
}

const hash = bcrypt.hashSync(password, 12);

// Remote program. Runs inside the Fly machine via `flyctl ssh console
// -C`. We base64-encode the whole node program and decode it inside the
// shell so SQL backticks, dollar signs, and quotes don't get mangled by
// any shell layer (host PowerShell, flyctl, remote sh).
const remote = `
const Database = require('/app/node_modules/better-sqlite3');
// node - keeps '-' as argv[1]; use env for the fixed values and reserve
// argv tail (from index 2) for the variable-length emails list.
const d = new Database(process.env.PROV_DB_PATH);
const primaryEmail = process.env.PROV_PRIMARY_EMAIL;
const hash = process.env.PROV_HASH;
const emails = process.argv.slice(2);

const primary = d.prepare(
  "SELECT u.id AS user_id, u.condominium_id AS condo_id, uu.unit_id AS unit_id"
  + " FROM users u"
  + " LEFT JOIN user_unit uu ON uu.user_id = u.id AND uu.status = 'active'"
  + " WHERE u.email = ?"
  + " LIMIT 1"
).get(primaryEmail);
if (!primary || !primary.condo_id) {
  console.log(JSON.stringify({ ok: false, error: 'primary_resident_not_found_or_no_condo', primaryEmail }));
  process.exit(1);
}
const condoId = primary.condo_id;
const fallbackUnitId = primary.unit_id;
if (!fallbackUnitId) {
  console.log(JSON.stringify({ ok: false, error: 'primary_resident_has_no_active_unit', primaryEmail }));
  process.exit(1);
}

const findUser = d.prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
const insertUser = d.prepare(
  "INSERT INTO users (condominium_id, email, password_hash, first_name, last_name, role, email_verified_at)"
  + " VALUES (?, ?, ?, 'E2E', 'Resident', 'resident', CURRENT_TIMESTAMP)"
);
const findMembership = d.prepare("SELECT id FROM user_unit WHERE user_id = ? AND status = 'active' LIMIT 1");
const insertMembership = d.prepare(
  "INSERT INTO user_unit (user_id, unit_id, relationship, status, primary_contact, voting_weight)"
  + " VALUES (?, ?, 'tenant', 'active', 0, 1.0)"
);

const results = emails.map((email) => {
  const existing = findUser.get(email);
  if (existing) {
    d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    const m = findMembership.get(existing.id);
    if (!m) insertMembership.run(existing.id, fallbackUnitId);
    return { email, status: 'updated_existing', user_id: existing.id, condo_id: condoId, unit_id: fallbackUnitId };
  }
  const r = insertUser.run(condoId, email, hash);
  const userId = r.lastInsertRowid;
  insertMembership.run(userId, fallbackUnitId);
  return { email, status: 'inserted', user_id: Number(userId), condo_id: condoId, unit_id: fallbackUnitId };
});

console.log(JSON.stringify({ ok: true, primaryEmail, results }, null, 2));
`;

const remoteB64 = Buffer.from(remote, 'utf8').toString('base64');

console.log(`Provisioning ${targetEmails.length} residents on ${APP}:${DB_PATH}…`);
console.log(`Primary resident reference: ${PRIMARY_RESIDENT_EMAIL}`);

// Build the remote shell command. The remote node program reads its
// fixed inputs (db path, primary email, password hash) from env vars
// PROV_*, and the variable-length emails list from argv tail. Passing
// the program via base64-on-stdin avoids quoting the SQL backticks /
// dollar signs / quotes through three shell layers.
const argvPart = targetEmails
  .map((s) => `'${String(s).replace(/'/g, `'\\''`)}'`)
  .join(' ');
// Single-quote the bcrypt hash for shell safety, but escape any
// embedded single quotes (defensive — bcrypt output is base64-ish).
const sqEscape = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const shellCmd = `PROV_DB_PATH=${sqEscape(DB_PATH)} PROV_PRIMARY_EMAIL=${sqEscape(PRIMARY_RESIDENT_EMAIL)} PROV_HASH=${sqEscape(hash)} sh -c 'echo ${remoteB64} | base64 -d | node - ${argvPart}'`;

const ssh = spawnSync('flyctl', [
  'ssh',
  'console',
  '--app', APP,
  '-C',
  `sh -lc "${shellCmd.replace(/"/g, '\\"')}"`,
], { encoding: 'utf8' });

const stdout = (ssh.stdout || '').split('\n').filter((line) =>
  !line.startsWith('Connecting to') && !line.includes('Warning:') && !line.includes('handle is invalid'),
).join('\n').trim();

if (ssh.status !== 0 && !stdout.startsWith('{')) {
  console.error('flyctl ssh failed:');
  console.error(ssh.stderr || ssh.stdout);
  process.exit(1);
}

console.log(stdout);
console.log('\nNext steps:');
console.log('  1. Set GitHub Actions secrets for each provisioned resident:');
targetEmails.forEach((email, i) => {
  const slot = i + 2; // E2E_RESIDENT2, E2E_RESIDENT3, …
  console.log(`       gh secret set E2E_RESIDENT${slot}_EMAIL    --body "${email}"`);
  console.log(`       gh secret set E2E_RESIDENT${slot}_PASSWORD --body "<the password>"`);
});
console.log('  2. Re-run npm run audit:prod:credentials and verify each login works.');
console.log('  3. Trigger a Production E2E run:');
console.log('       gh workflow run "Production E2E" -f suite=ui');
