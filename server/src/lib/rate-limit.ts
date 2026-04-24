import { NextFunction, Request, Response } from 'express';

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

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
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
