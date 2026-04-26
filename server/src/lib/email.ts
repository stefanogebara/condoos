import fetch from 'node-fetch';

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

type EmailFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; text: () => Promise<string> }>;

function appOrigin(env: NodeJS.ProcessEnv = process.env): string {
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

export function buildInviteEmail(input: InviteEmailInput, env: NodeJS.ProcessEnv = process.env) {
  const loginUrl = `${appOrigin(env)}/login`;
  const subject = `You're invited to ${input.condoName} on CondoOS`;
  const adminName = input.senderName || 'The board';
  const text = [
    `${adminName} invited you to join ${input.condoName} on CondoOS.`,
    '',
    `Your unit: ${input.unitNumber}`,
    `Invite code: ${input.inviteCode}`,
    '',
    `Sign in at ${loginUrl} with this email - we'll connect you to your unit automatically.`,
  ].filter(Boolean).join('\n');
  const html = `
    <p>${escapeHtml(adminName)} invited you to join <strong>${escapeHtml(input.condoName)}</strong> on CondoOS.</p>
    <p><strong>Your unit:</strong> ${escapeHtml(input.unitNumber)}<br />
    <strong>Invite code:</strong> ${escapeHtml(input.inviteCode)}</p>
    <p><a href="${escapeHtml(loginUrl)}">Sign in to CondoOS</a> with this email and we'll connect you to your unit automatically.</p>
  `;
  return { subject, text, html, loginUrl };
}

export async function sendInviteEmail(
  input: InviteEmailInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: EmailFetcher = fetch as unknown as EmailFetcher,
): Promise<EmailDeliveryResult> {
  const provider = env.EMAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : 'none');
  if (provider !== 'resend') {
    console.log('[email] invite skipped: email_not_configured');
    return { status: 'skipped', provider: 'none', error: 'email_not_configured' };
  }

  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.log('[email] invite skipped: email_not_configured');
    return { status: 'skipped', provider: 'resend', error: 'email_not_configured' };
  }

  const email = buildInviteEmail(input, env);
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
        to: [input.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
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
