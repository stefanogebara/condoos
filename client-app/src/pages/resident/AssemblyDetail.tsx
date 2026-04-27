import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Gavel, UserCheck, FileText, Users } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatDateTime } from '../../lib/i18n';

interface AgendaItem {
  id: number;
  order_index: number;
  title: string;
  description: string | null;
  item_type: string;
  required_majority: string;
  status: 'pending' | 'active' | 'approved' | 'rejected' | 'inconclusive' | 'deferred';
  outcome_summary: string | null;
  tally: { yes: number; no: number; abstain: number };
}

interface Assembly {
  id: number;
  title: string;
  kind: 'ordinary' | 'extraordinary';
  status: 'draft' | 'convoked' | 'in_session' | 'closed';
  first_call_at: string;
  second_call_at: string | null;
  ata_markdown: string | null;
  agenda: AgendaItem[];
  attendance: Array<any>;
  proxies: Array<any>;
  attendance_count: number;
  proxies_count: number;
  eligibility: { eligible_owner_count: number; turnout_percent: number; present_weight: number; eligible_total_weight: number };
  my: {
    grant: { id: number; grantee_first: string; grantee_last: string } | null;
    attendance: { id: number; attended_as: string } | null;
    can_vote: { ok: boolean; reason?: string };
  };
}

interface ResidentOpt { id: number; first_name: string; last_name: string; unit_number: string | null; }

export default function AssemblyDetail() {
  const { id } = useParams();
  const [a, setA] = useState<Assembly | null>(null);
  const [residents, setResidents] = useState<ResidentOpt[]>([]);
  const [proxyPick, setProxyPick] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  const load = useCallback(() => apiGet<Assembly>(`/assemblies/${id}`).then(setA).catch(() => {}), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiGet<ResidentOpt[]>('/users/residents').then(setResidents).catch(() => {}); }, []);

  async function grantProxy() {
    if (!proxyPick) return;
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/proxies`, { grantee_user_id: proxyPick });
      toast.success('Procuração concedida');
      setProxyPick('');
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  }

  async function revokeProxy() {
    if (!a?.my.grant) return;
    setBusy(true);
    try {
      await apiDelete(`/assemblies/${id}/proxies/${a.my.grant.id}`);
      toast.success('Procuração revogada');
      load();
    } finally { setBusy(false); }
  }

  async function checkIn() {
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/attendance`, {});
      setCheckedIn(true);
      toast.success('Presença registrada');
      load();
    } finally { setBusy(false); }
  }

  async function vote(itemId: number, choice: 'yes' | 'no' | 'abstain') {
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/agenda/${itemId}/vote`, { choice });
      toast.success(`Voto registrado: ${labelChoice(choice)}`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Vote failed');
    } finally { setBusy(false); }
  }

  if (!a) return null;

  const canAttend = a.status === 'in_session';
  const canGrantProxy = ['convoked', 'in_session'].includes(a.status) && !a.my.grant;
  const hasCheckedIn = checkedIn || !!a.my.attendance;

  return (
    <>
      <Link to="/app/assemblies" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>
      <PageHeader
        title={a.title}
        subtitle={`${a.kind === 'ordinary' ? 'AGO' : 'AGE'} · ${formatDateTime(a.first_call_at)}`}
      />

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Badge tone={a.status === 'in_session' ? 'sage' : a.status === 'closed' ? 'dark' : 'peach'}>{a.status.replace('_', ' ')}</Badge>
        {a.status === 'in_session' && <Badge tone="neutral">Turnout: {a.eligibility.turnout_percent}%</Badge>}
        {a.my.can_vote.ok
          ? <Badge tone="sage"><UserCheck className="w-3 h-3" /> Você pode votar</Badge>
          : a.my.can_vote.reason === 'not_owner'
            ? <Badge tone="neutral">Apenas proprietários votam</Badge>
            : a.my.can_vote.reason === 'delinquent'
              ? <Badge tone="peach">Inadimplente — voto bloqueado</Badge>
              : null}
      </div>

      {/* Proxy grant */}
      {canGrantProxy && (
        <GlassCard className="p-5 mb-6">
          <h4 className="font-display text-lg text-dusk-500 mb-1">Não poderá comparecer?</h4>
          <p className="text-sm text-dusk-400 mb-3">Conceda uma procuração a outro morador para votar em seu nome.</p>
          <div className="flex gap-2 flex-wrap">
            <select className="input flex-1 min-w-[200px]" value={proxyPick} onChange={(e) => setProxyPick(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Escolher morador…</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>{r.first_name} {r.last_name}{r.unit_number ? ` (Unit ${r.unit_number})` : ''}</option>
              ))}
            </select>
            <Button variant="primary" size="sm" onClick={grantProxy} disabled={!proxyPick} loading={busy}>Conceder procuração</Button>
          </div>
        </GlassCard>
      )}
      {a.my.grant && (
        <GlassCard variant="clay-peach" className="p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-peach-700 font-medium">Procuração ativa</div>
            <div className="text-dusk-500 mt-1">Você autorizou <strong>{a.my.grant.grantee_first} {a.my.grant.grantee_last}</strong> a votar em seu nome.</div>
          </div>
          <Button variant="ghost" size="sm" onClick={revokeProxy} loading={busy}>Revogar</Button>
        </GlassCard>
      )}

      {/* Check in */}
      {canAttend && !hasCheckedIn && (
        <GlassCard variant="clay-sage" className="p-5 mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-sage-700 font-medium">Sessão aberta</div>
            <div className="text-dusk-500 mt-1">Registre sua presença para votar.</div>
          </div>
          <Button variant="primary" size="sm" onClick={checkIn} loading={busy} leftIcon={<UserCheck className="w-4 h-4" />}>Check in</Button>
        </GlassCard>
      )}

      {/* Agenda + voting */}
      <h3 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2"><FileText className="w-5 h-5" /> Pauta</h3>
      <div className="space-y-3 mb-6">
        {a.agenda.map((item) => (
          <GlassCard key={item.id} variant={item.status === 'active' ? 'clay-sage' : 'clay'} className="p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-dusk-300 font-mono">#{item.order_index}</span>
                  <h4 className="font-display text-lg text-dusk-500">{item.title}</h4>
                  <Badge tone={itemTone(item.status)}>{itemLabel(item.status)}</Badge>
                </div>
                {item.description && <p className="text-sm text-dusk-400 mt-2">{item.description}</p>}
                {(item.tally.yes + item.tally.no + item.tally.abstain) > 0 && (
                  <div className="text-sm text-dusk-400 mt-2">
                    <span className="text-sage-700 font-medium">{item.tally.yes} Sim</span> · <span className="text-peach-700 font-medium">{item.tally.no} Não</span> · <span className="text-dusk-300">{item.tally.abstain} Abst.</span>
                  </div>
                )}
              </div>
              {item.status === 'active' && a.my.can_vote.ok && (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => vote(item.id, 'yes')}>Sim</Button>
                  <Button size="sm" variant="ghost" onClick={() => vote(item.id, 'no')}>Não</Button>
                  <Button size="sm" variant="ghost" onClick={() => vote(item.id, 'abstain')}>Abst.</Button>
                </div>
              )}
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Attendance summary */}
      <h3 className="font-display text-lg text-dusk-500 mb-2 flex items-center gap-2"><Users className="w-4 h-4" /> Presença ({a.attendance_count})</h3>
      <GlassCard className="p-4 mb-6">
        <p className="text-sm text-dusk-400">
          {a.attendance_count === 0
            ? 'Ninguém se registrou ainda.'
            : `${a.attendance_count} participante${a.attendance_count === 1 ? '' : 's'} registrado${a.attendance_count === 1 ? '' : 's'}.`}
        </p>
        <p className="text-xs text-dusk-300 mt-2">
          A lista nominal de presença e procurações fica visível apenas para o conselho.
        </p>
      </GlassCard>

      {/* Ata preview */}
      {a.status === 'closed' && a.ata_markdown && (
        <GlassCard variant="clay-sage" className="p-6">
          <h3 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2"><FileText className="w-5 h-5" /> Ata</h3>
          <div className="prose prose-sm max-w-none text-dusk-400 whitespace-pre-line font-mono text-xs leading-relaxed">
            {a.ata_markdown}
          </div>
        </GlassCard>
      )}
    </>
  );
}

function labelChoice(c: string): string { return c === 'yes' ? 'Sim' : c === 'no' ? 'Não' : 'Abstenção'; }

function itemTone(s: AgendaItem['status']): any {
  if (s === 'active') return 'sage';
  if (s === 'approved') return 'sage';
  if (s === 'rejected' || s === 'inconclusive') return 'peach';
  return 'neutral';
}

function itemLabel(s: AgendaItem['status']): string {
  return {
    pending: 'pending', active: 'voting', approved: 'approved',
    rejected: 'rejected', inconclusive: 'inconclusive', deferred: 'deferred',
  }[s];
}
