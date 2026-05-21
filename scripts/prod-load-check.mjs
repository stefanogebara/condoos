#!/usr/bin/env node

const DEFAULT_API_URL = 'https://condoos-api.fly.dev/api';
const DEFAULT_CLIENT_URL = 'https://condoos-ten.vercel.app';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

const apiURL = (argValue('--api-url') || process.env.PROD_API_URL || process.env.E2E_API_URL || DEFAULT_API_URL)
  .replace(/\/+$/, '');
const clientURL = (argValue('--client-url') || process.env.PROD_CLIENT_URL || process.env.E2E_BASE_URL || DEFAULT_CLIENT_URL)
  .replace(/\/+$/, '');
const email = argValue('--email') || process.env.PROD_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL;
const password = argValue('--password') || process.env.PROD_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD;
const iterations = Math.max(1, Number(argValue('--requests') || process.env.PROD_LOAD_REQUESTS || 72));
const concurrency = Math.max(1, Number(argValue('--concurrency') || process.env.PROD_LOAD_CONCURRENCY || 6));
const maxP95Ms = Math.max(100, Number(argValue('--max-p95-ms') || process.env.PROD_LOAD_MAX_P95_MS || 2500));
const rateLimitBypassSecret =
  process.env.E2E_RATE_LIMIT_BYPASS_SECRET
  || process.env.CONDOOS_RATE_LIMIT_BYPASS_SECRET
  || process.env.RATE_LIMIT_BYPASS_SECRET;
const vercelBypassSecret =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  || process.env.VERCEL_PROTECTION_BYPASS
  || process.env.VERCEL_BYPASS_SECRET;

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function timed(label, url, init = {}) {
  const started = performance.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/json',
      'User-Agent': 'CondoOS-prod-load-check/1.0',
      ...(rateLimitBypassSecret ? { 'x-condoos-rate-limit-bypass': rateLimitBypassSecret } : {}),
      ...(init.headers || {}),
    },
  });
  const elapsedMs = Math.round(performance.now() - started);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${label} returned ${res.status}: ${body.slice(0, 160)}`);
  }
  return { label, elapsed_ms: elapsedMs };
}

async function jsonRequest(path, init = {}) {
  const result = await timed(path, `${apiURL}${path}`, init);
  return result;
}

async function login() {
  if (!email || !password) {
    throw new Error('set PROD_ADMIN_EMAIL/PROD_ADMIN_PASSWORD or E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD');
  }
  const res = await fetch(`${apiURL}/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'CondoOS-prod-load-check/1.0',
      ...(rateLimitBypassSecret ? { 'x-condoos-rate-limit-bypass': rateLimitBypassSecret } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
  const raw = await res.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`/auth/login returned non-JSON (${res.status}): ${raw.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`/auth/login returned ${res.status}: ${body?.error || raw.slice(0, 160)}`);
  const token = body?.data?.token;
  if (!token) throw new Error('login response did not include a token');
  return token;
}

async function main() {
  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };

  const checks = [
    () => jsonRequest('/health'),
    () => jsonRequest('/auth/config'),
    () => timed('client:/', clientURL, {
      headers: {
        ...(vercelBypassSecret ? {
          'x-vercel-protection-bypass': vercelBypassSecret,
          'x-vercel-set-bypass-cookie': 'true',
        } : {}),
      },
    }),
    () => jsonRequest('/auth/me', { headers: auth }),
    () => jsonRequest('/onboarding/me', { headers: auth }),
    () => jsonRequest('/dashboard/actions', { headers: auth }),
    () => jsonRequest('/tickets/summary', { headers: auth }),
    () => jsonRequest('/proposals', { headers: auth }),
    () => jsonRequest('/announcements', { headers: auth }),
    () => jsonRequest('/meetings', { headers: auth }),
    () => jsonRequest('/finance/receivables', { headers: auth }),
    () => jsonRequest('/admin/integrations/status', { headers: auth }),
    () => jsonRequest('/admin/agent/queue/status', { headers: auth }),
  ];

  const results = [];
  let cursor = 0;
  let failures = 0;

  async function worker() {
    while (cursor < iterations) {
      const idx = cursor++;
      const check = checks[idx % checks.length];
      try {
        results.push(await check());
      } catch (err) {
        failures += 1;
        results.push({ label: `failure:${idx}`, elapsed_ms: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, iterations) }, () => worker()));

  const latencies = results.filter((r) => !r.error).map((r) => r.elapsed_ms);
  const byLabel = new Map();
  for (const result of results) {
    if (result.error) continue;
    const row = byLabel.get(result.label) || { count: 0, max_ms: 0 };
    row.count += 1;
    row.max_ms = Math.max(row.max_ms, result.elapsed_ms);
    byLabel.set(result.label, row);
  }
  const summary = {
    ok: failures === 0 && percentile(latencies, 95) <= maxP95Ms,
    api_url: apiURL,
    client_url: clientURL,
    requests: iterations,
    concurrency,
    failures,
    max_p95_ms: maxP95Ms,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    max_ms: latencies.length ? Math.max(...latencies) : 0,
    by_label: Object.fromEntries([...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b))),
    errors: results.filter((r) => r.error).slice(0, 5),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    api_url: apiURL,
    client_url: clientURL,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
