#!/usr/bin/env node
// Re-sync the e2e prod test accounts' password_hash column to a known
// value. Use this when GitHub Actions starts failing at /auth/login
// with `invalid_credentials` for one of the e2e-*@condoos.test
// accounts — that's a sign the prod DB and the GitHub secret have
// drifted apart (manual ops action, restored backup, etc).
//
// What this does, end-to-end:
//   1. Reads NEW_PASSWORD from --password flag or PROD_E2E_PASSWORD env.
//      Fails loudly if missing. Never falls back to a default —
//      we don't want to accidentally reset prod to a guessable value.
//   2. Generates a fresh bcrypt(12) hash locally.
//   3. SSHes into the prod Fly machine and runs an UPDATE statement
//      against /data/condoos.sqlite for all 3 e2e-* accounts.
//   4. Prints the affected row count so the operator can verify.
//
// What this does NOT do:
//   - It does NOT touch the GitHub Actions secrets. After running this
//     script, you must also `gh secret set E2E_ADMIN_PASSWORD --body
//     "$NEW_PASSWORD"` (and the resident/concierge variants) so CI
//     stays aligned with the prod DB.
//
// Usage:
//   node scripts/reset-e2e-prod-passwords.mjs --password 'new-passphrase'
//   PROD_E2E_PASSWORD='new-passphrase' node scripts/reset-e2e-prod-passwords.mjs
//
// Requires: flyctl on PATH, authenticated against the condoos-api app.

import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';

const APP = process.env.FLY_APP || 'condoos-api';
const DB_PATH = process.env.DB_PATH || '/data/condoos.sqlite';
const ACCOUNTS = [
  'e2e-admin@condoos.test',
  'e2e-resident@condoos.test',
  'e2e-concierge@condoos.test',
];

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

// Hash locally so the password never leaves this machine in plaintext
// — only the hash crosses the SSH wire to Fly.
const hash = bcrypt.hashSync(password, 12);

// Build a tiny Node program to run inside the Fly machine. We pass
// the hash + emails as positional argv to keep escaping sane (no
// double-shell quoting of the bcrypt hash, which contains $).
const remote = `
const Database = require('/app/node_modules/better-sqlite3');
const d = new Database('${DB_PATH}');
const stmt = d.prepare('UPDATE users SET password_hash = ? WHERE email = ?');
const hash = process.argv[1];
const emails = process.argv.slice(2);
const results = emails.map((e) => ({ email: e, changes: stmt.run(hash, e).changes }));
console.log(JSON.stringify(results, null, 2));
`.replace(/\n\s*/g, ' ').trim();

console.log(`Resetting password_hash for ${ACCOUNTS.length} accounts on ${APP}:${DB_PATH}…`);

const ssh = spawnSync('flyctl', [
  'ssh',
  'console',
  '--app', APP,
  '-C',
  // The remote command: node -e "<remote>" hash email1 email2 email3
  `sh -c "cd /app && node -e \\"${remote.replace(/"/g, '\\"')}\\" '${hash}' ${ACCOUNTS.map((e) => `'${e}'`).join(' ')}"`,
], { encoding: 'utf8' });

// flyctl emits "Connecting to..." and a Windows-only "Error: The handle is
// invalid." trailing message that has nothing to do with our query —
// filter to just our JSON output.
const stdout = (ssh.stdout || '').split('\n').filter((line) =>
  !line.startsWith('Connecting to') && !line.includes('Warning:') && !line.includes('handle is invalid'),
).join('\n').trim();

if (ssh.status !== 0 && !stdout.startsWith('[')) {
  console.error('flyctl ssh failed:');
  console.error(ssh.stderr || ssh.stdout);
  process.exit(1);
}

console.log(stdout);
console.log('\nNext steps:');
console.log('  1. Update GitHub Actions secrets to match this password:');
for (const role of ['ADMIN', 'RESIDENT', 'CONCIERGE']) {
  console.log(`       gh secret set E2E_${role}_PASSWORD --body "<the new password>"`);
}
console.log('  2. Trigger a Production E2E run to verify CI is aligned:');
console.log('       gh workflow run "Production E2E" -f suite=api');
