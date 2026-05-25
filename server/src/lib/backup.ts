// Nightly SQLite backup to S3-compatible storage (Cloudflare R2 / AWS S3 / etc).
//
// Why this exists: CondoOS runs on a single Fly machine with a single
// /data volume. If that machine + volume die together (which Fly's docs
// explicitly say is possible), every line of work — tickets, votes,
// finance, agent runs — goes with it. A daily off-site snapshot is the
// cheapest insurance available.
//
// What it does: every ~24h, run an ONLINE consistent snapshot via
// better-sqlite3's db.backup() (zero downtime, no locks held against
// writers), gzip it, upload it under a date-stamped key, and sweep
// objects older than the retention window.
//
// Graceful when not configured: if neither BACKUP_S3_* nor R2_* storage
// credentials are set, the scheduler logs once and stays idle. No crashes,
// no noise.

import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { createReadStream, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { createGunzip, createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  _Object,
} from '@aws-sdk/client-s3';
import db from '../db';

// Prefer dedicated backup credentials when present. For a lean pilot, fall
// back to the already-configured private R2 upload bucket so off-site backups
// are not blocked on a second Cloudflare credential set.
const BUCKET = process.env.BACKUP_S3_BUCKET || process.env.R2_BUCKET || '';
const ENDPOINT = process.env.BACKUP_S3_ENDPOINT || process.env.R2_ENDPOINT || undefined; // R2 needs this; AWS S3 leaves undefined
const REGION = process.env.BACKUP_S3_REGION || process.env.R2_REGION || 'auto';
const ACCESS_KEY = process.env.BACKUP_S3_ACCESS_KEY || process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.BACKUP_S3_SECRET_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const KEY_PREFIX = (process.env.BACKUP_S3_KEY_PREFIX || 'condoos-sqlite').replace(/\/$/, '');
const RETENTION_DAYS = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 30));
// Daily cadence + 12h buffer for clock drift / a single missed run.
// Bumping past 36h means a fully missed day passes silently.
const STALE_THRESHOLD_HOURS = Math.max(1, Number(process.env.BACKUP_STALE_HOURS || 36));

export function backupConfigured(): boolean {
  return !!(BUCKET && ACCESS_KEY && SECRET_KEY);
}

function s3Client(): S3Client {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: !!ENDPOINT, // R2/MinIO require path-style; AWS doesn't care
  });
}

export interface BackupResult {
  ok: boolean;
  key?: string;
  size_bytes?: number;
  duration_ms?: number;
  pruned?: number;
  error?: string;
}

export interface BackupVerificationResult {
  ok: boolean;
  key?: string;
  object_size_bytes?: number;
  restored_size_bytes?: number;
  duration_ms?: number;
  integrity_check?: string;
  table_counts?: Record<string, number>;
  error?: string;
}

export interface BackupRestoreDrillResult extends BackupVerificationResult {
  foreign_key_violations?: number;
  schema_table_count?: number;
  writable_probe?: boolean;
}

export interface BackupRestoreBootDrillResult extends BackupRestoreDrillResult {
  booted?: boolean;
  boot_health_ok?: boolean;
  boot_status_code?: number;
  boot_db?: string;
  boot_port?: number;
  boot_duration_ms?: number;
  boot_entry?: string;
}

function latestBackupObject(objects: _Object[]): _Object | null {
  const candidates = objects
    .filter((obj) => obj.Key?.startsWith(`${KEY_PREFIX}/`) && obj.Key.endsWith('.sqlite.gz'))
    .sort((a, b) => {
      const aTime = a.LastModified?.getTime() || 0;
      const bTime = b.LastModified?.getTime() || 0;
      if (aTime !== bTime) return bTime - aTime;
      return String(b.Key || '').localeCompare(String(a.Key || ''));
    });
  return candidates[0] || null;
}

async function gunzipObjectBody(body: unknown, destination: string): Promise<void> {
  if (!body) throw new Error('backup_object_empty');
  if (typeof (body as NodeJS.ReadableStream).pipe === 'function') {
    await pipeline(body as NodeJS.ReadableStream, createGunzip(), createWriteStream(destination));
    return;
  }
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    await pipeline(Readable.from(Buffer.from(bytes)), createGunzip(), createWriteStream(destination));
    return;
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array || typeof body === 'string') {
    await pipeline(Readable.from(Buffer.from(body as Buffer | Uint8Array | string)), createGunzip(), createWriteStream(destination));
    return;
  }
  throw new Error('backup_object_body_unsupported');
}

async function resolveBackupObject(client: S3Client, key?: string): Promise<{ key: string; object_size_bytes?: number }> {
  let selectedKey = key;
  let objectSize: number | undefined;

  if (!selectedKey) {
    const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${KEY_PREFIX}/` }));
    const latest = latestBackupObject((list.Contents || []) as _Object[]);
    if (!latest?.Key) throw new Error('no_backup_objects');
    selectedKey = latest.Key;
    objectSize = latest.Size;
  }

  if (!selectedKey.startsWith(`${KEY_PREFIX}/`) || !selectedKey.endsWith('.sqlite.gz')) {
    throw new Error('invalid_backup_key');
  }

  return { key: selectedKey, object_size_bytes: objectSize };
}

async function downloadBackupSnapshot(
  client: S3Client,
  key: string,
  localSnapshot: string,
  objectSize?: number,
): Promise<{ object_size_bytes?: number; restored_size_bytes: number }> {
  const object = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const downloadedObjectSize = Number(object.ContentLength || objectSize || 0) || undefined;
  await gunzipObjectBody(object.Body, localSnapshot);
  const stats = fs.statSync(localSnapshot);
  return { object_size_bytes: downloadedObjectSize, restored_size_bytes: stats.size };
}

function cleanupSqliteTempFiles(localSnapshot: string): void {
  for (const p of [localSnapshot, `${localSnapshot}-wal`, `${localSnapshot}-shm`, `${localSnapshot}-journal`]) {
    try { fs.unlinkSync(p); } catch { /* tmp already gone */ }
  }
}

function countCoreTables(check: { prepare: (sql: string) => { get: () => unknown } }): Record<string, number> {
  const tableCounts: Record<string, number> = {};
  for (const table of ['condominiums', 'users', 'tickets', 'agent_runs']) {
    const row = check.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    tableCounts[table] = Number(row.count || 0);
  }
  return tableCounts;
}

async function inspectSqliteSnapshot(localSnapshot: string): Promise<Pick<BackupVerificationResult, 'integrity_check' | 'table_counts'>> {
  const Database = (await import('better-sqlite3')).default;
  const check = new Database(localSnapshot, { readonly: true });
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`integrity_check_failed: ${integrity.integrity_check}`);
    }
    return { integrity_check: integrity.integrity_check, table_counts: countCoreTables(check) };
  } finally {
    check.close();
  }
}

async function drillSqliteSnapshot(localSnapshot: string): Promise<Pick<
  BackupRestoreDrillResult,
  'integrity_check' | 'table_counts' | 'foreign_key_violations' | 'schema_table_count' | 'writable_probe'
>> {
  const Database = (await import('better-sqlite3')).default;
  const check = new Database(localSnapshot);
  try {
    check.pragma('foreign_keys = ON');
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`integrity_check_failed: ${integrity.integrity_check}`);
    }

    const foreignKeyViolations = check.prepare('PRAGMA foreign_key_check').all().length;
    if (foreignKeyViolations > 0) {
      throw new Error(`foreign_key_check_failed: ${foreignKeyViolations}`);
    }

    const tableCounts = countCoreTables(check);
    const schema = check.prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`
    ).get() as { count: number };

    const probeTable = `restore_drill_write_probe_${Date.now()}_${process.pid}`;
    const writeProbe = check.transaction(() => {
      check.exec(`
        CREATE TABLE ${probeTable} (
          id INTEGER PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO ${probeTable} DEFAULT VALUES;
        DROP TABLE ${probeTable};
      `);
    });
    writeProbe();

    return {
      integrity_check: integrity.integrity_check,
      table_counts: tableCounts,
      foreign_key_violations: foreignKeyViolations,
      schema_table_count: Number(schema.count || 0),
      writable_probe: true,
    };
  } finally {
    check.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allocateLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        if (!port) reject(new Error('restore_boot_port_unavailable'));
        else resolve(port);
      });
    });
  });
}

function restoreBootEntry(): { args: string[]; cwd: string; label: string } {
  const configured = process.env.RESTORE_BOOT_ENTRY;
  if (configured) {
    const absolute = path.resolve(configured);
    if (!fs.existsSync(absolute)) throw new Error('restore_boot_entry_not_found');
    return { args: [absolute], cwd: path.dirname(absolute), label: absolute };
  }

  const distEntry = path.resolve(__dirname, '..', 'server.js');
  if (fs.existsSync(distEntry)) {
    return { args: [distEntry], cwd: path.resolve(path.dirname(distEntry), '..'), label: distEntry };
  }

  const tsEntry = path.resolve(__dirname, '..', 'server.ts');
  if (fs.existsSync(tsEntry)) {
    return { args: ['-r', 'ts-node/register', tsEntry], cwd: path.resolve(path.dirname(tsEntry), '..'), label: tsEntry };
  }

  throw new Error('restore_boot_entry_not_found');
}

function captureStreamTail(stream: NodeJS.ReadableStream, maxBytes = 4_000): () => string {
  let tail = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    tail = (tail + String(chunk)).slice(-maxBytes);
  });
  return () => tail.trim();
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<{ status: number; body: any; raw: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const raw = await res.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
    return { status: res.status, body, raw };
  } finally {
    clearTimeout(timeout);
  }
}

async function bootRestoredApi(localSnapshot: string): Promise<Pick<
  BackupRestoreBootDrillResult,
  'booted' | 'boot_health_ok' | 'boot_status_code' | 'boot_db' | 'boot_port' | 'boot_duration_ms' | 'boot_entry'
>> {
  const started = Date.now();
  const port = await allocateLocalPort();
  const entry = restoreBootEntry();
  const timeoutMs = Math.min(120_000, Math.max(5_000, Number(process.env.RESTORE_BOOT_DRILL_TIMEOUT_MS || 45_000)));
  const child = spawn(process.execPath, entry.args, {
    cwd: entry.cwd,
    env: {
      ...process.env,
      DB_PATH: localSnapshot,
      PORT: String(port),
      NODE_ENV: 'test',
      // Keep the child strictly local and inert. NODE_ENV=test prevents
      // schedulers/workers; these remove any remaining external side effects.
      DEMO_AUTH_ENABLED: '',
      ALLOW_DEMO_AUTH_IN_PRODUCTION: '',
      OPENROUTER_API_KEY: '',
      RESEND_API_KEY: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      WAHA_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutTail = captureStreamTail(child.stdout);
  const stderrTail = captureStreamTail(child.stderr);
  let exitState: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: Error | null = null;
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null } | null>((resolve) => {
    child.once('exit', (code, signal) => {
      exitState = { code, signal };
      resolve(exitState);
    });
  });
  child.once('error', (err) => {
    spawnError = err;
  });

  let lastError = 'not_started';
  try {
    while (Date.now() - started < timeoutMs) {
      if (spawnError) throw spawnError;
      if (exitState) {
        throw new Error(`restore_boot_process_exited code=${exitState.code} signal=${exitState.signal} stderr=${stderrTail() || stdoutTail()}`);
      }

      try {
        const health = await fetchJsonWithTimeout(`http://127.0.0.1:${port}/api/health`, 1_000);
        lastError = `status=${health.status} body=${health.raw.slice(0, 300)}`;
        if (health.status === 200 && health.body?.ok === true && health.body?.db === 'ok') {
          return {
            booted: true,
            boot_health_ok: true,
            boot_status_code: health.status,
            boot_db: health.body.db,
            boot_port: port,
            boot_duration_ms: Date.now() - started,
            boot_entry: entry.label,
          };
        }
      } catch (err) {
        lastError = (err as Error).message || String(err);
      }
      await sleep(250);
    }

    throw new Error(`restore_boot_health_timeout: ${lastError}; stdout=${stdoutTail() || 'empty'}; stderr=${stderrTail() || 'empty'}`);
  } finally {
    if (!exitState) {
      child.kill('SIGTERM');
      const stopped = await Promise.race([
        exitPromise,
        sleep(2_000).then(() => null),
      ]);
      if (!stopped && !exitState) {
        child.kill('SIGKILL');
        await Promise.race([exitPromise, sleep(1_000)]);
      }
    }
  }
}

export async function runBackup(): Promise<BackupResult> {
  if (!backupConfigured()) return { ok: false, error: 'not_configured' };
  const started = Date.now();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tmpDir = os.tmpdir();
  const localSnapshot = path.join(tmpDir, `condoos-${ts}.sqlite`);
  const localGz = `${localSnapshot}.gz`;

  try {
    // 1. Online consistent snapshot. better-sqlite3's backup() runs the
    //    SQLite Online Backup API — copies pages while writers continue,
    //    yields a fully consistent file. No app-level lock.
    await (db as any).backup(localSnapshot);

    // 2. Gzip. SQLite files compress 60-80% — meaningful for both
    //    storage cost and upload bandwidth, even on a tiny pilot DB.
    await pipeline(createReadStream(localSnapshot), createGzip(), createWriteStream(localGz));

    // 3. Sanity-check the snapshot can be read back. A backup we can't
    //    open is worse than no backup — silently rotten. Open + count
    //    one core table; cheap, proves the file isn't truncated.
    try {
      const Database = (await import('better-sqlite3')).default;
      const check = new Database(localSnapshot, { readonly: true });
      check.prepare('SELECT COUNT(*) FROM condominiums').get();
      check.close();
    } catch (err) {
      return { ok: false, error: `snapshot_unreadable: ${(err as Error).message}` };
    }

    // 4. Upload.
    const client = s3Client();
    const key = `${KEY_PREFIX}/condoos-${ts}.sqlite.gz`;
    const body = fs.readFileSync(localGz);
    await client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
    }));

    // 5. Retention sweep. List under the prefix, delete anything older
    //    than RETENTION_DAYS. Bounded per-call: we cap at the first
    //    1000 keys so a misconfigured prefix can't spiral.
    let pruned = 0;
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${KEY_PREFIX}/` }));
    for (const obj of (list.Contents || []) as _Object[]) {
      if (obj.LastModified && obj.LastModified.getTime() < cutoff && obj.Key) {
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
        pruned += 1;
      }
    }

    return { ok: true, key, size_bytes: body.length, duration_ms: Date.now() - started, pruned };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'backup_failed' };
  } finally {
    // Always clean up local tmpfiles, even on partial failure.
    for (const p of [localSnapshot, localGz]) {
      try { fs.unlinkSync(p); } catch { /* tmp already gone */ }
    }
  }
}

export async function verifyBackupObject(key?: string): Promise<BackupVerificationResult> {
  if (!backupConfigured()) return { ok: false, error: 'not_configured' };
  const started = Date.now();
  const client = s3Client();
  let selectedKey: string | undefined = key;

  try {
    const selected = await resolveBackupObject(client, key);
    selectedKey = selected.key;

    const localSnapshot = path.join(os.tmpdir(), `condoos-verify-${Date.now()}-${process.pid}.sqlite`);
    try {
      const downloaded = await downloadBackupSnapshot(client, selectedKey, localSnapshot, selected.object_size_bytes);
      const inspected = await inspectSqliteSnapshot(localSnapshot);
      return {
        ok: true,
        key: selectedKey,
        object_size_bytes: downloaded.object_size_bytes,
        restored_size_bytes: downloaded.restored_size_bytes,
        duration_ms: Date.now() - started,
        ...inspected,
      };
    } finally {
      cleanupSqliteTempFiles(localSnapshot);
    }
  } catch (err) {
    return { ok: false, key: selectedKey, error: (err as Error).message || 'backup_verify_failed' };
  }
}

export async function runRestoreDrill(key?: string): Promise<BackupRestoreDrillResult> {
  if (!backupConfigured()) return { ok: false, error: 'not_configured' };
  const started = Date.now();
  const client = s3Client();
  let selectedKey: string | undefined = key;

  try {
    const selected = await resolveBackupObject(client, key);
    selectedKey = selected.key;

    const localSnapshot = path.join(os.tmpdir(), `condoos-restore-drill-${Date.now()}-${process.pid}.sqlite`);
    try {
      const downloaded = await downloadBackupSnapshot(client, selectedKey, localSnapshot, selected.object_size_bytes);
      const drilled = await drillSqliteSnapshot(localSnapshot);
      return {
        ok: true,
        key: selectedKey,
        object_size_bytes: downloaded.object_size_bytes,
        restored_size_bytes: downloaded.restored_size_bytes,
        duration_ms: Date.now() - started,
        ...drilled,
      };
    } finally {
      cleanupSqliteTempFiles(localSnapshot);
    }
  } catch (err) {
    return { ok: false, key: selectedKey, error: (err as Error).message || 'backup_restore_drill_failed' };
  }
}

export async function runRestoreBootDrill(key?: string): Promise<BackupRestoreBootDrillResult> {
  if (!backupConfigured()) return { ok: false, error: 'not_configured' };
  const started = Date.now();
  const client = s3Client();
  let selectedKey: string | undefined = key;

  try {
    const selected = await resolveBackupObject(client, key);
    selectedKey = selected.key;

    const localSnapshot = path.join(os.tmpdir(), `condoos-restore-boot-${Date.now()}-${process.pid}.sqlite`);
    try {
      const downloaded = await downloadBackupSnapshot(client, selectedKey, localSnapshot, selected.object_size_bytes);
      const drilled = await drillSqliteSnapshot(localSnapshot);
      const booted = await bootRestoredApi(localSnapshot);
      return {
        ok: true,
        key: selectedKey,
        object_size_bytes: downloaded.object_size_bytes,
        restored_size_bytes: downloaded.restored_size_bytes,
        duration_ms: Date.now() - started,
        ...drilled,
        ...booted,
      };
    } finally {
      cleanupSqliteTempFiles(localSnapshot);
    }
  } catch (err) {
    return { ok: false, key: selectedKey, error: (err as Error).message || 'backup_restore_boot_drill_failed' };
  }
}

// State for the spend-visibility / health endpoint and for the
// idempotent startBackupScheduler() guard.
let scheduled = false;
let lastResult: BackupResult | null = null;
let lastAttemptAt: string | null = null;

export function getBackupStatus() {
  return {
    configured: backupConfigured(),
    bucket: BUCKET || null,
    retention_days: RETENTION_DAYS,
    last_attempt_at: lastAttemptAt,
    last_result: lastResult,
  };
}

export interface BackupFreshnessResult {
  ok: boolean;
  latest_object_key?: string;
  latest_object_at?: string;
  age_hours?: number;
  stale_threshold_hours: number;
  stale?: boolean;
  error?: string;
}

// Source-of-truth freshness check: the in-memory lastAttemptAt resets on
// every Fly machine restart, so it can lie after a deploy. The objects in
// the bucket don't. List them, find the newest, compute age. If the last
// successful backup is older than STALE_THRESHOLD_HOURS, the scheduler has
// stalled silently — which is what we want a daily audit job to catch.
export async function getBackupFreshness(): Promise<BackupFreshnessResult> {
  if (!backupConfigured()) {
    return { ok: false, stale_threshold_hours: STALE_THRESHOLD_HOURS, error: 'not_configured' };
  }
  try {
    const client = s3Client();
    const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${KEY_PREFIX}/` }));
    const latest = latestBackupObject((list.Contents || []) as _Object[]);
    if (!latest?.Key || !latest.LastModified) {
      // No objects yet — treat as stale so a fresh prod with a broken
      // scheduler doesn't quietly look "fine".
      return {
        ok: true,
        stale: true,
        stale_threshold_hours: STALE_THRESHOLD_HOURS,
        error: 'no_backup_objects',
      };
    }
    const ageMs = Date.now() - latest.LastModified.getTime();
    const ageHours = ageMs / 3_600_000;
    return {
      ok: true,
      latest_object_key: latest.Key,
      latest_object_at: latest.LastModified.toISOString(),
      age_hours: Number(ageHours.toFixed(2)),
      stale_threshold_hours: STALE_THRESHOLD_HOURS,
      stale: ageHours > STALE_THRESHOLD_HOURS,
    };
  } catch (err) {
    return {
      ok: false,
      stale_threshold_hours: STALE_THRESHOLD_HOURS,
      error: (err as Error).message || 'backup_freshness_failed',
    };
  }
}

// Compute ms until the next BACKUP_HOUR_UTC (default 03:00 UTC — a quiet
// slot in BRT and roughly midnight in São Paulo). Drifts at most a few
// seconds per day; we don't need second-precision.
function msUntilNextBackupHour(): number {
  const hour = Math.min(23, Math.max(0, Number(process.env.BACKUP_HOUR_UTC || 3)));
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startBackupScheduler(): void {
  if (scheduled) return;
  if (!backupConfigured()) {
    console.warn('[backup] not configured — set BACKUP_S3_* or R2_* storage credentials to enable nightly backups');
    return;
  }
  scheduled = true;
  console.log(`[backup] scheduler armed — next run in ${Math.round(msUntilNextBackupHour() / 60_000)} min`);

  const loop = () => {
    setTimeout(async () => {
      lastAttemptAt = new Date().toISOString();
      try {
        const result = await runBackup();
        lastResult = result;
        if (result.ok) {
          console.log(`[backup] ok ${result.key} · ${result.size_bytes} bytes · ${result.duration_ms}ms · pruned ${result.pruned}`);
        } else {
          console.warn(`[backup] failed: ${result.error}`);
        }
      } catch (err) {
        lastResult = { ok: false, error: (err as Error).message };
        console.error('[backup] threw:', (err as Error).message);
      }
      // Schedule the next run 24h from now (clock-drift is fine — daily
      // backups don't need second precision).
      setTimeout(loop, 24 * 3_600_000);
    }, msUntilNextBackupHour());
  };
  loop();
}
