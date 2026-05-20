import { createHash } from 'crypto';
import db from '../db';

type SetupCodeSource = 'not_required' | 'env' | 'db';

export interface SetupCodeAccepted {
  ok: true;
  source: SetupCodeSource;
  setupCodeId?: number;
  label?: string | null;
  agencyName?: string | null;
}

export interface SetupCodeRejected {
  ok: false;
  status: number;
  error: 'setup_code_required' | 'invalid_setup_code' | 'setup_code_expired' | 'setup_code_exhausted';
}

export type SetupCodeCheck = SetupCodeAccepted | SetupCodeRejected;

function boolEnv(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function privateCreateBuildingRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = boolEnv(env.PRIVATE_CREATE_BUILDING_REQUIRED);
  return explicit ?? env.NODE_ENV === 'production';
}

export function normalizeSetupCode(code: string): string {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function hashSetupCode(code: string): string {
  return createHash('sha256').update(normalizeSetupCode(code)).digest('hex');
}

function envSetupCodes(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    String(env.PRIVATE_SETUP_CODES || '')
      .split(',')
      .map((code) => normalizeSetupCode(code))
      .filter(Boolean),
  );
}

export function checkPrivateSetupCode(input: string | null | undefined, env: NodeJS.ProcessEnv = process.env): SetupCodeCheck {
  if (!privateCreateBuildingRequired(env)) return { ok: true, source: 'not_required' };

  const code = normalizeSetupCode(input || '');
  if (!code) return { ok: false, status: 403, error: 'setup_code_required' };

  if (envSetupCodes(env).has(code)) {
    return { ok: true, source: 'env', label: 'environment_setup_code', agencyName: null };
  }

  const row = db.prepare(
    `SELECT id, label, agency_name, max_uses, used_count, expires_at, disabled_at
     FROM private_setup_codes
     WHERE code_hash = ?`
  ).get(hashSetupCode(code)) as {
    id: number;
    label: string | null;
    agency_name: string | null;
    max_uses: number;
    used_count: number;
    expires_at: string | null;
    disabled_at: string | null;
  } | undefined;

  if (!row || row.disabled_at) return { ok: false, status: 403, error: 'invalid_setup_code' };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, status: 403, error: 'setup_code_expired' };
  }
  if (row.used_count >= row.max_uses) {
    return { ok: false, status: 403, error: 'setup_code_exhausted' };
  }

  return {
    ok: true,
    source: 'db',
    setupCodeId: row.id,
    label: row.label,
    agencyName: row.agency_name,
  };
}

export function consumePrivateSetupCode(accepted: SetupCodeAccepted): SetupCodeCheck {
  if (accepted.source !== 'db' || !accepted.setupCodeId) return accepted;

  const result = db.prepare(
    `UPDATE private_setup_codes
     SET used_count = used_count + 1,
         last_used_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND disabled_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       AND used_count < max_uses`
  ).run(accepted.setupCodeId);

  if (result.changes === 0) {
    return { ok: false, status: 403, error: 'setup_code_exhausted' };
  }
  return accepted;
}
