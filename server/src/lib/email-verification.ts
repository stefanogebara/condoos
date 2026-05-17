import { createHash, randomBytes } from 'crypto';
import db from '../db';
import {
  appOrigin,
  EmailDeliveryResult,
  EmailFetcher,
  sendVerificationEmail,
} from './email';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface EmailVerificationUser {
  id: number;
  email: string;
  first_name?: string | null;
  email_verified_at?: string | null;
}

export interface IssuedEmailVerification {
  expires_at: string;
  delivery: EmailDeliveryResult;
  verification_url?: string;
}

export interface ConsumeEmailVerificationResult {
  ok: boolean;
  user_id?: number;
  email_verified_at?: string;
  error?: 'invalid_or_used_token' | 'expired_token';
}

function boolEnv(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function emailVerificationRequiredForCreateBuilding(
  _user?: EmailVerificationUser | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = boolEnv(env.EMAIL_VERIFICATION_REQUIRED);
  if (explicit !== null) return explicit;
  return env.NODE_ENV === 'production';
}

export function isEmailVerified(user?: EmailVerificationUser | null): boolean {
  return !!user?.email_verified_at;
}

export function hashEmailVerificationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function buildEmailVerificationUrl(rawToken: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appOrigin(env)}/login?verify_email=${encodeURIComponent(rawToken)}`;
}

export function createEmailVerificationToken(
  userId: number,
  now: Date = new Date(),
): { token: string; expires_at: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`
  ).run(userId, hashEmailVerificationToken(token), expiresAt);
  return { token, expires_at: expiresAt };
}

export async function issueAndSendEmailVerification(
  user: EmailVerificationUser,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: EmailFetcher = fetch as unknown as EmailFetcher,
): Promise<IssuedEmailVerification> {
  if (isEmailVerified(user)) {
    return {
      expires_at: user.email_verified_at!,
      delivery: { status: 'skipped', provider: 'none', error: 'already_verified' },
    };
  }

  const issued = createEmailVerificationToken(user.id);
  const verificationUrl = buildEmailVerificationUrl(issued.token, env);
  db.prepare(
    `UPDATE users SET email_verification_sent_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(user.id);

  const delivery = await sendVerificationEmail({
    to: user.email,
    firstName: user.first_name || undefined,
    verificationUrl,
  }, env, fetcher);

  return {
    expires_at: issued.expires_at,
    delivery,
    verification_url: env.NODE_ENV === 'production' ? undefined : verificationUrl,
  };
}

export function consumeEmailVerificationToken(rawToken: string, now: Date = new Date()): ConsumeEmailVerificationResult {
  const token = rawToken.trim();
  if (!token || token.length > 2048) return { ok: false, error: 'invalid_or_used_token' };

  return db.transaction(() => {
    const row = db.prepare(
      `SELECT id, user_id, expires_at
       FROM email_verification_tokens
       WHERE token_hash = ? AND used_at IS NULL`
    ).get(hashEmailVerificationToken(token)) as { id: number; user_id: number; expires_at: string } | undefined;

    if (!row) return { ok: false, error: 'invalid_or_used_token' } as ConsumeEmailVerificationResult;
    if (Date.parse(row.expires_at) <= now.getTime()) {
      db.prepare(
        `UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(row.id);
      return { ok: false, error: 'expired_token' } as ConsumeEmailVerificationResult;
    }

    db.prepare(
      `UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(row.id);
    db.prepare(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           email_verification_sent_at = NULL
       WHERE id = ?`
    ).run(row.user_id);
    const user = db.prepare(
      `SELECT email_verified_at FROM users WHERE id = ?`
    ).get(row.user_id) as { email_verified_at: string } | undefined;

    return {
      ok: true,
      user_id: row.user_id,
      email_verified_at: user?.email_verified_at,
    } as ConsumeEmailVerificationResult;
  })();
}
