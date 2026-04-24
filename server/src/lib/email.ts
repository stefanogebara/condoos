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
  const joinUrl = `${appOrigin(env)}/onboarding/join?code=${encodeURIComponent(input.inviteCode)}`;
  const subject = `You're invited to ${input.condoName} on CondoOS`;
  const text = [
    `You've been invited to join ${input.condoName} on CondoOS.`,
    '',
    `Unit: ${input.unitNumber}`,
    `Relationship: ${input.relationship}`,
    input.senderName ? `Sent by: ${input.senderName}` : '',
    '',
    `Join here: ${joinUrl}`,
  ].filter(Boolean).join('\n');
  const html = `
    <p>You've been invited to join <strong>${escapeHtml(input.condoName)}</strong> on CondoOS.</p>
    <p><strong>Unit:</strong> ${escapeHtml(input.unitNumber)}<br />
    <strong>Relationship:</strong> ${escapeHtml(input.relationship)}</p>
    <p><a href="${escapeHtml(joinUrl)}">Join your building</a></p>
  `;
  return { subject, text, html, joinUrl };
}

export async function sendInviteEmail(
  input: InviteEmailInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: EmailFetcher = fetch as unknown as EmailFetcher,
): Promise<EmailDeliveryResult> {
  const provider = env.EMAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : 'none');
  if (provider !== 'resend') return { status: 'skipped', provider: 'none', error: 'email_not_configured' };

  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) return { status: 'skipped', provider: 'resend', error: 'email_not_configured' };

  const email = buildInviteEmail(input, env);
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });

  const raw = await res.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }

  if (!res.ok) {
    return { status: 'failed', provider: 'resend', error: body?.message || body?.error || raw || 'resend_send_failed' };
  }
  return { status: 'sent', provider: 'resend', message_id: body?.id };
}
