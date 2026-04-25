import { Router } from 'express';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import {
  listEligibleOwners,
  canVoteInAssembly,
  resolveProxyVote,
  getAgendaTally,
  resolveAgendaOutcome,
  generateAtaMarkdown,
  AgendaItemRow,
} from '../lib/assembly';
import { notifyCondoOwners, notifyCondoResidents } from '../lib/whatsapp';

const router = Router();

function firstActiveUnitForUser(userId: number, condoId: number): number | null {
  const row = db.prepare(
    `SELECT uu.unit_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.user_id = ?
       AND b.condominium_id = ?
       AND uu.status = 'active'
     ORDER BY uu.primary_contact DESC, uu.id ASC
     LIMIT 1`
  ).get(userId, condoId) as { unit_id: number } | undefined;
  return row?.unit_id || null;
}

function getScopedAssembly(id: number, condoId: number) {
  return db.prepare(
    `SELECT a.*, cr.first_name AS creator_first, cr.last_name AS creator_last
     FROM assemblies a
     JOIN users cr ON cr.id = a.created_by_user_id
     WHERE a.id = ? AND a.condominium_id = ?`
  ).get(id, condoId) as any;
}

function getAgendaItems(assemblyId: number): AgendaItemRow[] {
  return db.prepare(
    `SELECT * FROM assembly_agenda_items WHERE assembly_id = ? ORDER BY order_index`
  ).all(assemblyId) as AgendaItemRow[];
}

// ------------------------------------------------------------------ list / detail

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT a.*, cr.first_name AS creator_first, cr.last_name AS creator_last,
            (SELECT COUNT(*) FROM assembly_agenda_items ai WHERE ai.assembly_id = a.id) AS agenda_count
     FROM assemblies a
     JOIN users cr ON cr.id = a.created_by_user_id
     WHERE a.condominium_id = ?
     ORDER BY
       CASE a.status WHEN 'in_session' THEN 1 WHEN 'convoked' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
       a.first_call_at DESC`
  ).all(condoId);
  return ok(res, rows);
});

router.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  const isBoard = req.user!.role === 'board_admin';

  const agenda = getAgendaItems(id).map((item) => {
    const tally = getAgendaTally(item.id);
    const outcome = resolveAgendaOutcome(tally, item.required_majority);
    return { ...item, tally, outcome };
  });
  const attendance = db.prepare(
    `SELECT att.*, u.first_name, u.last_name, gu.first_name AS proxy_first, gu.last_name AS proxy_last
     FROM assembly_attendance att
     JOIN users u ON u.id = att.user_id
     LEFT JOIN users gu ON gu.id = att.proxy_for_user_id
     WHERE att.assembly_id = ?
     ORDER BY att.checked_in_at`
  ).all(id);
  const proxies = db.prepare(
    `SELECT p.*, go.first_name AS grantor_first, go.last_name AS grantor_last,
            ge.first_name AS grantee_first, ge.last_name AS grantee_last
     FROM assembly_proxies p
     JOIN users go ON go.id = p.grantor_user_id
     JOIN users ge ON ge.id = p.grantee_user_id
     WHERE p.assembly_id = ? AND p.status = 'active'`
  ).all(id);

  const owners = listEligibleOwners(condoId);
  const eligible_total_weight = owners.reduce((s, o) => s + (o.weight || 1), 0);
  const present_weight = attendance.reduce((s: number, r: any) => {
    const ownerId = r.attended_as === 'proxy' ? r.proxy_for_user_id : r.user_id;
    const stake = owners.find((o) => o.user_id === ownerId);
    return s + (stake?.weight || 0);
  }, 0);

  const myGrant = req.user
    ? (db.prepare(
        `SELECT p.*, ge.first_name AS grantee_first, ge.last_name AS grantee_last
         FROM assembly_proxies p JOIN users ge ON ge.id = p.grantee_user_id
         WHERE p.assembly_id = ? AND p.grantor_user_id = ? AND p.status = 'active'`
      ).get(id, req.user.id) as any)
    : null;

  const myEligibility = req.user
    ? canVoteInAssembly(id, req.user.id)
    : { ok: false, reason: 'not_authed' };
  const myAttendance = req.user
    ? attendance.find((r: any) => r.user_id === req.user!.id && r.attended_as === 'self') || null
    : null;

  return ok(res, {
    ...a,
    agenda,
    attendance: isBoard ? attendance : [],
    proxies: isBoard ? proxies : [],
    attendance_count: attendance.length,
    proxies_count: proxies.length,
    eligibility: {
      eligible_owner_count: owners.length,
      eligible_total_weight,
      present_weight,
      turnout_percent: eligible_total_weight > 0 ? Math.round((present_weight / eligible_total_weight) * 100) : 0,
    },
    my: {
      grant: myGrant,
      attendance: myAttendance,
      can_vote: myEligibility,
    },
  });
});

// ------------------------------------------------------------------ admin: create / update / agenda

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const { title, kind, first_call_at, second_call_at, president_user_id, secretary_user_id } = req.body || {};
  if (!title || !kind || !first_call_at) return fail(res, 'missing_fields');
  if (!['ordinary', 'extraordinary'].includes(kind)) return fail(res, 'invalid_kind');
  if (isNaN(Date.parse(first_call_at))) return fail(res, 'invalid_first_call_at');
  if (second_call_at && isNaN(Date.parse(second_call_at))) return fail(res, 'invalid_second_call_at');

  const r = db.prepare(
    `INSERT INTO assemblies (condominium_id, created_by_user_id, title, kind, first_call_at, second_call_at, president_user_id, secretary_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(condoId, req.user!.id, title, kind, first_call_at, second_call_at || null, president_user_id || null, secretary_user_id || null);
  return ok(res, { id: Number(r.lastInsertRowid) }, 201);
});

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'draft') return fail(res, 'locked_after_convocation', 409);

  const fields = ['title', 'kind', 'first_call_at', 'second_call_at', 'president_user_id', 'secretary_user_id'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f] || null); }
  }
  if (sets.length === 0) return fail(res, 'nothing_to_update');
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  db.prepare(`UPDATE assemblies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return ok(res, { id, updated: sets.length - 1 });
});

// Admin adds an agenda item while assembly is in draft.
router.post('/:id/agenda', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'draft') return fail(res, 'locked_after_convocation', 409);

  const { title, description, item_type, source_proposal_id, required_majority } = req.body || {};
  if (!title || !item_type) return fail(res, 'missing_fields');
  if (!['budget', 'accounts', 'bylaw', 'election', 'ordinary', 'other'].includes(item_type)) return fail(res, 'invalid_item_type');
  const majority = required_majority || (item_type === 'bylaw' ? 'two_thirds' : 'simple');
  if (!['simple', 'two_thirds', 'unanimous'].includes(majority)) return fail(res, 'invalid_majority');

  const maxRow = db.prepare(
    `SELECT COALESCE(MAX(order_index), 0) AS m FROM assembly_agenda_items WHERE assembly_id = ?`
  ).get(id) as { m: number };
  const r = db.prepare(
    `INSERT INTO assembly_agenda_items (assembly_id, order_index, title, description, item_type, source_proposal_id, required_majority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, maxRow.m + 1, title, description || null, item_type, source_proposal_id || null, majority);
  return ok(res, { id: Number(r.lastInsertRowid) }, 201);
});

router.delete('/:id/agenda/:itemId', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'draft') return fail(res, 'locked_after_convocation', 409);
  db.prepare(`DELETE FROM assembly_agenda_items WHERE id = ? AND assembly_id = ?`).run(itemId, id);
  return ok(res, { ok: true });
});

// ------------------------------------------------------------------ lifecycle: convoke / start / close

router.post('/:id/convoke', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'draft') return fail(res, 'invalid_transition', 409);

  const items = getAgendaItems(id);
  if (items.length === 0) return fail(res, 'agenda_is_empty', 400);

  db.prepare(
    `UPDATE assemblies SET status='convoked', convoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);

  // WhatsApp convocation to all owners (legal requirement in BR, min 8 days notice).
  const when = new Date(a.first_call_at).toLocaleString('pt-BR');
  const body = `🏛️ CondoOS — Você está convocado para a ${a.kind === 'ordinary' ? 'Assembleia Geral Ordinária' : 'Assembleia Geral Extraordinária'}: "${a.title}". Primeira chamada: ${when}. Veja a pauta e conceda procuração se necessário no app.`;
  notifyCondoOwners(condoId, body).catch((e) => console.warn('[assemblies/convoke] notify failed:', e?.message));

  return ok(res, { id, status: 'convoked' });
});

router.post('/:id/start', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'convoked') return fail(res, 'invalid_transition', 409);

  db.prepare(
    `UPDATE assemblies SET status='in_session', started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);
  return ok(res, { id, status: 'in_session' });
});

router.post('/:id/close', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'in_session') return fail(res, 'invalid_transition', 409);

  // Auto-close any remaining active agenda items as inconclusive.
  const openItems = db.prepare(
    `SELECT id FROM assembly_agenda_items WHERE assembly_id = ? AND status IN ('pending','active')`
  ).all(id) as Array<{ id: number }>;
  for (const it of openItems) {
    db.prepare(
      `UPDATE assembly_agenda_items SET status='inconclusive', closed_at=CURRENT_TIMESTAMP WHERE id = ?`
    ).run(it.id);
  }

  const ata = generateAtaMarkdown(id);
  db.prepare(
    `UPDATE assemblies SET status='closed', closed_at=CURRENT_TIMESTAMP, ata_markdown=?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`
  ).run(ata, id);
  return ok(res, { id, status: 'closed' });
});

// ------------------------------------------------------------------ attendance

router.post('/:id/attendance', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'in_session') return fail(res, 'assembly_not_in_session', 409);

  // Self check-in (anyone can) OR proxy check-in (only if the user has active proxies).
  const { proxy_for_user_id } = req.body || {};

  if (proxy_for_user_id) {
    const representedUserId = Number(proxy_for_user_id);
    const grant = db.prepare(
      `SELECT id FROM assembly_proxies
       WHERE assembly_id = ? AND grantor_user_id = ? AND grantee_user_id = ? AND status = 'active'`
    ).get(id, representedUserId, req.user!.id);
    if (!grant) return fail(res, 'no_active_proxy', 403);
    const representedUnitId = firstActiveUnitForUser(representedUserId, condoId);

    // Replace any existing proxy attendance for this grantor
    db.prepare(
      `DELETE FROM assembly_attendance WHERE assembly_id = ? AND attended_as = 'proxy' AND proxy_for_user_id = ?`
    ).run(id, representedUserId);
    db.prepare(
      `INSERT INTO assembly_attendance (assembly_id, user_id, unit_id, attended_as, proxy_for_user_id, is_delinquent)
       VALUES (?, ?, ?, 'proxy', ?, ?)`
    ).run(id, req.user!.id, representedUnitId, representedUserId, 0);
    return ok(res, { ok: true, mode: 'proxy' });
  }

  // Self: upsert
  const unitId = firstActiveUnitForUser(req.user!.id, condoId);
  const existing = db.prepare(
    `SELECT id FROM assembly_attendance WHERE assembly_id = ? AND user_id = ? AND attended_as = 'self'`
  ).get(id, req.user!.id) as { id: number } | undefined;
  if (existing) {
    db.prepare(`UPDATE assembly_attendance SET unit_id = COALESCE(?, unit_id) WHERE id = ?`).run(unitId, existing.id);
  } else {
    db.prepare(
      `INSERT INTO assembly_attendance (assembly_id, user_id, unit_id, attended_as, is_delinquent)
       VALUES (?, ?, ?, 'self', ?)`
    ).run(id, req.user!.id, unitId, 0);
  }
  return ok(res, { ok: true, mode: 'self' });
});

// Admin marks an attendee as delinquent (blocks their votes).
router.patch('/:id/attendance/:attId', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const attId = Number(req.params.attId);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  const { is_delinquent } = req.body || {};
  db.prepare(
    `UPDATE assembly_attendance SET is_delinquent = ? WHERE id = ? AND assembly_id = ?`
  ).run(is_delinquent ? 1 : 0, attId, id);
  return ok(res, { ok: true });
});

// ------------------------------------------------------------------ proxies

router.post('/:id/proxies', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (!['convoked', 'in_session'].includes(a.status)) return fail(res, 'invalid_phase_for_proxy', 409);

  const grantor = req.user!.id;
  const { grantee_user_id, note } = req.body || {};
  if (!grantee_user_id) return fail(res, 'missing_grantee');
  if (grantee_user_id === grantor) return fail(res, 'cannot_proxy_self');

  // Revoke any existing active grants for this grantor.
  db.prepare(
    `UPDATE assembly_proxies SET status='revoked' WHERE assembly_id = ? AND grantor_user_id = ? AND status = 'active'`
  ).run(id, grantor);
  const r = db.prepare(
    `INSERT INTO assembly_proxies (assembly_id, grantor_user_id, grantee_user_id, note) VALUES (?, ?, ?, ?)`
  ).run(id, grantor, grantee_user_id, note || null);
  return ok(res, { id: Number(r.lastInsertRowid) }, 201);
});

router.delete('/:id/proxies/:proxyId', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const proxyId = Number(req.params.proxyId);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  // Only the grantor can revoke.
  const p = db.prepare(
    `SELECT grantor_user_id FROM assembly_proxies WHERE id = ? AND assembly_id = ?`
  ).get(proxyId, id) as { grantor_user_id: number } | undefined;
  if (!p) return fail(res, 'not_found', 404);
  if (p.grantor_user_id !== req.user!.id && req.user!.role !== 'board_admin') return fail(res, 'forbidden', 403);
  db.prepare(`UPDATE assembly_proxies SET status='revoked' WHERE id = ?`).run(proxyId);
  return ok(res, { ok: true });
});

// ------------------------------------------------------------------ voting

router.post('/:id/agenda/:itemId/open', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  if (a.status !== 'in_session') return fail(res, 'assembly_not_in_session', 409);
  const item = db.prepare(`SELECT status FROM assembly_agenda_items WHERE id = ? AND assembly_id = ?`).get(itemId, id) as any;
  if (!item) return fail(res, 'not_found', 404);
  if (item.status !== 'pending') return fail(res, 'already_opened_or_closed', 409);
  db.prepare(`UPDATE assembly_agenda_items SET status='active' WHERE id = ?`).run(itemId);
  return ok(res, { id: itemId, status: 'active' });
});

router.post('/:id/agenda/:itemId/vote', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  const item = db.prepare(`SELECT * FROM assembly_agenda_items WHERE id = ? AND assembly_id = ?`).get(itemId, id) as any;
  if (!item) return fail(res, 'not_found', 404);
  if (item.status !== 'active') return fail(res, 'item_not_open', 409);

  const { choice, on_behalf_of_user_id } = req.body || {};
  if (!['yes', 'no', 'abstain'].includes(choice)) return fail(res, 'invalid_choice');

  let effective_owner_id: number;
  let weight: number;

  if (on_behalf_of_user_id && on_behalf_of_user_id !== req.user!.id) {
    const proxy = resolveProxyVote(id, req.user!.id, on_behalf_of_user_id);
    if (!proxy.ok) return fail(res, proxy.reason || 'proxy_invalid', 403);
    effective_owner_id = on_behalf_of_user_id;
    weight = proxy.weight!;
  } else {
    const elig = canVoteInAssembly(id, req.user!.id);
    if (!elig.ok) return fail(res, elig.reason || 'cannot_vote', 403);
    effective_owner_id = elig.effective_owner_id!;
    weight = elig.weight!;
  }

  // Upsert: one vote per (agenda_item_id, effective_owner_id).
  const existing = db.prepare(
    `SELECT id FROM assembly_votes WHERE agenda_item_id = ? AND effective_owner_id = ?`
  ).get(itemId, effective_owner_id) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE assembly_votes SET choice = ?, weight = ?, voter_user_id = ?, cast_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(choice, weight, req.user!.id, existing.id);
  } else {
    db.prepare(
      `INSERT INTO assembly_votes (assembly_id, agenda_item_id, voter_user_id, effective_owner_id, choice, weight)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, itemId, req.user!.id, effective_owner_id, choice, weight);
  }
  const tally = getAgendaTally(itemId);
  return ok(res, { tally });
});

router.post('/:id/agenda/:itemId/close', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const a = getScopedAssembly(id, condoId);
  if (!a) return fail(res, 'not_found', 404);
  const item = db.prepare(`SELECT * FROM assembly_agenda_items WHERE id = ? AND assembly_id = ?`).get(itemId, id) as any;
  if (!item) return fail(res, 'not_found', 404);
  if (item.status !== 'active') return fail(res, 'item_not_open', 409);

  const tally = getAgendaTally(itemId);
  const outcome = resolveAgendaOutcome(tally, item.required_majority);
  const status = tally.total_weight === 0
    ? 'inconclusive'
    : outcome.approved ? 'approved' : 'rejected';
  const summary = `${tally.yes} Sim / ${tally.no} Não / ${tally.abstain} Abst. (${outcome.reason})`;
  db.prepare(
    `UPDATE assembly_agenda_items SET status = ?, outcome_summary = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, summary, itemId);
  return ok(res, { id: itemId, status, outcome });
});

export default router;
