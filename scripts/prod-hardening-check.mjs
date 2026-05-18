#!/usr/bin/env node

const DEFAULT_API_URL = 'https://condoos-api.fly.dev/api';
const DEFAULT_CLIENT_URL = 'https://condoos-ten.vercel.app';

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
const clientURL = (argValue('--client-url') || process.env.PROD_CLIENT_URL || process.env.E2E_BASE_URL || DEFAULT_CLIENT_URL)
  .replace(/\/+$/, '');
const strictCaptcha = !hasFlag('--warn-only-captcha');
const requireDemoDisabled = hasFlag('--require-demo-disabled');

async function getJson(path) {
  const url = `${apiURL}${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CondoOS-prod-hardening-check/1.0' },
  });
  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${path} returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}: ${JSON.stringify(body)}`);
  }
  return body?.data ?? body;
}

function add(list, ok, message, details) {
  list.push({ ok, message, ...(details === undefined ? {} : { details }) });
}

function cspHasSource(csp, directive, source) {
  const parts = csp
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const rule = parts.find((part) => part.split(/\s+/)[0] === directive);
  if (!rule) return false;
  return rule.split(/\s+/).slice(1).includes(source);
}

async function main() {
  const checks = [];
  const warnings = [];

  const health = await getJson('/health');
  add(checks, health.ok === true && health.db === 'ok', 'API health and DB are OK', health);

  const config = await getJson('/auth/config');
  add(
    checks,
    config.email_verification_required_for_create_building === true,
    'Email verification is required before create-building',
    { email_verification_required_for_create_building: config.email_verification_required_for_create_building },
  );

  const captchaReady = !!config.turnstile_site_key && config.create_building_captcha_required === true;
  if (strictCaptcha) {
    add(checks, captchaReady, 'Turnstile captcha is configured and required for create-building', {
      turnstile_site_key_present: !!config.turnstile_site_key,
      create_building_captcha_required: config.create_building_captcha_required,
    });
  } else if (!captchaReady) {
    warnings.push({
      message: 'Turnstile captcha is not fully active; create-building relies on email verification + rate limit only.',
      details: {
        turnstile_site_key_present: !!config.turnstile_site_key,
        create_building_captcha_required: config.create_building_captcha_required,
      },
    });
  }

  const clientRes = await fetch(clientURL, {
    headers: { Accept: 'text/html', 'User-Agent': 'CondoOS-prod-hardening-check/1.0' },
  });
  const csp = clientRes.headers.get('content-security-policy') || '';
  const turnstileCspReady = clientRes.ok
    && cspHasSource(csp, 'script-src', 'https://challenges.cloudflare.com')
    && cspHasSource(csp, 'frame-src', 'https://challenges.cloudflare.com')
    && cspHasSource(csp, 'connect-src', 'https://challenges.cloudflare.com');
  add(checks, turnstileCspReady, 'Client CSP allows Turnstile script, frame, and connect origins', {
    client_status: clientRes.status,
    script_src_allows_turnstile: cspHasSource(csp, 'script-src', 'https://challenges.cloudflare.com'),
    frame_src_allows_turnstile: cspHasSource(csp, 'frame-src', 'https://challenges.cloudflare.com'),
    connect_src_allows_turnstile: cspHasSource(csp, 'connect-src', 'https://challenges.cloudflare.com'),
  });

  if (requireDemoDisabled) {
    add(checks, config.demo_enabled === false, 'Demo login is disabled in production', { demo_enabled: config.demo_enabled });
  } else if (config.demo_enabled) {
    warnings.push({
      message: 'Demo login is enabled. This is acceptable only for disposable demo deployments.',
      details: { demo_enabled: config.demo_enabled },
    });
  }

  const failures = checks.filter((c) => !c.ok);
  const result = {
    ok: failures.length === 0,
    api_url: apiURL,
    client_url: clientURL,
    strict_captcha: strictCaptcha,
    checks,
    warnings,
  };

  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) process.exit(1);
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
