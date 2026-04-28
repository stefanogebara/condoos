import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Play, Check, X, Users, Gavel, FileText, Plus, Trash2 } from 'lucide-react';
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
  item_type: 'budget' | 'accounts' | 'bylaw' | 'election' | 'ordinary' | 'other';
  required_majority: 'simple' | 'two_thirds' | 'unanimous';
  status: 'pending' | 'active' | 'approved' | 'rejected' | 'inconclusive' | 'deferred';
  outcome_summary: string | null;
  tally: { yes: number; no: number; abstain: number; yes_weight: number; no_weight: number; abstain_weight: number; total_weight: number };
  outcome: { approved: boolean; reason: string };
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
  eligibility: { eligible_owner_count: number; eligible_total_weight: number; present_weight: number; turnout_percent: number };
}

const ITEM_TYPE_LABEL: Record<AgendaItem['item_type'], string> = {
  budget: 'Orçamento', accounts: 'Contas', bylaw: 'Convenção', election: 'Eleição', ordinary: 'Ordinária', other: 'Outros',
};

const MAJORITY_LABEL: Record<AgendaItem['required_majority'], string> = {
  simple: 'Maioria simples', two_thirds: '2/3 dos presentes', unanimous: 'Unanimidade',
};

const ASSEMBLY_STATUS_LABEL: Record<Assembly['status'], string> = {
  draft: 'rascunho', convoked: 'convocada', in_session: 'em sessão', closed: 'encerrada',
};

export default function BoardAssemblyDetail() {
  const { id } = useParams();
  const [a, setA] = useState<Assembly | null>(null);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', description: '', item_type: 'ordinary' as AgendaItem['item_type'], required_majority: 'simple' as AgendaItem['required_majority'] });

  const load = useCallback(() => apiGet<Assembly>(`/assemblies/${id}`).then(setA).catch(() => {}), [id]);
  useEffect(() => { load(); }, [load]);

  async function suggestAgenda() {
    setBusy(true);
    try {
      const out = await apiPost<{ items: any[] }>(`/ai/assemblies/${id}/suggest-agenda`);
      for (const item of out.items) {
        await apiPost(`/assemblies/${id}/agenda`, item);
      }
      toast.success(`IA redigiu ${out.items.length} itens da pauta`);
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Falha ao redigir com IA'); }
    finally { setBusy(false); }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/agenda`, newItem);
      setNewItem({ title: '', description: '', item_type: 'ordinary', required_majority: 'simple' });
      load();
    } finally { setBusy(false); }
  }

  async function removeItem(itemId: number) {
    if (!confirm('Remover este item da pauta?')) return;
    await apiDelete(`/assemblies/${id}/agenda/${itemId}`);
    load();
  }

  async function convoke() {
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/convoke`);
      toast.success('Convocada — moradores já podem confirmar presença e conceder procurações');
      load();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Falha'); }
    finally { setBusy(false); }
  }

  async function start() {
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/start`);
      toast.success('Sessão aberta');
      load();
    } finally { setBusy(false); }
  }

  async function openItem(itemId: number) {
    await apiPost(`/assemblies/${id}/agenda/${itemId}/open`);
    load();
  }

  async function closeItem(itemId: number) {
    const r = await apiPost<{ status: string }>(`/assemblies/${id}/agenda/${itemId}/close`);
    toast.success(`Item: ${statusLabel(r.status as AgendaItem['status'])}`);
    load();
  }

  async function closeAssembly() {
    if (!confirm('Encerrar a assembleia? Itens em votação serão fechados como inconclusivos e a ata vai ser gerada.')) return;
    setBusy(true);
    try {
      await apiPost(`/assemblies/${id}/close`);
      toast.success('Assembleia encerrada');
      load();
    } finally { setBusy(false); }
  }

  async function draftAta() {
    setBusy(true);
    try {
      const r = await apiPost<{ ata_markdown: string }>(`/ai/assemblies/${id}/draft-ata`);
      toast.success('Ata gerada');
      setA((prev) => prev ? { ...prev, ata_markdown: r.ata_markdown } : prev);
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Falha'); }
    finally { setBusy(false); }
  }

  if (!a) return null;

  return (
    <>
      <Link to="/board/assemblies" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>
      <PageHeader
        title={a.title}
        subtitle={`${a.kind === 'ordinary' ? 'AGO' : 'AGE'} · ${formatDateTime(a.first_call_at)}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {a.status === 'draft' && <Button variant="primary" onClick={convoke} loading={busy} leftIcon={<Gavel className="w-4 h-4" />}>Convocar</Button>}
            {a.status === 'convoked' && <Button variant="primary" onClick={start} loading={busy} leftIcon={<Play className="w-4 h-4" />}>Abrir sessão</Button>}
            {a.status === 'in_session' && <Button variant="primary" onClick={closeAssembly} loading={busy} leftIcon={<Check className="w-4 h-4" />}>Encerrar assembleia</Button>}
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Badge tone={a.status === 'in_session' ? 'sage' : a.status === 'closed' ? 'dark' : 'peach'}>{ASSEMBLY_STATUS_LABEL[a.status]}</Badge>
        <Badge tone="neutral">{a.eligibility.eligible_owner_count} proprietários elegíveis</Badge>
        {a.status === 'in_session' && (
          <Badge tone={a.eligibility.turnout_percent >= 50 ? 'sage' : 'peach'}>
            Presença: {a.eligibility.turnout_percent}%
          </Badge>
        )}
      </div>

      {/* Agenda */}
      <h3 className="font-display text-xl text-dusk-500 mb-3 flex items-center gap-2">
        <FileText className="w-5 h-5" /> Pauta ({a.agenda.length})
      </h3>

      {a.status === 'draft' && a.agenda.length === 0 && (
        <GlassCard variant="clay-sage" className="p-5 mb-4 text-center">
          <Sparkles className="w-8 h-8 mx-auto text-sage-700 mb-2" />
          <p className="text-dusk-400 text-sm mb-3">A IA monta uma pauta padrão de AGO a partir das propostas abertas.</p>
          <Button variant="primary" onClick={suggestAgenda} loading={busy} size="sm" leftIcon={<Sparkles className="w-4 h-4" />}>
            Redigir com IA
          </Button>
        </GlassCard>
      )}

      <div className="space-y-3 mb-6">
        {a.agenda.map((item) => (
          <GlassCard key={item.id} variant={item.status === 'active' ? 'clay-sage' : 'clay'} className="p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-dusk-300 font-mono">#{item.order_index}</span>
                  <h4 className="font-display text-lg text-dusk-500">{item.title}</h4>
                  <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                  <Badge tone="neutral">{ITEM_TYPE_LABEL[item.item_type]}</Badge>
                  <Badge tone="peach">{MAJORITY_LABEL[item.required_majority]}</Badge>
                </div>
                {item.description && <p className="text-sm text-dusk-400 mt-2">{item.description}</p>}
                {(item.tally.yes + item.tally.no + item.tally.abstain) > 0 && (
                  <div className="text-sm text-dusk-400 mt-2">
                    <span className="text-sage-700 font-medium">{item.tally.yes} Sim</span> · <span className="text-peach-700 font-medium">{item.tally.no} Não</span> · <span className="text-dusk-300">{item.tally.abstain} Abst.</span>
                    <span className="text-dusk-300 ml-2">(peso: Sim {item.tally.yes_weight.toFixed(1)} / Não {item.tally.no_weight.toFixed(1)})</span>
                  </div>
                )}
                {item.outcome_summary && <div className="text-xs text-dusk-300 mt-1 italic">{item.outcome_summary}</div>}
              </div>
              <div className="flex gap-2 flex-wrap">
                {a.status === 'draft' && (
                  <button onClick={() => removeItem(item.id)} className="text-dusk-300 hover:text-peach-600" title="Remover">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                {a.status === 'in_session' && item.status === 'pending' && (
                  <Button size="sm" variant="primary" onClick={() => openItem(item.id)} leftIcon={<Play className="w-3 h-3" />}>Abrir votação</Button>
                )}
                {a.status === 'in_session' && item.status === 'active' && (
                  <Button size="sm" variant="primary" onClick={() => closeItem(item.id)} leftIcon={<Check className="w-3 h-3" />}>Fechar votação</Button>
                )}
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {a.status === 'draft' && (
        <GlassCard className="p-5 mb-6">
          <form onSubmit={addItem} className="grid md:grid-cols-2 gap-3">
            <input className="input md:col-span-2" placeholder="Título do item (ex: Aprovar orçamento 2026)"
                   required value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} />
            <textarea className="input md:col-span-2 min-h-[70px]" placeholder="Descrição (opcional)"
                      value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
            <select className="input" value={newItem.item_type} onChange={(e) => setNewItem({ ...newItem, item_type: e.target.value as AgendaItem['item_type'] })}>
              <option value="ordinary">Ordinária</option>
              <option value="budget">Orçamento</option>
              <option value="accounts">Contas</option>
              <option value="bylaw">Convenção</option>
              <option value="election">Eleição</option>
              <option value="other">Outros</option>
            </select>
            <select className="input" value={newItem.required_majority} onChange={(e) => setNewItem({ ...newItem, required_majority: e.target.value as AgendaItem['required_majority'] })}>
              <option value="simple">Maioria simples</option>
              <option value="two_thirds">2/3 dos presentes</option>
              <option value="unanimous">Unanimidade</option>
            </select>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={busy} leftIcon={<Plus className="w-4 h-4" />}>Adicionar item</Button>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Attendance + proxies */}
      {(a.status === 'convoked' || a.status === 'in_session' || a.status === 'closed') && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <GlassCard className="p-5">
            <h4 className="font-display text-lg text-dusk-500 mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Presença ({a.attendance.length})</h4>
            {a.attendance.length === 0 ? (
              <p className="text-sm text-dusk-300">Ninguém se registrou ainda.</p>
            ) : (
              <ul className="text-sm text-dusk-400 space-y-1">
                {a.attendance.map((r: any) => (
                  <li key={r.id}>
                    • {r.first_name} {r.last_name}
                    {r.attended_as === 'proxy' && <span className="text-dusk-300"> (procurador de {r.proxy_first} {r.proxy_last})</span>}
                    {r.is_delinquent === 1 && <Badge tone="peach" className="ml-2">Inadimplente</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
          <GlassCard className="p-5">
            <h4 className="font-display text-lg text-dusk-500 mb-3">Procurações ({a.proxies.length})</h4>
            {a.proxies.length === 0 ? (
              <p className="text-sm text-dusk-300">Nenhuma procuração ativa.</p>
            ) : (
              <ul className="text-sm text-dusk-400 space-y-1">
                {a.proxies.map((p: any) => (
                  <li key={p.id}>• {p.grantor_first} {p.grantor_last} → {p.grantee_first} {p.grantee_last}</li>
                ))}
              </ul>
            )}
          </GlassCard>
        </div>
      )}

      {/* Ata */}
      {a.status === 'closed' && (
        <GlassCard variant="clay-sage" className="p-6 mb-6">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-display text-xl text-dusk-500 flex items-center gap-2"><FileText className="w-5 h-5" /> Ata</h3>
            <Button size="sm" variant="ghost" onClick={draftAta} loading={busy} leftIcon={<Sparkles className="w-4 h-4" />}>Repolir com IA</Button>
          </div>
          <div className="prose prose-sm max-w-none text-dusk-400 whitespace-pre-line font-mono text-xs leading-relaxed">
            {a.ata_markdown || '(a ata será gerada quando você encerrar a assembleia)'}
          </div>
        </GlassCard>
      )}
    </>
  );
}

function statusTone(s: AgendaItem['status']): any {
  if (s === 'active') return 'sage';
  if (s === 'approved') return 'sage';
  if (s === 'rejected') return 'peach';
  if (s === 'inconclusive') return 'peach';
  if (s === 'deferred') return 'neutral';
  return 'neutral';
}

function statusLabel(s: AgendaItem['status']): string {
  return {
    pending: 'pendente', active: 'votando', approved: 'aprovado',
    rejected: 'rejeitado', inconclusive: 'inconclusivo', deferred: 'adiado',
  }[s];
}
