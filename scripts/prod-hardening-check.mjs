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
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
