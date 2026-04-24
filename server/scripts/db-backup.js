#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const command = process.argv[2];
const args = process.argv.slice(3);

function arg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function dbPath() {
  const configured = process.env.DB_PATH || './data/condoos.sqlite';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function ensureIntegrity(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    const value = Object.values(row)[0];
    if (value !== 'ok') throw new Error(`integrity_check failed: ${value}`);
  } finally {
    db.close();
  }
}

async function backup() {
  const source = dbPath();
  if (!fs.existsSync(source)) throw new Error(`DB not found: ${source}`);

  const outDir = path.resolve(process.cwd(), arg('--out-dir') || './backups');
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `condoos-${timestamp()}.sqlite`);

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  ensureIntegrity(dest);
  console.log(JSON.stringify({ ok: true, action: 'backup', source, dest }, null, 2));
}

function restore() {
  const source = path.resolve(process.cwd(), arg('--from') || '');
  if (!source || !fs.existsSync(source)) throw new Error('Usage: npm run db:restore -- --from <backup.sqlite>');
  ensureIntegrity(source);

  const target = dbPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(target)) {
    const safety = `${target}.pre-restore-${timestamp()}`;
    fs.copyFileSync(target, safety);
    console.log(JSON.stringify({ ok: true, action: 'safety_copy', file: safety }, null, 2));
  }
  fs.copyFileSync(source, target);
  ensureIntegrity(target);
  console.log(JSON.stringify({ ok: true, action: 'restore', source, target }, null, 2));
}

(async () => {
  try {
    if (command === 'backup') await backup();
    else if (command === 'restore') restore();
    else throw new Error('Usage: node scripts/db-backup.js <backup|restore>');
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
})();
