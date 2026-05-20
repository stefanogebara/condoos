#!/usr/bin/env node

const { createHash, randomBytes } = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

function arg(name) {
  const prefixed = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefixed));
  return hit ? hit.slice(prefixed.length) : '';
}

function normalize(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function hash(code) {
  return createHash('sha256').update(normalize(code)).digest('hex');
}

function randomCode() {
  return `CONDOS-${randomBytes(4).toString('hex').toUpperCase()}`;
}

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../data/condoos.sqlite');
const code = normalize(arg('code') || randomCode());
const label = arg('label') || 'Sales setup code';
const agencyName = arg('agency') || null;
const maxUses = Math.max(1, Number(arg('max-uses') || 1));
const expiresAt = arg('expires-at') || null;

if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
  console.error('Invalid --expires-at. Use an ISO date, for example 2026-06-30T23:59:59Z');
  process.exit(1);
}

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS private_setup_codes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash      TEXT NOT NULL UNIQUE,
    label          TEXT,
    agency_name    TEXT,
    max_uses       INTEGER NOT NULL DEFAULT 1 CHECK(max_uses >= 1),
    used_count     INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
    expires_at     TEXT,
    disabled_at    TEXT,
    created_by_user_id INTEGER,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at   TEXT
  );
`);
db.prepare(`
  INSERT INTO private_setup_codes (code_hash, label, agency_name, max_uses, expires_at)
  VALUES (?, ?, ?, ?, ?)
`).run(hash(code), label, agencyName, maxUses, expiresAt);

console.log(JSON.stringify({
  ok: true,
  db_path: dbPath,
  code,
  label,
  agency_name: agencyName,
  max_uses: maxUses,
  expires_at: expiresAt,
}, null, 2));
