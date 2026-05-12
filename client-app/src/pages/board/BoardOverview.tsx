import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Vote, Calendar, Users, ArrowRight, Bot, CheckCircle2, MessageCircle, Send, ShieldAlert, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatRelativeTime, t as translate } from '../../lib/i18n';

interface Proposal { id: number; title: string; status: string; votes: { yes: number; no: number; abstain: number; total: number }; }
interface Suggestion { id: number; body: string; status: string; }
interface Meeting { id: number; title: string; scheduled_for: string; status: string; }

interface AutoAction {
  id: number;
  title: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  remediation_status: string;
  blocked_reason: string | null;
  verified_at: string | null;
  agent_run_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

// Map a ticket row to the most-recent agent step + matching icon/copy.
// updated_at tracks the master clock; whichever state field is non-null
// and closest to updated_at is the event we surface. Order matters here:
// "resolved" trumps everything, then "blocked" (the admin needs to act),
// then forward progress states.
function autoActionDescriptor(row: AutoAction, tr: (k: string) => string) {
  if (row.remediation_status === 'resolved' && row.resolved_at) {
    return { icon: CheckCircle2, label: tr('Resolvido'), tone: 'sage' as const, at: row.resolved_at };
  }
  if (row.remediation_status === 'blocked_needs_admin') {
    const label = row.blocked_reason === 'vendor_no_response'
      ? tr('Sem resposta do fornecedor')
      : row.blocked_reason === 'no_vendor_in_category'
        ? tr('Sem fornecedor cadastrado')
        : tr('Precisa do síndico');
    return { icon: ShieldAlert, label, tone: 'peach' as const, at: row.agent_run_at || row.updated_at };
  }
  if (row.remediation_status === 'vendor_engaged') {
    return { icon: MessageCircle, label: tr('Fornecedor respondeu'), tone: 'sage' as const, at: row.updated_at };
  }
  if (row.remediation_status === 'awaiting_vendor') {
    return { icon: Send, label: tr('Fornecedor acionado'), tone: 'peach' as const, at: row.updated_at };
  }
  if (row.remediation_status === 'agent_dispatched' && row.agent_run_at) {
    return { icon: Bot, label: tr('IA gerou plano'), tone: 'peach' as const, at: row.agent_run_at };
  }
  if (row.verified_at) {
    return { icon: CheckCircle2, label: tr('Verificado'), tone: 'sage' as const, at: row.verified_at };
  }
  return { icon: Bot, label: row.remediation_status, tone: 'neutral' as const, at: row.updated_at };
}

export default function BoardOverview() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [condoName, setCondoName] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [autoActions, setAutoActions] = useState<AutoAction[]>([]);
  const tr = (k: string) => translate(k);

  useEffect(() => {
    let alive = true;
    const loads = [
      apiGet<Proposal[]>('/proposals').then(setProposals),
      apiGet<Suggestion[]>('/suggestions').then(setSuggestions),
      apiGet<Meeting[]>('/meetings').then(setMeetings),
      apiGet<any[]>('/users/residents').then(setResidents),
      apiGet<AutoAction[]>('/tickets/recent-auto-actions').then(setAutoActions),
      apiGet<Array<{ status: string; condo_name: string }>>('/onboarding/me').then((rows) => {
        const active = rows.find((r) => r.status === 'active');
        if (active) setCondoName(active.condo_name);
      }),
    ];
    Promise.allSettled(loads).then((results) => {
      if (!alive) return;
      setLoadError(results.some((r) => r.status === 'rejected')
        ? 'Alguns dados do painel não puderam ser carregados. Atualize ou entre novamente se persistir.'
        : null);
    });
    return () => { alive = false; };
  }, []);

  const openSuggestions = suggestions.filter((s) => s.status === 'open');
  const openProposals = proposals.filter((p) => p.status === 'voting' || p.status === 'discussion');
  const upcoming = meetings.filter((m) => new Date(m.scheduled_for) > new Date() && m.status !== 'completed');

  const STATUS_LABEL: Record<string, string> = {
    voting: 'em votação', discussion: 'em discussão', approved: 'aprovada',
    rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva',
  };

  return (
    <>
      <PageHeader
        title={<>Bem-vindo de volta, {user?.first_name}.</>}
        subtitle={condoName ? <>Tudo que precisa da sua atenção no {condoName}.</> : 'Tudo que precisa da sua atenção.'}
      />
      {loadError && (
        <GlassCard variant="clay-peach" className="p-4 mb-6 text-sm text-dusk-500">
          {loadError}
        </GlassCard>
      )}

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <Stat icon={Inbox}    color="peach" label="Sugestões novas"    value={openSuggestions.length} to="/board/suggestions" />
        <Stat icon={Vote}     color="sage"  label="Propostas ativas"   value={openProposals.length}   to="/board/proposals" />
        <Stat icon={Calendar} color="peach" label="Reuniões agendadas" value={upcoming.length}        to="/board/meetings" />
        <Stat icon={Users}    color="sage"  label="Moradores"          value={residents.length}       to="/board/residents" />
      </div>

      {autoActions.length > 0 && (
        <GlassCard variant="clay-sage" className="p-5 mb-6 animate-fade-up">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2">
              <Bot className="w-4 h-4" /> {tr('Agente em ação')}
            </h2>
            <Link to="/board/tickets" className="text-xs font-semibold text-dusk-400 hover:text-dusk-500 inline-flex items-center gap-1">
              {tr('Ver todos')} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <ul className="space-y-2">
            {autoActions.map((row) => {
              const evt = autoActionDescriptor(row, tr);
              const Icon = evt.icon;
              return (
                <li key={row.id}>
                  <Link to={`/board/tickets`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/60 border border-white/70 p-3 hover:bg-white/80">
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${evt.tone === 'sage' ? 'text-sage-700' : evt.tone === 'peach' ? 'text-peach-500' : 'text-dusk-300'}`} />
                      <div className="min-w-0">
                        <div className="text-sm text-dusk-500 truncate">{row.title}</div>
                        <div className="text-xs text-dusk-300">{evt.label}</div>
                      </div>
                    </div>
                    <div className="text-xs text-dusk-300 shrink-0">{formatRelativeTime(evt.at)}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </GlassCard>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard variant="clay-peach" className="p-7">
          <Badge tone="dark" className="mb-3"><Sparkles className="w-3 h-3" /> Caixa de IA</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">
            {openSuggestions.length === 1
              ? '1 sugestão de morador esperando'
              : <>{openSuggestions.length} sugestões de moradores esperando</>}
          </h2>
          <p className="text-sm text-dusk-300 mt-2">Agrupe, transforme em proposta ou descarte. Um clique cada.</p>
          <Link to="/board/suggestions" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            Abrir caixa <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>

        <GlassCard variant="clay-sage" className="p-7">
          <Badge tone="dark" className="mb-3">Reunião pronta?</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">Cole as anotações. Receba o resumo, tarefas e o comunicado pros moradores.</h2>
          <Link to="/board/meetings" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            Ver reuniões <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>
      </div>

      <h2 className="font-display text-xl text-dusk-500 mt-10 mb-4">Propostas ativas</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {openProposals.map((p) => (
          <Link key={p.id} to={`/board/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5">
              <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{STATUS_LABEL[p.status] || p.status}</Badge>
              <h3 className="font-semibold text-dusk-500 mt-2">{p.title}</h3>
              {p.status === 'voting' && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-sage-700 font-semibold">{p.votes.yes} sim</span>
                  <span className="text-peach-500 font-semibold">{p.votes.no} não</span>
                  <span className="text-dusk-200">{p.votes.abstain} abst.</span>
                </div>
              )}
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({ icon: Icon, color, label, value, to }: any) {
  return (
    <Link to={to}>
      <GlassCard variant="clay" hover className="p-5 h-full">
        <div className="flex items-start justify-between">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <ArrowRight className="w-4 h-4 text-dusk-200" />
        </div>
        <div className="mt-4 font-display text-3xl text-dusk-500">{value}</div>
        <div className="text-xs text-dusk-300 mt-0.5">{label}</div>
      </GlassCard>
    </Link>
  );
}
