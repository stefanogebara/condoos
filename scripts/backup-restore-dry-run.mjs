#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');
const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
const Database = requireFromServer('better-sqlite3');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'condoos-backup-restore-'));
const dbPath = path.join(tempDir, 'dry-run.sqlite');
const backupDir = path.join(tempDir, 'backups');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    shell: options.shell ?? (process.platform === 'win32' && command.endsWith('.cmd')),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function integrityCheck(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    const value = Object.values(row)[0];
    if (value !== 'ok') throw new Error(`integrity_check failed: ${value}`);
  } finally {
    db.close();
  }
}

try {
  fs.mkdirSync(backupDir, { recursive: true });
  const env = { DB_PATH: dbPath, NODE_ENV: 'test' };

  run(npmBin, ['--prefix', serverDir, 'run', 'seed'], { env });
  integrityCheck(dbPath);

  run(process.execPath, [path.join(serverDir, 'scripts', 'db-backup.js'), 'backup', '--out-dir', backupDir], {
    cwd: serverDir,
    env,
  });
  const backupFile = fs.readdirSync(backupDir)
    .filter((file) => file.endsWith('.sqlite'))
    .map((file) => path.join(backupDir, file))
    .sort()
    .at(-1);
  if (!backupFile) throw new Error('backup command did not create a sqlite file');
  integrityCheck(backupFile);

  const mutate = new Database(dbPath);
  try {
    mutate.prepare(`UPDATE condominiums SET name = ? WHERE name = ?`).run('BROKEN DRY RUN', 'Pine Ridge Towers');
  } finally {
    mutate.close();
  }

  run(process.execPath, [path.join(serverDir, 'scripts', 'db-backup.js'), 'restore', '--from', backupFile], {
    cwd: serverDir,
    env,
  });
  integrityCheck(dbPath);

  const verify = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = verify.prepare(`SELECT name FROM condominiums LIMIT 1`).get();
    if (row?.name !== 'Pine Ridge Towers') {
      throw new Error(`restore did not recover seeded condo name; got ${JSON.stringify(row)}`);
    }
  } finally {
    verify.close();
  }

  console.log(JSON.stringify({ ok: true, dbPath, backupDir, backupFile }, null, 2));
} finally {
  if (process.env.KEEP_OPS_DRY_RUN_ARTIFACTS !== '1') {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
