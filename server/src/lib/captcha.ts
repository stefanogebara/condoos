export interface CaptchaPublicConfig {
  turnstile_site_key: string | null;
  create_building_captcha_required: boolean;
}

export interface CaptchaVerificationResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: 'captcha_required' | 'captcha_not_configured' | 'captcha_unavailable' | 'captcha_failed';
  error_codes?: string[];
}

type CaptchaFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; text: () => Promise<string> }>;

interface CaptchaConfig {
  siteKey: string | null;
  secretKey: string | null;
  required: boolean;
}

function boolEnv(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function getCaptchaConfig(env: NodeJS.ProcessEnv = process.env): CaptchaConfig {
  const siteKey = (env.TURNSTILE_SITE_KEY || env.CAPTCHA_SITE_KEY || '').trim() || null;
  const secretKey = (env.TURNSTILE_SECRET_KEY || env.CAPTCHA_SECRET_KEY || '').trim() || null;
  const explicitRequired = boolEnv(env.CREATE_BUILDING_CAPTCHA_REQUIRED || env.CAPTCHA_REQUIRED);
  return {
    siteKey,
    secretKey,
    // If a secret is installed, protect the endpoint by default. If ops wants
    // a dry-run deploy with keys present, they must explicitly set ...=0.
    required: explicitRequired ?? !!secretKey,
  };
}

export function getCaptchaPublicConfig(env: NodeJS.ProcessEnv = process.env): CaptchaPublicConfig {
  const cfg = getCaptchaConfig(env);
  return {
    turnstile_site_key: cfg.siteKey,
    create_building_captcha_required: cfg.required,
  };
}

function captchaBypassed(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'test' || env.RATE_LIMIT_DISABLED === '1';
}

export async function verifyCreateBuildingCaptcha(
  token: string | undefined | null,
  remoteIp: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: CaptchaFetcher = fetch as unknown as CaptchaFetcher,
): Promise<CaptchaVerificationResult> {
  if (captchaBypassed(env)) return { ok: true, skipped: true };

  const cfg = getCaptchaConfig(env);
  if (!cfg.required) return { ok: true, skipped: true };
  if (!cfg.secretKey || !cfg.siteKey) {
    return { ok: false, status: 500, error: 'captcha_not_configured' };
  }

  const response = (token || '').trim();
  if (!response) return { ok: false, status: 403, error: 'captcha_required' };
  if (response.length > 2048) return { ok: false, status: 403, error: 'captcha_failed', error_codes: ['token_too_long'] };

  let res: Awaited<ReturnType<CaptchaFetcher>>;
  try {
    res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CondoOS/0.1',
      },
      body: JSON.stringify({
        secret: cfg.secretKey,
        response,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
  } catch (err) {
    console.warn('[captcha] turnstile verification request failed', err instanceof Error ? err.message : err);
    return { ok: false, status: 502, error: 'captcha_unavailable' };
  }

  const raw = await res.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }

  if (!res.ok) {
    console.warn('[captcha] turnstile verification HTTP failure', res.ok, body?.['error-codes'] || body?.error || raw);
    return { ok: false, status: 502, error: 'captcha_unavailable' };
  }
  if (body?.success === true) return { ok: true };

  const errorCodes = Array.isArray(body?.['error-codes']) ? body['error-codes'].map(String) : undefined;
  return { ok: false, status: 403, error: 'captcha_failed', error_codes: errorCodes };
}
