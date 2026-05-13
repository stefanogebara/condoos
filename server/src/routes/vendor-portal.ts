// Public vendor self-service portal.
//
// A vendor receives a WhatsApp from the agent with a link like:
//   /v/42.<expires>.<hmac>
// They open it, see the ticket details + photos, and submit accept/
// decline with optional cost + ETA. The response lands directly in
// ticket_dispatches — no admin manual transcription needed.
//
// No auth — the HMAC token IS the auth. Each token is bound to a
// single dispatch_id, expires after 7 days, and can only modify that
// one row. Tokens never grant access to other tickets, vendors, or
// admin data.
//
// We serve raw HTML (not the React app) for two reasons:
//   1. Vendors hit this from mobile, often on bad networks — shave
//      300KB of JS.
//   2. The page should feel like a confirmation link, not "log in
//      to an app". Inline server-rendered HTML matches that vibe.

import { Router, type Request, type Response } from 'express';
import db from '../db';
import { z } from 'zod';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';
import { verifyDispatchToken } from '../lib/vendor-tokens';

const router = Router();

// Parse "<id>.<expires>.<hmac>" from the URL param. We accept the
// combined form because that's what the link builder emits.
function parseTokenParam(combined: string): { dispatchId: number; token: string } | null {
  if (!combined || typeof combined !== 'string') return null;
  const first = combined.indexOf('.');
  if (first < 0) return null;
  const id = Number(combined.slice(0, first));
  const rest = combined.slice(first + 1);
  if (!Number.isInteger(id) || id <= 0 || !rest) return null;
  return { dispatchId: id, token: rest };
}

// Minimal dispatch context for the vendor view. We deliberately omit
// the resident's name, full description (only first 240 chars), and
// any internal admin notes. The vendor sees enough to triage the job
// without learning anything about the building they shouldn't.
function loadDispatchForVendor(dispatchId: number) {
  return db.prepare(
    `SELECT d.id, d.ticket_id, d.status, d.message_body, d.created_at, d.responded_at, d.response_summary,
            t.title, t.description, t.category, t.priority,
            t.condominium_id, c.name AS condo_name, c.address AS condo_address,
            sc.company_name AS vendor_name, sc.contact_name AS vendor_contact_name
     FROM ticket_dispatches d
     JOIN tickets t            ON t.id  = d.ticket_id
     LEFT JOIN condominiums c  ON c.id  = t.condominium_id
     LEFT JOIN service_contacts sc ON sc.id = d.service_contact_id
     WHERE d.id = ?`
  ).get(dispatchId) as
    | {
        id: number;
        ticket_id: number;
        status: string;
        message_body: string;
        created_at: string;
        responded_at: string | null;
        response_summary: string | null;
        title: string;
        description: string;
        category: string;
        priority: string;
        condominium_id: number;
        condo_name: string | null;
        condo_address: string | null;
        vendor_name: string | null;
        vendor_contact_name: string | null;
      }
    | undefined;
}

// Photos uploaded by residents. AI captions are skipped here — the
// vendor sees the original image. URLs only, no analysis JSON.
function loadPhotosForTicket(ticketId: number): Array<{ url: string; content_type: string | null }> {
  const rows = db.prepare(
    `SELECT url, content_type FROM ticket_attachments
     WHERE ticket_id = ? AND content_type LIKE 'image/%'
     ORDER BY created_at ASC LIMIT 6`
  ).all(ticketId) as Array<{ url: string; content_type: string | null }>;
  return rows;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

function renderPage(opts: {
  title: string;
  body: string;
  noindex?: boolean;
}): string {
  // Server-rendered standalone HTML. No JS framework, no React bundle.
  // Tailwind utility classes mirror the rest of the app so the page
  // doesn't feel orphaned — but no Tailwind runtime, just inline
  // styles for the critical look.
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(opts.title)}</title>
${opts.noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<style>
  :root { --bg:#FBF7F1; --card:#fff; --ink:#403028; --ink-soft:#6B5A52; --ink-muted:#A89A92; --sage:#7FA382; --sage-soft:#E4EEDF; --peach:#D88E6F; --border:rgba(0,0,0,.08); }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--ink); line-height:1.5; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 6px; font-weight: 600; }
  .muted { color: var(--ink-soft); font-size: 14px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; background:var(--sage-soft); color:var(--ink); font-size:12px; margin-right:6px; }
  .pill.peach { background:#F7DDD1; color:#7A3F2A; }
  .card { background:var(--card); border:1px solid var(--border); border-radius: 24px; padding: 16px; margin: 16px 0; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--ink-muted); margin-bottom: 4px; }
  .photos { display:grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin-top: 8px; }
  .photos img { width:100%; aspect-ratio:1; object-fit: cover; border-radius: 12px; border:1px solid var(--border); }
  textarea, input { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius: 14px; font: inherit; background:#fff; }
  textarea { min-height: 88px; resize: vertical; }
  .row { display:flex; gap:8px; margin-top: 12px; }
  .row > * { flex: 1; }
  button { padding: 12px 16px; border-radius: 16px; border: none; font: inherit; font-weight: 600; cursor: pointer; }
  .btn-primary { background: var(--ink); color: #fff; }
  .btn-secondary { background: #fff; color: var(--ink); border: 1px solid var(--border); }
  .btn-danger { background: var(--peach); color: #fff; }
  .ok { background: var(--sage-soft); border-radius: 24px; padding: 24px; text-align: center; }
  .ok h2 { margin: 8px 0 4px; }
  small { font-size: 12px; color: var(--ink-muted); }
</style>
</head>
<body>
<div class="wrap">${opts.body}</div>
</body>
</html>`;
}

// ── Helpers for the human-facing text ─────────────────────────────
const PRIORITY_PT: Record<string, string> = {
  low: 'baixa', normal: 'normal', high: 'alta', urgent: 'urgente',
};
const CATEGORY_PT: Record<string, string> = {
  elevator: 'Elevador', plumbing: 'Hidráulica', electrical: 'Elétrica',
  hvac: 'Climatização', cleaning: 'Limpeza', security: 'Segurança',
  amenity: 'Áreas comuns', fire_safety: 'Fire safety',
  gas: 'Gás', gas_leak: 'Vazamento de gás',
  water: 'Água', water_damage: 'Dano por água',
  pest_control: 'Dedetização', landscaping: 'Paisagismo',
  pool: 'Piscina', gym_equipment: 'Academia',
  maintenance: 'Manutenção', general_maintenance: 'Manutenção geral',
};

// ── GET /v/:combined — render the page ─────────────────────────────
router.get('/:combined', (req: Request, res: Response) => {
  const parsed = parseTokenParam(req.params.combined);
  if (!parsed) return res.status(400).type('html').send(renderPage({
    title: 'Link inválido',
    noindex: true,
    body: '<div class="card"><h1>Link inválido</h1><p class="muted">Este link não é válido. Peça ao síndico para reenviar.</p></div>',
  }));

  const verify = verifyDispatchToken(parsed.dispatchId, parsed.token);
  if (!verify.ok) {
    const msg = verify.error === 'expired'
      ? 'Este link expirou. Peça ao síndico para reenviar.'
      : 'Este link não é válido. Peça ao síndico para reenviar.';
    return res.status(verify.error === 'expired' ? 410 : 401).type('html').send(renderPage({
      title: verify.error === 'expired' ? 'Link expirado' : 'Link inválido',
      noindex: true,
      body: `<div class="card"><h1>${verify.error === 'expired' ? 'Link expirado' : 'Link inválido'}</h1><p class="muted">${msg}</p></div>`,
    }));
  }

  const dispatch = loadDispatchForVendor(parsed.dispatchId);
  if (!dispatch) return res.status(404).type('html').send(renderPage({
    title: 'Chamado não encontrado',
    noindex: true,
    body: '<div class="card"><h1>Chamado não encontrado</h1><p class="muted">Não conseguimos achar este chamado. Talvez ele já tenha sido cancelado.</p></div>',
  }));

  // Cancelled dispatches don't accept responses.
  if (dispatch.status === 'cancelled') {
    return res.type('html').send(renderPage({
      title: 'Chamado cancelado',
      noindex: true,
      body: `<div class="card"><h1>Chamado cancelado</h1><p class="muted">O síndico cancelou este chamado antes do envio. Não é mais necessário responder.</p></div>`,
    }));
  }

  // Already responded — show a confirmation, not the form.
  if (dispatch.status === 'responded' && dispatch.response_summary) {
    return res.type('html').send(renderPage({
      title: 'Resposta registrada',
      noindex: true,
      body: `<div class="ok">
  <h2>Resposta registrada</h2>
  <p class="muted">O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} já recebeu sua resposta:</p>
  <p style="margin-top:12px; padding:12px; background:#fff; border-radius:16px;"><em>${escapeHtml(dispatch.response_summary)}</em></p>
  <small>Enviado em ${escapeHtml(dispatch.responded_at || '')}</small>
</div>`,
    }));
  }

  const photos = loadPhotosForTicket(dispatch.ticket_id);
  const vendorHello = dispatch.vendor_contact_name
    ? `Oi, ${escapeHtml(dispatch.vendor_contact_name)}!`
    : 'Oi!';
  const priority = PRIORITY_PT[dispatch.priority] || dispatch.priority;
  const category = CATEGORY_PT[dispatch.category] || dispatch.category;
  // Trim description so the vendor focuses on the ask, not the
  // resident's full narrative.
  const desc = String(dispatch.description || '').slice(0, 240);

  const photosHtml = photos.length === 0 ? '' : `<div class="card">
  <div class="label">Fotos do local</div>
  <div class="photos">${photos.map((p) => `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(p.url)}" alt="" loading="lazy"></a>`).join('')}</div>
</div>`;

  const body = `
<h1>${vendorHello}</h1>
<p class="muted">O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} pediu sua ajuda. Confirma se você pode atender?</p>

<div class="card">
  <div style="margin-bottom:10px;">
    <span class="pill peach">${escapeHtml(priority)}</span>
    <span class="pill">${escapeHtml(category)}</span>
  </div>
  <h2 style="margin:0 0 6px; font-size:18px;">${escapeHtml(dispatch.title)}</h2>
  <p class="muted" style="margin:0; white-space:pre-line;">${escapeHtml(desc)}${dispatch.description.length > 240 ? '…' : ''}</p>
  ${dispatch.condo_address ? `<p class="muted" style="margin:10px 0 0;"><small>📍 ${escapeHtml(dispatch.condo_address)}</small></p>` : ''}
</div>

${photosHtml}

<div class="card">
  <div class="label">Sua resposta</div>
  <form method="POST" action="/api/v/${dispatch.id}.${escapeHtml(parsed.token)}/respond" enctype="application/x-www-form-urlencoded">
    <div style="margin-bottom: 12px;">
      <label><strong>Pode atender?</strong></label>
      <div class="row" style="margin-top:6px;">
        <label style="cursor:pointer; padding:10px; border:1px solid var(--border); border-radius:14px; text-align:center; background:#fff;">
          <input type="radio" name="answer" value="accept" required style="margin-right:6px;">Sim, posso
        </label>
        <label style="cursor:pointer; padding:10px; border:1px solid var(--border); border-radius:14px; text-align:center; background:#fff;">
          <input type="radio" name="answer" value="decline" style="margin-right:6px;">Não consigo
        </label>
      </div>
    </div>
    <div style="margin-bottom: 12px;">
      <label class="label">Quando? (ex: hoje 16h, amanhã pela manhã)</label>
      <input name="eta" maxlength="80" placeholder="opcional, mas ajuda">
    </div>
    <div style="margin-bottom: 12px;">
      <label class="label">Estimativa de custo (R$)</label>
      <input name="cost" inputmode="decimal" maxlength="20" placeholder="opcional">
    </div>
    <div style="margin-bottom: 12px;">
      <label class="label">Observações</label>
      <textarea name="notes" maxlength="600" placeholder="alguma pergunta ou condição?"></textarea>
    </div>
    <button type="submit" class="btn-primary" style="width:100%;">Enviar resposta</button>
  </form>
  <p style="margin-top:14px;"><small>Sua resposta vai direto para o síndico — você não precisa ligar ou mandar mensagem separada.</small></p>
</div>`;

  res.type('html').send(renderPage({
    title: `${dispatch.title.slice(0, 60)} — ${dispatch.condo_name || 'CondoOS'}`,
    noindex: true,
    body,
  }));
});

// ── POST /v/:combined/respond — accept the form ────────────────────
const respondSchema = z.object({
  answer: z.enum(['accept', 'decline']),
  eta: z.string().max(120).optional(),
  cost: z.string().max(40).optional(),
  notes: z.string().max(1_000).optional(),
});

router.post('/:combined/respond', (req: Request, res: Response) => {
  const parsed = parseTokenParam(req.params.combined);
  if (!parsed) return fail(res, 'invalid_link', 400);
  const verify = verifyDispatchToken(parsed.dispatchId, parsed.token);
  if (!verify.ok) return fail(res, verify.error === 'expired' ? 'link_expired' : 'invalid_link', verify.error === 'expired' ? 410 : 401);

  const validated = respondSchema.safeParse(req.body);
  if (!validated.success) return fail(res, 'invalid_input', 400, validated.error.flatten());

  const dispatch = loadDispatchForVendor(parsed.dispatchId);
  if (!dispatch) return fail(res, 'not_found', 404);
  if (dispatch.status === 'cancelled') return fail(res, 'dispatch_cancelled', 409);
  if (dispatch.status === 'responded') {
    return res.type('html').send(renderPage({
      title: 'Resposta já registrada',
      noindex: true,
      body: '<div class="ok"><h2>Resposta já registrada</h2><p class="muted">Esta resposta já tinha sido enviada. Obrigado!</p></div>',
    }));
  }

  // Compose the response_summary the admin will see. Compact + scannable.
  const accept = validated.data.answer === 'accept';
  const parts: string[] = [accept ? '✓ Aceita' : '✗ Não pode atender'];
  if (validated.data.eta) parts.push(`Quando: ${validated.data.eta}`);
  if (validated.data.cost) parts.push(`Custo: ${validated.data.cost}`);
  if (validated.data.notes) parts.push(`Obs: ${validated.data.notes}`);
  const summary = parts.join(' · ').slice(0, 2_000);

  db.prepare(
    `UPDATE ticket_dispatches
     SET status = 'responded', responded_at = CURRENT_TIMESTAMP, response_summary = ?
     WHERE id = ? AND status NOT IN ('responded','cancelled')`
  ).run(summary, parsed.dispatchId);

  // Flip the ticket — same path the admin's manual VendorResponseModal
  // takes. vendor_engaged when there's an accept, blocked_needs_admin
  // when declined (so the admin notices and re-dispatches).
  if (accept) {
    db.prepare(
      `UPDATE tickets
       SET remediation_status = CASE WHEN remediation_status IN ('resolved','blocked_needs_admin') THEN remediation_status ELSE 'vendor_engaged' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(dispatch.ticket_id);
  } else {
    db.prepare(
      `UPDATE tickets
       SET remediation_status = 'blocked_needs_admin',
           blocked_reason = 'vendor_declined',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(dispatch.ticket_id);
  }

  // Audit log — no admin user (this is the vendor responding via magic
  // link), so we pass the real express req for ip extraction but with
  // no user attached. audit() handles req.user being absent.
  audit(req as any, {
    action: 'vendor.self_respond',
    target_type: 'ticket_dispatch',
    target_id: parsed.dispatchId,
    condominium_id: dispatch.condominium_id,
    metadata: { accept, has_eta: !!validated.data.eta, has_cost: !!validated.data.cost, ticket_id: dispatch.ticket_id },
  });

  return res.type('html').send(renderPage({
    title: 'Resposta enviada',
    noindex: true,
    body: `<div class="ok">
  <h2>${accept ? 'Obrigado!' : 'Resposta registrada'}</h2>
  <p class="muted">${accept
    ? `O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} foi avisado e vai te contatar para confirmar os detalhes.`
    : `O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} foi avisado. Obrigado pela honestidade.`}
  </p>
  <p style="margin-top:14px;"><small>Você já pode fechar essa janela.</small></p>
</div>`,
  }));
});

// Stub JSON endpoint mirroring the HTML — useful for testing.
router.get('/:combined/info', (req: Request, res: Response) => {
  const parsed = parseTokenParam(req.params.combined);
  if (!parsed) return fail(res, 'invalid_link', 400);
  const verify = verifyDispatchToken(parsed.dispatchId, parsed.token);
  if (!verify.ok) return fail(res, verify.error === 'expired' ? 'link_expired' : 'invalid_link', verify.error === 'expired' ? 410 : 401);
  const dispatch = loadDispatchForVendor(parsed.dispatchId);
  if (!dispatch) return fail(res, 'not_found', 404);
  return ok(res, {
    dispatch_id: dispatch.id,
    status: dispatch.status,
    title: dispatch.title,
    category: dispatch.category,
    priority: dispatch.priority,
    condo_name: dispatch.condo_name,
    response_summary: dispatch.response_summary,
  });
});

export default router;
