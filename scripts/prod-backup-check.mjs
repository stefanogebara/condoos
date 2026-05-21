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
