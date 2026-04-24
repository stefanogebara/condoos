// Annual Assembly (AGO) — Brazilian condo legal compliance logic.
// Owners-only voting, proxy delegation, per-item quorum + majority check, ata generation.
import db from '../db';

export interface AssemblyRow {
  id: number;
  condominium_id: number;
  status: 'draft' | 'convoked' | 'in_session' | 'closed';
  title: string;
  kind: 'ordinary' | 'extraordinary';
  first_call_at: string;
  second_call_at: string | null;
}

export interface AgendaItemRow {
  id: number;
  assembly_id: number;
  title: string;
  description: string | null;
  item_type: 'budget' | 'accounts' | 'bylaw' | 'election' | 'ordinary' | 'other';
  required_majority: 'simple' | 'two_thirds' | 'unanimous';
  status: 'pending' | 'active' | 'approved' | 'rejected' | 'inconclusive' | 'deferred';
  order_index: number;
  outcome_summary: string | null;
  closed_at: string | null;
  source_proposal_id: number | null;
}

export interface AgendaTally {
  yes: number;
  no: number;
  abstain: number;
  yes_weight: number;
  no_weight: number;
  abstain_weight: number;
  total_weight: number;
}

export interface AgendaOutcome {
  tally: AgendaTally;
  required_majority: AgendaItemRow['required_majority'];
  approved: boolean;
  reason: string;
}

/**
 * Returns the set of owner user_ids in a condo eligible to vote.
 * Tenants and occupants do NOT vote in assemblies (Brazilian Civil Code).
 */
export function listEligibleOwners(condoId: number): Array<{ user_id: number; weight: number }> {
  const rows = db.prepare(
    `SELECT uu.user_id AS user_id, SUM(uu.voting_weight) AS weight
     FROM user_unit uu
     JOIN units u ON u.id = uu.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ?
       AND uu.relationship = 'owner'
       AND uu.status = 'active'
     GROUP BY uu.user_id`
  ).all(condoId) as Array<{ user_id: number; weight: number }>;
  return rows;
}

/**
 * Is this user allowed to vote in this assembly?
 * - Must be a condo owner (tenants/occupants cannot vote in AGO)
 * - Must not be flagged delinquent on their attendance row
 */
export function canVoteInAssembly(assemblyId: number, userId: number): {
  ok: boolean;
  reason?: string;
  effective_owner_id?: number;
  weight?: number;
} {
  const a = db.prepare(`SELECT id, condominium_id, status FROM assemblies WHERE id = ?`).get(assemblyId) as
    | { id: number; condominium_id: number; status: string }
    | undefined;
  if (!a) return { ok: false, reason: 'assembly_not_found' };
  if (a.status !== 'in_session') return { ok: false, reason: 'assembly_not_in_session' };

  // Delinquency — voter's own attendance row marked delinquent blocks voting.
  const att = db.prepare(
    `SELECT is_delinquent FROM assembly_attendance
     WHERE assembly_id = ? AND user_id = ? AND attended_as = 'self'`
  ).get(assemblyId, userId) as { is_delinquent: number } | undefined;
  if (att?.is_delinquent) return { ok: false, reason: 'delinquent' };

  const owners = listEligibleOwners(a.condominium_id);
  const self = owners.find((o) => o.user_id === userId);
  if (self) {
    return { ok: true, effective_owner_id: userId, weight: self.weight };
  }
  return { ok: false, reason: 'not_owner' };
}

/**
 * Resolve the effective_owner_id when a user is voting as proxy for someone else.
 * Returns null if the user has no active proxy grant from the target owner.
 */
export function resolveProxyVote(
  assemblyId: number,
  voterUserId: number,
  onBehalfOfUserId: number
): { ok: boolean; reason?: string; weight?: number } {
  const a = db.prepare(`SELECT condominium_id, status FROM assemblies WHERE id = ?`).get(assemblyId) as
    | { condominium_id: number; status: string }
    | undefined;
  if (!a || a.status !== 'in_session') return { ok: false, reason: 'assembly_not_in_session' };

  const grant = db.prepare(
    `SELECT id FROM assembly_proxies
     WHERE assembly_id = ? AND grantor_user_id = ? AND grantee_user_id = ? AND status = 'active'`
  ).get(assemblyId, onBehalfOfUserId, voterUserId);
  if (!grant) return { ok: false, reason: 'no_active_proxy' };

  const delinq = db.prepare(
    `SELECT is_delinquent FROM assembly_attendance
     WHERE assembly_id = ? AND proxy_for_user_id = ? AND attended_as = 'proxy'`
  ).get(assemblyId, onBehalfOfUserId) as { is_delinquent: number } | undefined;
  if (delinq?.is_delinquent) return { ok: false, reason: 'grantor_delinquent' };

  const owners = listEligibleOwners(a.condominium_id);
  const stake = owners.find((o) => o.user_id === onBehalfOfUserId);
  if (!stake) return { ok: false, reason: 'grantor_not_owner' };
  return { ok: true, weight: stake.weight };
}

export function getAgendaTally(agendaItemId: number): AgendaTally {
  const rows = db.prepare(
    `SELECT choice, SUM(weight) AS w, COUNT(*) AS c
     FROM assembly_votes WHERE agenda_item_id = ?
     GROUP BY choice`
  ).all(agendaItemId) as Array<{ choice: string; w: number; c: number }>;
  const out: AgendaTally = { yes: 0, no: 0, abstain: 0, yes_weight: 0, no_weight: 0, abstain_weight: 0, total_weight: 0 };
  for (const r of rows) {
    if (r.choice === 'yes')     { out.yes = r.c;     out.yes_weight = r.w; }
    if (r.choice === 'no')      { out.no = r.c;      out.no_weight = r.w; }
    if (r.choice === 'abstain') { out.abstain = r.c; out.abstain_weight = r.w; }
  }
  out.total_weight = out.yes_weight + out.no_weight + out.abstain_weight;
  return out;
}

/**
 * Decide whether an agenda item passes given its required_majority rule.
 * - simple:      yes > no (abstentions don't count against)
 * - two_thirds:  yes_weight >= 2/3 of (yes + no) — bylaw/extraordinary items
 * - unanimous:   no 'no' votes, and yes > 0
 */
export function resolveAgendaOutcome(
  tally: AgendaTally,
  required: AgendaItemRow['required_majority']
): AgendaOutcome {
  if (tally.yes_weight === 0 && tally.no_weight === 0) {
    return { tally, required_majority: required, approved: false, reason: 'no_votes_cast' };
  }
  if (required === 'unanimous') {
    const approved = tally.no_weight === 0 && tally.abstain_weight === 0 && tally.yes_weight > 0;
    return { tally, required_majority: required, approved, reason: approved ? 'unanimous' : 'non_unanimous' };
  }
  if (required === 'two_thirds') {
    const cast = tally.yes_weight + tally.no_weight;
    const approved = cast > 0 && tally.yes_weight / cast >= 2 / 3;
    return { tally, required_majority: required, approved, reason: approved ? 'two_thirds_met' : 'two_thirds_not_met' };
  }
  const approved = tally.yes_weight > tally.no_weight;
  return { tally, required_majority: required, approved, reason: approved ? 'simple_majority' : 'rejected_or_tie' };
}

/**
 * Generate a Brazilian-style ata markdown.
 * Lists attendance, agenda items, outcome per item, and the ending timestamp.
 */
export function generateAtaMarkdown(assemblyId: number): string {
  const a = db.prepare(
    `SELECT a.*, c.name AS condo_name
     FROM assemblies a
     JOIN condominiums c ON c.id = a.condominium_id
     WHERE a.id = ?`
  ).get(assemblyId) as any;
  if (!a) return '';

  const attendance = db.prepare(
    `SELECT u.first_name, u.last_name, att.attended_as, gu.first_name AS proxy_first, gu.last_name AS proxy_last
     FROM assembly_attendance att
     JOIN users u ON u.id = att.user_id
     LEFT JOIN users gu ON gu.id = att.proxy_for_user_id
     WHERE att.assembly_id = ?
     ORDER BY att.checked_in_at`
  ).all(assemblyId) as any[];

  const agenda = db.prepare(
    `SELECT * FROM assembly_agenda_items WHERE assembly_id = ? ORDER BY order_index`
  ).all(assemblyId) as AgendaItemRow[];

  const lines: string[] = [];
  lines.push(`# Ata da ${a.kind === 'ordinary' ? 'Assembleia Geral Ordinária' : 'Assembleia Geral Extraordinária'}`);
  lines.push(``);
  lines.push(`**Condomínio:** ${a.condo_name}`);
  lines.push(`**Título:** ${a.title}`);
  lines.push(`**Primeira chamada:** ${new Date(a.first_call_at).toLocaleString('pt-BR')}`);
  if (a.second_call_at) lines.push(`**Segunda chamada:** ${new Date(a.second_call_at).toLocaleString('pt-BR')}`);
  if (a.started_at)     lines.push(`**Início da sessão:** ${new Date(a.started_at).toLocaleString('pt-BR')}`);
  if (a.closed_at)      lines.push(`**Encerramento:** ${new Date(a.closed_at).toLocaleString('pt-BR')}`);
  lines.push(``);

  lines.push(`## Presença`);
  if (attendance.length === 0) {
    lines.push(`_Nenhuma presença registrada._`);
  } else {
    for (const r of attendance) {
      if (r.attended_as === 'proxy') {
        lines.push(`- ${r.first_name} ${r.last_name} (procurador de ${r.proxy_first} ${r.proxy_last})`);
      } else {
        lines.push(`- ${r.first_name} ${r.last_name}`);
      }
    }
  }
  lines.push(``);

  lines.push(`## Pauta e deliberações`);
  for (const item of agenda) {
    const tally = getAgendaTally(item.id);
    const outcome = resolveAgendaOutcome(tally, item.required_majority);
    lines.push(``);
    lines.push(`### ${item.order_index}. ${item.title}`);
    if (item.description) lines.push(item.description);
    lines.push(``);
    lines.push(`- Tipo: **${labelType(item.item_type)}** · Maioria exigida: **${labelMajority(item.required_majority)}**`);
    lines.push(`- Resultado: **${labelOutcome(item.status, outcome)}**`);
    lines.push(`- Votos: ${tally.yes} Sim (peso ${tally.yes_weight.toFixed(2)}), ${tally.no} Não (peso ${tally.no_weight.toFixed(2)}), ${tally.abstain} Abstenções (peso ${tally.abstain_weight.toFixed(2)})`);
    if (item.outcome_summary) {
      lines.push(``);
      lines.push(`> ${item.outcome_summary}`);
    }
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`_Ata gerada automaticamente pelo CondoOS em ${new Date().toLocaleString('pt-BR')}._`);
  return lines.join('\n');
}

function labelType(t: AgendaItemRow['item_type']): string {
  switch (t) {
    case 'budget':   return 'Previsão orçamentária';
    case 'accounts': return 'Prestação de contas';
    case 'bylaw':    return 'Alteração da convenção';
    case 'election': return 'Eleição';
    case 'ordinary': return 'Ordinária';
    default:         return 'Outros';
  }
}

function labelMajority(m: AgendaItemRow['required_majority']): string {
  switch (m) {
    case 'simple':     return 'Maioria simples';
    case 'two_thirds': return '2/3 dos presentes';
    case 'unanimous':  return 'Unanimidade';
  }
}

function labelOutcome(status: AgendaItemRow['status'], outcome: AgendaOutcome): string {
  switch (status) {
    case 'approved':     return 'APROVADO';
    case 'rejected':     return 'REPROVADO';
    case 'inconclusive': return 'INCONCLUSIVO';
    case 'deferred':     return 'ADIADO';
    case 'active':       return outcome.approved ? 'Em votação (tendência: aprovar)' : 'Em votação';
    default:             return 'Pendente';
  }
}
