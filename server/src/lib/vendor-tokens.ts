// Signed magic-link tokens for the vendor self-service portal.
//
// When the agent auto-dispatches a vendor outreach, the outbound
// WhatsApp message includes a link like:
//   https://condoos.app/v/42.abc123def456
// where 42 is the dispatch_id and abc123def456 is an HMAC-SHA256
// signature over (dispatch_id + ttl_epoch). The vendor opens the
// link, sees the ticket details, and submits accept/decline + cost
// + ETA — replacing the admin's manual "VendorResponseModal" step.
//
// Why HMAC instead of a token table:
//   - Stateless, no DB write on dispatch
//   - Deterministic — same token always verifies the same dispatch
//   - TTL baked in (7d) so old links auto-expire
//   - Server can rotate the secret to invalidate every outstanding
//     token in an emergency
//
// Token format: base64url("<expires_epoch>.<hmac>") where
//   hmac = HMAC-SHA256(secret, dispatch_id + "." + expires_epoch)
// expires_epoch is unix seconds. Both halves verified on each access.

import crypto from 'crypto';

const TOKEN_TTL_SECONDS = 7 * 24 * 3600; // 7 days

// SEC-4 — Separate VENDOR_TOKEN_SECRET from JWT_SECRET.
//
// Reusing JWT_SECRET coupled two distinct rotation policies: rotating
// the admin-session secret would silently invalidate every outstanding
// vendor magic-link, and vice versa. Worse, the dev fallback
// 'local-dev-fallback-secret-not-secure' was a known constant — meaning
// any Vercel preview deploy that hadn't set JWT_SECRET would accept
// vendor tokens forged offline.
//
// Behavior now:
//   1. Prefer VENDOR_TOKEN_SECRET when set. Required in production.
//   2. Fall back to JWT_SECRET (also required to be 32+ in prod) for
//      one deploy window — gives ops time to roll the new env var
//      without invalidating links from yesterday's dispatches.
//   3. Dev fallback is randomized per process, so cached/forged tokens
//      across preview deploys can't collide. This DOES mean restarting
//      the dev server invalidates outstanding test vendor links — which
//      is the correct dev-time behavior.
const DEV_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSecret(): string {
  const dedicated = process.env.VENDOR_TOKEN_SECRET || '';
  const shared = process.env.JWT_SECRET || '';

  if (process.env.NODE_ENV === 'production') {
    if (dedicated.length >= 32) return dedicated;
    // SEC-M1 (re-audit fix) — If VENDOR_TOKEN_SECRET is set but too
    // short, throw instead of silently falling back to JWT_SECRET.
    // The operator who set the dedicated var believes it's protecting
    // vendor tokens; silently using the shared secret defeats the
    // whole point of the split. An explicit boot failure is better
    // than wrong-but-working.
    if (dedicated.length > 0) {
      throw new Error(`VENDOR_TOKEN_SECRET is set but only ${dedicated.length} chars — must be >= 32. Either fix the value or unset it to fall back to JWT_SECRET.`);
    }
    if (shared.length >= 32) {
      // Transitional: log loudly so ops sees the migration is pending.
      // This warn fires once per token sign, which is noisy on purpose.
      console.warn('[vendor-tokens] VENDOR_TOKEN_SECRET not set — falling back to JWT_SECRET. Set VENDOR_TOKEN_SECRET before the next rotation.');
      return shared;
    }
    throw new Error('VENDOR_TOKEN_SECRET (or JWT_SECRET) must be >= 32 chars in production');
  }
  return dedicated || shared || DEV_FALLBACK_SECRET;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signRaw(dispatchId: number, expiresEpoch: number): string {
  const h = crypto.createHmac('sha256', getSecret());
  h.update(`${dispatchId}.${expiresEpoch}`);
  return b64url(h.digest()).slice(0, 32); // 32 chars = 192 bits, plenty for collision resistance
}

export function signDispatchToken(dispatchId: number, ttlSeconds = TOKEN_TTL_SECONDS): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const hmac = signRaw(dispatchId, expires);
  return `${expires}.${hmac}`;
}

export interface VerifyResult {
  ok: boolean;
  error?: 'malformed' | 'expired' | 'invalid';
}

export function verifyDispatchToken(dispatchId: number, token: string): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, error: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, error: 'malformed' };
  const expires = Number(parts[0]);
  if (!Number.isFinite(expires) || expires <= 0) return { ok: false, error: 'malformed' };
  if (Math.floor(Date.now() / 1000) > expires) return { ok: false, error: 'expired' };
  const expected = signRaw(dispatchId, expires);
  // Timing-safe compare. Both sides are b64url so we can do byte-level.
  // SEC-H2 (re-audit fix) — burn a constant-time compare even on
  // length mismatch so we don't leak "your HMAC has the wrong length"
  // vs "your HMAC has the right length but wrong bytes".
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return { ok: false, error: 'invalid' };
  }
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid' };
  return { ok: true };
}

// Build the full URL the vendor will click. Reads VENDOR_PORTAL_URL
// from env so we can override per-environment (prod vs dev); falls back
// to the frontend's origin. The URL points at a server route that
// renders a tiny HTML page — NOT the React app — so vendors on flaky
// mobile networks load it fast.
export function buildVendorPortalUrl(dispatchId: number): string {
  const base = (process.env.VENDOR_PORTAL_URL || process.env.CLIENT_ORIGIN || 'https://condoos-ten.vercel.app').replace(/\/$/, '');
  const token = signDispatchToken(dispatchId);
  return `${base}/v/${dispatchId}.${token}`;
}
