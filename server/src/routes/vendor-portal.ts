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
import { notifyUsers } from '../lib/whatsapp';

// Find every board_admin in the condo for proactive notifications. Used
// after a vendor responds via the portal so the admin learns about it
// from WhatsApp instead of having to refresh the tickets page. Same
// query the SLA escalator uses for escalation pings — kept here too so
// the vendor-portal module doesn't import the escalator.
function adminUserIdsForCondo(condoId: number): number[] {
  const rows = db.prepare(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN user_unit uu ON uu.user_id = u.id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE b.condominium_id = ?
       AND u.role = 'board_admin'
       AND uu.status = 'active'`
  ).all(condoId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

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

// Pull a "Label: value" field out of the · -separated summary string.
// The /respond route writes summaries like
//   "✓ Aceita · Quando: Hoje 18h · Custo: 420 · Obs: ..."
// so we split on · and find the segment starting with the label.
// Exported for unit testing — money parsing is bug-prone enough to
// warrant direct coverage.
export function extractField(summary: string, label: string): string {
  for (const seg of String(summary || '').split('·')) {
    const trimmed = seg.trim();
    if (trimmed.toLowerCase().startsWith(label.toLowerCase() + ':')) {
      return trimmed.slice(label.length + 1).trim();
    }
  }
  return '';
}

// Parse a BRL-ish money string into a number. Handles "420", "R$ 420",
// "1.200,50" (pt-BR grouping), "1200.50" (en grouping). Returns null
// when there's no parseable number — we'd rather skip the variance
// check than flag on garbage input. Exported for unit testing.
export function parseBrl(raw: string): number | null {
  if (!raw) return null;
  // Strip everything but digits + separators.
  const s = String(raw).replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let normalized = s;
  if (hasComma && hasDot) {
    // Both present — whichever appears LAST is the decimal separator.
    // "1.200,50" (pt-BR) vs "1,200.50" (en).
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Comma only — decimal if 1-2 trailing digits ("12,50"), else
    // thousands grouping ("1,200").
    normalized = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    // Dot only — the ambiguous case. "2.400" in pt-BR is two-thousand-
    // four-hundred; "12.50" is twelve-fifty. Heuristic: exactly 3
    // trailing digits after the LAST dot → thousands grouping, strip
    // all dots. Otherwise the dot is a decimal point, leave it.
    normalized = /\.\d{3}$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap">
<style>
  /* Palette + type mirror client-app (tailwind.config.js + index.css) so the
     portal feels like the same product, not an orphaned server page. */
  :root {
    --card:#fff; --ink:#342824; --ink-soft:#66504A; --ink-muted:#A98B7C;
    --body:#4A3A36; --sage:#7A9070; --sage-soft:#E5EADF; --peach:#D48E6C;
    --peach-text:#8F442A; --peach-soft:#F6E0D0; --border:rgba(75,55,45,.12);
    --clay:0 10px 30px -12px rgba(75,55,45,.25), 0 2px 8px -2px rgba(75,55,45,.08), inset 0 1px 0 0 rgba(255,255,255,.5);
  }
  * { box-sizing: border-box; }
  body {
    margin:0;
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: linear-gradient(140deg, #FBF1EA 0%, #F3ECE0 40%, #E5EADF 100%);
    background-attachment: fixed; min-height: 100vh;
    color: var(--body); line-height:1.5;
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    font-feature-settings: 'cv11', 'ss01', 'ss03';
    letter-spacing: -0.01em;
  }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 16px 64px; }
  h1, h2, h3 {
    font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
    letter-spacing: -0.025em; font-feature-settings: 'ss01', 'cv11'; color: var(--ink);
  }
  h1 { font-size: 24px; margin: 0 0 6px; font-weight: 600; letter-spacing: -0.035em; }
  .muted { color: var(--ink-soft); font-size: 14px; }
  .pill { display:inline-block; padding:3px 11px; border-radius:999px; background:var(--sage-soft); color:var(--ink); font-size:12px; font-weight:500; margin-right:6px; }
  .pill.peach { background:var(--peach-soft); color:var(--peach-text); }
  .card { background:var(--card); border:1px solid rgba(255,255,255,.6); border-radius: 2rem; padding: 20px; margin: 16px 0; box-shadow: var(--clay); }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--ink-muted); margin-bottom: 4px; }
  .photos { display:grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin-top: 8px; }
  .photos img { width:100%; aspect-ratio:1; object-fit: cover; border-radius: 14px; border:1px solid var(--border); }
  textarea, input { width:100%; padding:11px 13px; border:1px solid var(--border); border-radius: 1rem; font: inherit; letter-spacing: inherit; background:rgba(255,255,255,.85); color: var(--body); }
  textarea:focus, input:focus { outline: 2px solid var(--sage); outline-offset: 1px; }
  textarea { min-height: 88px; resize: vertical; }
  .row { display:flex; gap:8px; margin-top: 12px; }
  .row > * { flex: 1; }
  button { padding: 12px 18px; border-radius: 1rem; border: none; font: inherit; letter-spacing: -0.01em; font-weight: 600; cursor: pointer; box-shadow: var(--clay); }
  .btn-primary { background: var(--ink); color: #fff; }
  .btn-secondary { background: #fff; color: var(--ink); border: 1px solid var(--border); }
  .btn-danger { background: var(--peach); color: #fff; }
  .ok { background: var(--sage-soft); border-radius: 2rem; padding: 28px; text-align: center; box-shadow: var(--clay); }
  .ok h2 { margin: 8px 0 4px; }
  small { font-size: 12px; color: var(--ink-muted); }
  a { color: var(--ink); }
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

  // Proactive admin notification — the admin shouldn't have to refresh
  // /board/tickets to discover the response landed. Fire-and-forget so
  // the form POST doesn't block on WhatsApp delivery. notifyUsers
  // handles opt-in + missing-phone filtering, queues to the outbox.
  const admins = adminUserIdsForCondo(dispatch.condominium_id);
  if (admins.length > 0) {
    const vendor = dispatch.vendor_name || 'Fornecedor';
    const ticketTitle = String(dispatch.title || '').slice(0, 80);
    const extras: string[] = [];
    if (validated.data.eta) extras.push(`Quando: ${validated.data.eta}`);
    if (validated.data.cost) extras.push(`R$ ${validated.data.cost}`);
    const extrasStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
    const msg = accept
      ? `✅ ${vendor} aceitou: "${ticketTitle}"${extrasStr}. Ver: /board/tickets`
      : `❌ ${vendor} não pode atender: "${ticketTitle}". Considere acionar outro fornecedor: /board/tickets`;
    void notifyUsers(admins, msg).catch((err) => {
      console.warn(`[vendor.respond] admin notify failed:`, (err as Error)?.message || err);
    });
  }

  // Completion link — appended to the thank-you page so the vendor can
  // come back and mark the work done. Same HMAC token works for both
  // /respond and /complete; the server differentiates by route. No
  // separate token rotation needed since both paths flow off the same
  // dispatch_id and the TTL already covers a full week.
  const completionUrl = accept
    ? `/api/v/${dispatch.id}.${escapeHtml(parsed.token)}/complete`
    : null;

  return res.type('html').send(renderPage({
    title: 'Resposta enviada',
    noindex: true,
    body: `<div class="ok">
  <h2>${accept ? 'Obrigado!' : 'Resposta registrada'}</h2>
  <p class="muted">${accept
    ? `O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} foi avisado e vai te contatar para confirmar os detalhes.`
    : `O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} foi avisado. Obrigado pela honestidade.`}
  </p>
  ${completionUrl ? `<p style="margin-top:16px;">Quando o trabalho estiver concluído, <a href="${completionUrl}" style="color:var(--ink); font-weight:600;">clique aqui para confirmar a conclusão</a>.</p>` : ''}
  <p style="margin-top:14px;"><small>Você já pode fechar essa janela.</small></p>
</div>`,
  }));
});

// ── GET /v/:combined/complete — show the completion form ──────────
// Available only after the vendor has accepted (status='responded' AND
// summary starts with the accept marker). Lets them mark the work done
// + record the final cost + optional note so the ticket flips to
// resolved without admin intervention.
router.get('/:combined/complete', (req: Request, res: Response) => {
  const parsed = parseTokenParam(req.params.combined);
  if (!parsed) return res.status(400).type('html').send(renderPage({
    title: 'Link inválido', noindex: true,
    body: '<div class="card"><h1>Link inválido</h1></div>',
  }));
  const verify = verifyDispatchToken(parsed.dispatchId, parsed.token);
  if (!verify.ok) return res.status(verify.error === 'expired' ? 410 : 401).type('html').send(renderPage({
    title: verify.error === 'expired' ? 'Link expirado' : 'Link inválido', noindex: true,
    body: `<div class="card"><h1>${verify.error === 'expired' ? 'Link expirado' : 'Link inválido'}</h1></div>`,
  }));
  const dispatch = loadDispatchForVendor(parsed.dispatchId);
  if (!dispatch) return res.status(404).type('html').send(renderPage({
    title: 'Não encontrado', noindex: true,
    body: '<div class="card"><h1>Chamado não encontrado</h1></div>',
  }));
  // Must have accepted first.
  if (!dispatch.response_summary?.startsWith('✓')) {
    return res.type('html').send(renderPage({
      title: 'Aceite primeiro', noindex: true,
      body: '<div class="card"><h1>Confirme antes</h1><p class="muted">Você precisa confirmar que vai atender esse chamado antes de marcá-lo como concluído.</p></div>',
    }));
  }
  // Already completed (resolved ticket) — show confirmation.
  if (/Concluído/i.test(dispatch.response_summary)) {
    return res.type('html').send(renderPage({
      title: 'Já concluído', noindex: true,
      body: '<div class="ok"><h2>Já concluído</h2><p class="muted">Esse trabalho já foi marcado como concluído. Obrigado!</p></div>',
    }));
  }

  const body = `
<h1>Marcar como concluído</h1>
<p class="muted">Confirme que o trabalho em <strong>${escapeHtml(dispatch.title)}</strong> foi feito. O síndico vai ser avisado.</p>

<div class="card">
  <form method="POST" action="/api/v/${dispatch.id}.${escapeHtml(parsed.token)}/complete" enctype="application/x-www-form-urlencoded">
    <div style="margin-bottom: 12px;">
      <label class="label">Custo final (R$)</label>
      <input name="final_cost" inputmode="decimal" maxlength="20" placeholder="ex: 350">
    </div>
    <div style="margin-bottom: 12px;">
      <label class="label">O que foi feito?</label>
      <textarea name="completion_note" maxlength="800" placeholder="ex: troquei o cabo desgastado, testei 5 viagens, está OK"></textarea>
    </div>
    <button type="submit" class="btn-primary" style="width:100%;">Marcar como concluído</button>
  </form>
</div>`;
  res.type('html').send(renderPage({
    title: `Concluir: ${dispatch.title.slice(0, 50)}`,
    noindex: true, body,
  }));
});

// ── POST /v/:combined/complete — process completion ───────────────
const completeSchema = z.object({
  final_cost: z.string().max(40).optional(),
  completion_note: z.string().max(1_000).optional(),
});

router.post('/:combined/complete', (req: Request, res: Response) => {
  const parsed = parseTokenParam(req.params.combined);
  if (!parsed) return fail(res, 'invalid_link', 400);
  const verify = verifyDispatchToken(parsed.dispatchId, parsed.token);
  if (!verify.ok) return fail(res, verify.error === 'expired' ? 'link_expired' : 'invalid_link', verify.error === 'expired' ? 410 : 401);
  const validated = completeSchema.safeParse(req.body);
  if (!validated.success) return fail(res, 'invalid_input', 400, validated.error.flatten());

  const dispatch = loadDispatchForVendor(parsed.dispatchId);
  if (!dispatch) return fail(res, 'not_found', 404);
  if (!dispatch.response_summary?.startsWith('✓')) {
    return fail(res, 'must_accept_first', 409);
  }
  if (/Concluído/i.test(dispatch.response_summary)) {
    return res.type('html').send(renderPage({
      title: 'Já concluído', noindex: true,
      body: '<div class="ok"><h2>Já concluído</h2></div>',
    }));
  }

  // Compose the new response_summary by appending the completion to
  // the existing accept-summary. This preserves the original ETA/cost
  // promise so the admin can compare it to the final outcome.
  const parts: string[] = ['Concluído'];
  if (validated.data.final_cost) parts.push(`Final: R$ ${validated.data.final_cost}`);
  if (validated.data.completion_note) parts.push(validated.data.completion_note);
  const completionSummary = parts.join(' · ').slice(0, 1_200);
  const newSummary = `${dispatch.response_summary}\n→ ${completionSummary}`.slice(0, 4_000);

  db.prepare(
    `UPDATE ticket_dispatches SET response_summary = ? WHERE id = ?`
  ).run(newSummary, parsed.dispatchId);
  // Flip the ticket to resolved — same path the admin's manual
  // /resolve route takes, minus the resident announcement (the admin
  // can publish that later if they want).
  db.prepare(
    `UPDATE tickets
     SET status = 'resolved',
         remediation_status = 'resolved',
         resolved_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND remediation_status != 'resolved'`
  ).run(dispatch.ticket_id);

  // Cost-variance check — compare the final cost the vendor reported
  // against the estimate they promised at accept time. The accept
  // summary was written by /respond as "...· Custo: 420 ·..." — we
  // parse both numbers and flag when they diverge by >25%. This is the
  // signal that catches an estimate-then-overcharge: the admin gets a
  // loud ⚠️ instead of a quiet 🎉.
  const promisedCost = parseBrl(extractField(dispatch.response_summary || '', 'Custo'));
  const finalCost = parseBrl(validated.data.final_cost || '');
  let costVariance: { promised: number; final: number; ratio: number; overBudget: boolean } | null = null;
  if (promisedCost != null && finalCost != null && promisedCost > 0) {
    const ratio = finalCost / promisedCost;
    // Flag at >25% in either direction — overcharge is the obvious risk
    // but a final far BELOW estimate can mean scope was cut.
    if (ratio > 1.25 || ratio < 0.75) {
      costVariance = { promised: promisedCost, final: finalCost, ratio, overBudget: ratio > 1 };
    }
  }

  audit(req as any, {
    action: 'vendor.self_complete',
    target_type: 'ticket_dispatch',
    target_id: parsed.dispatchId,
    condominium_id: dispatch.condominium_id,
    metadata: {
      has_final_cost: !!validated.data.final_cost,
      ticket_id: dispatch.ticket_id,
      ...(costVariance ? {
        cost_variance: {
          promised_brl: costVariance.promised,
          final_brl: costVariance.final,
          ratio: Math.round(costVariance.ratio * 100) / 100,
        },
      } : {}),
    },
  });

  // Notify admins of completion. When cost diverged, the message turns
  // from a celebration into a flag so the admin actually reads it.
  const admins = adminUserIdsForCondo(dispatch.condominium_id);
  if (admins.length > 0) {
    const vendor = dispatch.vendor_name || 'Fornecedor';
    const ticketTitle = String(dispatch.title || '').slice(0, 80);
    const costStr = validated.data.final_cost ? ` (R$ ${validated.data.final_cost})` : '';
    let msg: string;
    if (costVariance) {
      const pct = Math.round((costVariance.ratio - 1) * 100);
      const dir = costVariance.overBudget
        ? `${pct}% ACIMA do orçado (R$ ${costVariance.promised})`
        : `${Math.abs(pct)}% abaixo do orçado (R$ ${costVariance.promised})`;
      msg = `⚠️ ${vendor} concluiu "${ticketTitle}" com custo final R$ ${costVariance.final} — ${dir}. Confira: /board/tickets`;
    } else {
      msg = `🎉 ${vendor} concluiu: "${ticketTitle}"${costStr}. Ver: /board/tickets`;
    }
    void notifyUsers(admins, msg).catch((err) => {
      console.warn(`[vendor.complete] admin notify failed:`, (err as Error)?.message || err);
    });
  }

  return res.type('html').send(renderPage({
    title: 'Trabalho concluído',
    noindex: true,
    body: `<div class="ok">
  <h2>Tudo certo!</h2>
  <p class="muted">O síndico do ${escapeHtml(dispatch.condo_name || 'condomínio')} foi avisado da conclusão. Obrigado!</p>
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
