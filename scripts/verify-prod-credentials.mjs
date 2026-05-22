#!/usr/bin/env node
// Pre-flight credential check for the Production E2E and Full Audit
// workflows. Runs before any browser/HTTP suite so a drifted GitHub
// secret produces a single clear failure instead of cascading 401s
// across 20+ tests.
//
// Probes each role's account against prod /auth/login. Logs a single
// PASS/FAIL line per role plus a summary. Exits 1 if any role fails.
// Designed to run fast (3 sequential logins, ~1s total) and never
// hit the rate limit (3 requests << 30/15min).

const apiURL = (process.env.E2E_API_URL || 'https://condoos-api.fly.dev/api').replace(/\/+$/, '');

const ROLES = [
  { role: 'admin', email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
  { role: 'resident', email: process.env.E2E_RESIDENT_EMAIL, password: process.env.E2E_RESIDENT_PASSWORD },
  { role: 'concierge', email: process.env.E2E_CONCIERGE_EMAIL, password: process.env.E2E_CONCIERGE_PASSWORD },
];

async function probe({ role, email, password }) {
  if (!email || !password) {
    return { role, ok: false, reason: `missing E2E_${role.toUpperCase()}_{EMAIL,PASSWORD} secret` };
  }
  let res;
  try {
    res = await fetch(`${apiURL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    return { role, ok: false, reason: `network error: ${err.message}` };
  }
  const body = await res.text().catch(() => '');
  if (res.ok) return { role, ok: true };
  let parsedError = '';
  try {
    parsedError = JSON.parse(body)?.error || '';
  } catch { /* keep raw body */ }
  return {
    role,
    ok: false,
    reason: `${res.status} ${parsedError || body.slice(0, 120)}`,
  };
}

const results = [];
for (const r of ROLES) {
  // eslint-disable-next-line no-await-in-loop -- sequential by design to stay under rate limit
  const result = await probe(r);
  results.push(result);
  console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.role}${result.reason ? ' — ' + result.reason : ''}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error('');
  console.error('Prod credential drift detected. Likely fix:');
  console.error('  1. Run: node scripts/reset-e2e-prod-passwords.mjs --password "<new>"');
  console.error('  2. Then: gh secret set E2E_{ADMIN,RESIDENT,CONCIERGE}_PASSWORD --body "<same>"');
  console.error('  3. Re-trigger this workflow.');
  console.error('See docs/ops.md#e2e-credential-drift for details.');
  process.exit(1);
}
console.log('\nAll 3 prod e2e credentials verified.');
