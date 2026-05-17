// Audit L-N2 — Node 20+ has built-in fetch; node-fetch dep removed.

export type EmailDeliveryStatus = 'sent' | 'skipped' | 'failed';

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  provider: 'resend' | 'none';
  message_id?: string;
  error?: string;
}

export interface InviteEmailInput {
  to: string;
  condoName: string;
  inviteCode: string;
  unitNumber: string;
  relationship: string;
  senderName?: string;
}

export interface VerificationEmailInput {
  to: string;
  firstName?: string;
  verificationUrl: string;
}

export type EmailFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; text: () => Promise<string> }>;

export function appOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_ORIGIN || env.FRONTEND_ORIGIN || env.CORS_ORIGIN || 'http://localhost:3000';
  return configured.split(',')[0].trim().replace(/\/+$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmail(
  kind: 'invite' | 'verification',
  message: { to: string; subject: string; text: string; html: string },
  env: NodeJS.ProcessEnv,
  fetcher: EmailFetcher,
): Promise<EmailDeliveryResult> {
  const provider = env.EMAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : 'none');
  if (provider !== 'resend') {
    console.log(`[email] ${kind} skipped: email_not_configured`);
    return { status: 'skipped', provider: 'none', error: 'email_not_configured' };
  }

  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.log(`[email] ${kind} skipped: email_not_configured`);
    return { status: 'skipped', provider: 'resend', error: 'email_not_configured' };
  }

  let res: Awaited<ReturnType<EmailFetcher>>;
  try {
    res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'CondoOS/0.1',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
  } catch (err) {
    return {
      status: 'failed',
      provider: 'resend',
      error: err instanceof Error ? err.message : 'resend_send_failed',
    };
  }

  const raw = await res.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }

  if (!res.ok) {
    return { status: 'failed', provider: 'resend', error: body?.message || body?.error || raw || 'resend_send_failed' };
  }
  return { status: 'sent', provider: 'resend', message_id: body?.id };
}

export function buildInviteEmail(input: InviteEmailInput, env: NodeJS.ProcessEnv = process.env) {
  const origin = appOrigin(env);
  const loginUrl = `${origin}/login`;
  // Deep-link into the landing — the landing reads ?code= and forwards it into
  // the "Sou morador" CTA, which carries the code all the way through login
  // into the join wizard's first step pre-filled. Two paths are kept side-by-
  // side: invitees whose email matches what the board entered get auto-linked
  // on sign-in (loginUrl path); invitees with a different email or sharing the
  // mail with someone else can still tap through to claim their unit (joinUrl).
  const joinUrl = `${origin}/?code=${encodeURIComponent(input.inviteCode)}`;
  const subject = `You're invited to ${input.condoName} on CondoOS`;
  const adminName = input.senderName || 'The board';
  const text = [
    `${adminName} invited you to join ${input.condoName} on CondoOS.`,
    '',
    `Your unit: ${input.unitNumber}`,
    `Invite code: ${input.inviteCode}`,
    '',
    `Sign in at ${loginUrl} with this email - we'll connect you to your unit automatically.`,
    `Or skip ahead and join with the code already filled in: ${joinUrl}`,
  ].filter(Boolean).join('\n');
  const html = `
    <p>${escapeHtml(adminName)} invited you to join <strong>${escapeHtml(input.condoName)}</strong> on CondoOS.</p>
    <p><strong>Your unit:</strong> ${escapeHtml(input.unitNumber)}<br />
    <strong>Invite code:</strong> ${escapeHtml(input.inviteCode)}</p>
    <p><a href="${escapeHtml(loginUrl)}">Sign in to CondoOS</a> with this email and we'll connect you to your unit automatically.</p>
    <p>Or <a href="${escapeHtml(joinUrl)}">tap here to claim your unit</a> — your invite code is already filled in.</p>
  `;
  return { subject, text, html, loginUrl, joinUrl };
}

export function buildVerificationEmail(input: VerificationEmailInput) {
  const firstName = input.firstName?.trim() || 'there';
  const subject = 'Confirm your CondoOS email';
  const text = [
    `Hi ${firstName},`,
    '',
    'Confirm this email before creating a condominium on CondoOS:',
    input.verificationUrl,
    '',
    'If you did not create a CondoOS account, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Confirm this email before creating a condominium on CondoOS.</p>
    <p><a href="${escapeHtml(input.verificationUrl)}">Confirm my email</a></p>
    <p>If you did not create a CondoOS account, you can ignore this email.</p>
  `;
  return { subject, text, html };
}

export async function sendInviteEmail(
  input: InviteEmailInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: EmailFetcher = fetch as unknown as EmailFetcher,
): Promise<EmailDeliveryResult> {
  const email = buildInviteEmail(input, env);
  return sendEmail('invite', { to: input.to, ...email }, env, fetcher);
}

export async function sendVerificationEmail(
  input: VerificationEmailInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: EmailFetcher = fetch as unknown as EmailFetcher,
): Promise<EmailDeliveryResult> {
  const email = buildVerificationEmail(input);
  return sendEmail('verification', { to: input.to, ...email }, env, fetcher);
}
