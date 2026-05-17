#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const CF_API = 'https://api.cloudflare.com/client/v4';
const DEFAULT_DOMAINS = [
  'condoos-ten.vercel.app',
  'condoos-stefanogebaras-projects.vercel.app',
];

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function splitCsv(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function redact(value) {
  if (!value) return null;
  if (value.length <= 10) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function cfRequest(path, init = {}) {
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Cloudflare returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok || body.success === false) {
    const errors = Array.isArray(body.errors) && body.errors.length
      ? body.errors.map((e) => `${e.code || 'error'}: ${e.message}`).join('; ')
      : JSON.stringify(body);
    throw new Error(`Cloudflare API ${path} failed (${res.status}): ${errors}`);
  }
  return body.result;
}

async function createWidget({ accountId, name, domains, mode }) {
  return cfRequest(`/accounts/${accountId}/challenges/widgets`, {
    method: 'POST',
    body: JSON.stringify({ name, domains, mode }),
  });
}

function setFlySecrets({ app, sitekey, secret }) {
  const result = spawnSync('flyctl', [
    'secrets',
    'set',
    '-a',
    app,
    `TURNSTILE_SITE_KEY=${sitekey}`,
    `TURNSTILE_SECRET_KEY=${secret}`,
    'CREATE_BUILDING_CAPTCHA_REQUIRED=1',
  ], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`flyctl secrets set failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function deployFly(app) {
  const result = spawnSync('flyctl', ['deploy', '-a', app], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`flyctl deploy failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function verifyHardening() {
  const result = spawnSync(process.execPath, ['scripts/prod-hardening-check.mjs'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`production hardening audit failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function main() {
  const accountId = argValue('--account-id') || requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const app = argValue('--fly-app') || process.env.FLY_APP || 'condoos-api';
  const name = argValue('--name') || process.env.TURNSTILE_WIDGET_NAME || 'CondoOS production create-building';
  const mode = argValue('--mode') || process.env.TURNSTILE_WIDGET_MODE || 'managed';
  const domains = splitCsv(argValue('--domains') || process.env.TURNSTILE_DOMAINS || DEFAULT_DOMAINS.join(','));
  const dryRun = hasFlag('--dry-run');
  const skipFly = hasFlag('--skip-fly');
  const skipDeploy = hasFlag('--skip-deploy');
  const skipVerify = hasFlag('--skip-verify');

  if (domains.length === 0) throw new Error('At least one Turnstile domain is required');
  if (domains.length > 10) throw new Error('Cloudflare Turnstile accepts at most 10 domains per widget');
  if (!['managed', 'invisible', 'non-interactive'].includes(mode)) {
    throw new Error('--mode must be managed, invisible, or non-interactive');
  }

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      account_id: redact(accountId),
      fly_app: app,
      widget: { name, mode, domains },
      actions: {
        create_cloudflare_widget: true,
        set_fly_secrets: !skipFly,
        deploy_fly: !skipFly && !skipDeploy,
        verify_hardening: !skipVerify,
      },
    }, null, 2));
    return;
  }

  const widget = await createWidget({ accountId, name, domains, mode });
  if (!widget?.sitekey || !widget?.secret) {
    throw new Error('Cloudflare did not return both sitekey and secret for the created widget');
  }

  console.log(JSON.stringify({
    ok: true,
    created_turnstile_widget: {
      name,
      mode,
      domains,
      sitekey: widget.sitekey,
      secret_present: true,
    },
  }, null, 2));

  if (!skipFly) {
    setFlySecrets({ app, sitekey: widget.sitekey, secret: widget.secret });
    if (!skipDeploy) deployFly(app);
  }

  if (!skipVerify) await verifyHardening();
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
