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

function getSecret(): string {
  // Reuse JWT_SECRET — vendor links live as long as a session does,
  // and we already validated this secret on startup. A separate
  // VENDOR_TOKEN_SECRET env can be added later if rotation policies
  // diverge between admin sessions and vendor links.
  const secret = process.env.JWT_SECRET || '';
  if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
    throw new Error('JWT_SECRET (used for vendor tokens) must be >= 32 chars in production');
  }
  // Dev fallback so local boot doesn't crash without env config.
  return secret || 'local-dev-fallback-secret-not-secure';
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
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, error: 'invalid' };
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
