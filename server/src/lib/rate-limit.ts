import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  key?: (req: Request) => string;
}

// Audit M3 — buckets are in-process memory. Effective today because the
// Fly deployment runs with min_machines_running=1 + auto_stop_machines=true,
// so all auth traffic hits a single machine. If we ever scale beyond a
// single VM (multi-region, multiple replicas) this map must be replaced
// with a shared store such as Redis or fly-replicache. The exposed
// resetRateLimits() helper is used by tests to clear the bucket between
// runs and is also a useful one-shot recovery if a bug fills the map.
const buckets = new Map<string, Bucket>();
export const RATE_LIMIT_BYPASS_HEADER = 'x-condoos-rate-limit-bypass';

function disabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === '1' || process.env.RATE_LIMIT_DISABLED === 'true';
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bypassed(req: Request): boolean {
  // Audit M6 / N2 — the previous version refused the bypass header outright
  // when NODE_ENV === 'production'. That broke the production E2E suites
  // (prod-e2e.yml, full-audit.yml production-safe job) that legitimately
  // need to issue >5 logins from the same egress IP. The actual security
  // boundary is already strong: a 32+ char secret compared with timingSafeEqual
  // means leaking the secret is the same risk as leaking any other Fly secret.
  // Refusing the bypass in production removed test capability without
  // meaningfully reducing attack surface — revert to relying on the secret
  // gate alone. The header still has zero effect when no secret is set.
  const secret = (process.env.RATE_LIMIT_BYPASS_SECRET || '').trim();
  if (secret.length < 32) return false;

  const value = req.get(RATE_LIMIT_BYPASS_HEADER);
  return typeof value === 'string' && safeEqual(value.trim(), secret);
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (disabled() || bypassed(req)) return next();

    const now = Date.now();
    const identity = options.key ? options.key(req) : clientIp(req);
    const key = `${options.keyPrefix}:${identity}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    current.count += 1;
    if (current.count <= options.max) return next();

    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: 'rate_limited',
      retry_after_seconds: retryAfter,
    });
  };
}

export function resetRateLimits() {
  buckets.clear();
}
