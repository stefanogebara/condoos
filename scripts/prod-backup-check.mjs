#!/usr/bin/env node

const DEFAULT_API_URL = 'https://condoos-api.fly.dev/api';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const apiURL = (argValue('--api-url') || process.env.PROD_API_URL || process.env.E2E_API_URL || DEFAULT_API_URL)
  .replace(/\/+$/, '');
const email = argValue('--email') || process.env.PROD_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL;
const password = argValue('--password') || process.env.PROD_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD;
const shouldRunBackup = hasFlag('--run');
const shouldRestoreDrill = hasFlag('--restore-drill') || shouldRunBackup;
const shouldVerifyBackup = hasFlag('--verify') || shouldRunBackup;
const requireConfigured = hasFlag('--require-configured');
const rateLimitBypassSecret =
  process.env.E2E_RATE_LIMIT_BYPASS_SECRET
  || process.env.CONDOOS_RATE_LIMIT_BYPASS_SECRET
  || process.env.RATE_LIMIT_BYPASS_SECRET;

async function jsonRequest(path, init = {}) {
  const res = await fetch(`${apiURL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'CondoOS-prod-backup-check/1.0',
      ...(rateLimitBypassSecret ? { 'x-condoos-rate-limit-bypass': rateLimitBypassSecret } : {}),
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${path} returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    const code = body?.error || body?.message || raw.slice(0, 120);
    throw new Error(`${path} returned ${res.status}: ${code}`);
  }
  return body?.data ?? body;
}

async function main() {
  if (!email || !password) {
    throw new Error('set PROD_ADMIN_EMAIL/PROD_ADMIN_PASSWORD or E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD');
  }

  const session = await jsonRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const token = session.token;
  if (!token) throw new Error('login response did not include a token');
  const auth = { Authorization: `Bearer ${token}` };

  const status = await jsonRequest('/admin/backup/status', { headers: auth });
  if (requireConfigured && !status.configured) {
    throw new Error('production backups are not configured');
  }

  let run = null;
  if (shouldRunBackup) {
    run = await jsonRequest('/admin/backup/run', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({}),
    });
    if (!run.ok) throw new Error(`backup run failed: ${run.error || 'unknown_error'}`);
    if (!run.key || !run.size_bytes) {
      throw new Error(`backup run returned incomplete metadata: ${JSON.stringify(run)}`);
    }
  }

  let verify = null;
  if (shouldVerifyBackup) {
    verify = await jsonRequest('/admin/backup/verify', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(run?.key ? { key: run.key } : {}),
    });
    if (!verify.ok) throw new Error(`backup verify failed: ${verify.error || 'unknown_error'}`);
    if (verify.integrity_check !== 'ok' || !verify.restored_size_bytes) {
      throw new Error(`backup verify returned incomplete integrity metadata: ${JSON.stringify(verify)}`);
    }
  }

  let restoreDrill = null;
  if (shouldRestoreDrill) {
    const restoreKey = run?.key || verify?.key;
    restoreDrill = await jsonRequest('/admin/backup/restore-drill', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(restoreKey ? { key: restoreKey } : {}),
    });
    if (!restoreDrill.ok) throw new Error(`backup restore drill failed: ${restoreDrill.error || 'unknown_error'}`);
    if (
      restoreDrill.integrity_check !== 'ok'
      || !restoreDrill.restored_size_bytes
      || restoreDrill.foreign_key_violations !== 0
      || restoreDrill.writable_probe !== true
      || !restoreDrill.schema_table_count
    ) {
      throw new Error(`backup restore drill returned incomplete restore metadata: ${JSON.stringify(restoreDrill)}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    api_url: apiURL,
    configured: !!status.configured,
    bucket_configured: !!status.bucket,
    retention_days: status.retention_days,
    last_attempt_at: status.last_attempt_at || null,
    ran_backup: !!run,
    backup_key: run?.key || null,
    backup_size_bytes: run?.size_bytes || null,
    backup_duration_ms: run?.duration_ms || null,
    backup_pruned: run?.pruned ?? null,
    verified_backup: !!verify,
    verified_key: verify?.key || null,
    verified_integrity_check: verify?.integrity_check || null,
    verified_object_size_bytes: verify?.object_size_bytes || null,
    verified_restored_size_bytes: verify?.restored_size_bytes || null,
    verified_table_counts: verify?.table_counts || null,
    verified_duration_ms: verify?.duration_ms || null,
    restore_drill: !!restoreDrill,
    restore_key: restoreDrill?.key || null,
    restore_integrity_check: restoreDrill?.integrity_check || null,
    restore_object_size_bytes: restoreDrill?.object_size_bytes || null,
    restore_restored_size_bytes: restoreDrill?.restored_size_bytes || null,
    restore_table_counts: restoreDrill?.table_counts || null,
    restore_foreign_key_violations: restoreDrill?.foreign_key_violations ?? null,
    restore_schema_table_count: restoreDrill?.schema_table_count || null,
    restore_writable_probe: restoreDrill?.writable_probe ?? null,
    restore_duration_ms: restoreDrill?.duration_ms || null,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    api_url: apiURL,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
