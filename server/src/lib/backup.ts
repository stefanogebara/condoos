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
import { createReadStream, createWriteStream } from 'fs';
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

async function inspectSqliteSnapshot(localSnapshot: string): Promise<Pick<BackupVerificationResult, 'integrity_check' | 'table_counts'>> {
  const Database = (await import('better-sqlite3')).default;
  const check = new Database(localSnapshot, { readonly: true });
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`integrity_check_failed: ${integrity.integrity_check}`);
    }
    const tableCounts: Record<string, number> = {};
    for (const table of ['condominiums', 'users', 'tickets', 'agent_runs']) {
      const row = check.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      tableCounts[table] = Number(row.count || 0);
    }
    return { integrity_check: integrity.integrity_check, table_counts: tableCounts };
  } finally {
    check.close();
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
  let selectedKey = key;
  let objectSize: number | undefined;

  try {
    if (!selectedKey) {
      const list = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${KEY_PREFIX}/` }));
      const latest = latestBackupObject((list.Contents || []) as _Object[]);
      if (!latest?.Key) return { ok: false, error: 'no_backup_objects' };
      selectedKey = latest.Key;
      objectSize = latest.Size;
    }

    if (!selectedKey.startsWith(`${KEY_PREFIX}/`) || !selectedKey.endsWith('.sqlite.gz')) {
      return { ok: false, error: 'invalid_backup_key' };
    }

    const localSnapshot = path.join(os.tmpdir(), `condoos-verify-${Date.now()}-${process.pid}.sqlite`);
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: selectedKey }));
      objectSize = Number(object.ContentLength || objectSize || 0) || undefined;
      await gunzipObjectBody(object.Body, localSnapshot);
      const stats = fs.statSync(localSnapshot);
      const inspected = await inspectSqliteSnapshot(localSnapshot);
      return {
        ok: true,
        key: selectedKey,
        object_size_bytes: objectSize,
        restored_size_bytes: stats.size,
        duration_ms: Date.now() - started,
        ...inspected,
      };
    } finally {
      try { fs.unlinkSync(localSnapshot); } catch { /* tmp already gone */ }
    }
  } catch (err) {
    return { ok: false, key: selectedKey, error: (err as Error).message || 'backup_verify_failed' };
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
