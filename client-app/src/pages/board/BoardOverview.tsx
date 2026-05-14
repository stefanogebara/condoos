import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Vote, Calendar, Users, ArrowRight, Bot, CheckCircle2, MessageCircle, Send, ShieldAlert, Sparkles, AlertTriangle, UserPlus, Wallet, Waves } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatRelativeTime, t as translate } from '../../lib/i18n';

interface Proposal { id: number; title: string; status: string; votes: { yes: number; no: number; abstain: number; total: number }; }
interface Suggestion { id: number; body: string; status: string; }
interface Meeting { id: number; title: string; scheduled_for: string; status: string; }
interface PendingResident { id: number; first_name: string; last_name: string; unit_number: string | null; }
interface TicketSummary { needs_admin: number; blocked_no_vendor: number; blocked_no_response: number; verified_ready: number; awaiting_verification: number; }
interface ReceivablesSummary { total_open_cents: number; overdue_cents: number; open_invoice_count: number; overdue_invoice_count: number; }
interface DashboardAction {
  id: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  detail: string;
  href: string;
  icon: string;
}
interface DashboardPayload {
  actions: DashboardAction[];
  unread_count: number;
}

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

const ACTION_ICONS: Record<string, any> = {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Inbox,
  UserPlus,
  Vote,
  Wallet,
  Waves,
};

export default function BoardOverview() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [condoName, setCondoName] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [autoActions, setAutoActions] = useState<AutoAction[]>([]);
  const [pendingResidents, setPendingResidents] = useState<PendingResident[]>([]);
  const [ticketSummary, setTicketSummary] = useState<TicketSummary | null>(null);
  const [receivables, setReceivables] = useState<ReceivablesSummary | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const tr = (k: string) => translate(k);

  useEffect(() => {
    let alive = true;
    const loads = [
      apiGet<Proposal[]>('/proposals').then(setProposals),
      apiGet<Suggestion[]>('/suggestions').then(setSuggestions),
      apiGet<Meeting[]>('/meetings').then(setMeetings),
      apiGet<any[]>('/users/residents').then(setResidents),
      apiGet<AutoAction[]>('/tickets/recent-auto-actions').then(setAutoActions),
      apiGet<PendingResident[]>('/memberships/pending').then(setPendingResidents),
      apiGet<TicketSummary>('/tickets/summary').then(setTicketSummary),
      apiGet<ReceivablesSummary>('/finance/receivables').then(setReceivables),
      apiGet<DashboardPayload>('/dashboard/actions').then(setDashboard),
      apiGet<Array<{ status: string; condo_name: string }>>('/onboarding/me').then((rows) => {
        const active = rows.find((r) => r.status === 'active');
        if (active) setCondoName(active.condo_name);
      }),
    ];
    Promise.allSettled(loads).then((results) => {
      if (!alive) return;
      setLoadError(results.some((r) => r.status === 'rejected')
        ? tr('Alguns dados do painel não puderam ser carregados. Atualize ou entre novamente se persistir.')
        : null);
    });
    return () => { alive = false; };
  }, []);

  const openSuggestions = suggestions.filter((s) => s.status === 'open');
  const openProposals = proposals.filter((p) => p.status === 'voting' || p.status === 'discussion');
  const upcoming = meetings.filter((m) => new Date(m.scheduled_for) > new Date() && m.status !== 'completed');
  const urgentTicketCount = Number(ticketSummary?.needs_admin || 0) + Number(ticketSummary?.verified_ready || 0);

  const STATUS_LABEL: Record<string, string> = {
    voting: 'em votação', discussion: 'em discussão', approved: 'aprovada',
    rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva',
  };

  const attentionItems = useMemo(() => {
    if (dashboard?.actions?.length) {
      return dashboard.actions.map((action) => ({
        key: action.id,
        icon: ACTION_ICONS[action.icon] || AlertTriangle,
        tone: action.priority === 'urgent' || action.priority === 'high'
          ? 'warning' as const
          : action.priority === 'normal'
            ? 'peach' as const
            : 'sage' as const,
        title: tr(action.title),
        detail: tr(action.detail),
        to: action.href,
      }));
    }
    const items: Array<{
      key: string;
      icon: any;
      tone: 'sage' | 'peach' | 'warning';
      title: string;
      detail: string;
      to: string;
    }> = [];
    if (pendingResidents.length > 0) {
      const first = pendingResidents[0];
      items.push({
        key: 'pending-residents',
        icon: UserPlus,
        tone: 'warning',
        title: pendingResidents.length === 1 ? tr('1 resident waiting for approval') : `${pendingResidents.length} ${tr('residents waiting for approval')}`,
        detail: `${first.first_name} ${first.last_name}${first.unit_number ? ` · ${tr('Unidade')} ${first.unit_number}` : ''}`,
        to: '/board/pending',
      });
    }
    if (urgentTicketCount > 0) {
      // Split the detail copy by which signal is firing — admins want
      // to know whether the agent is BLOCKED (needs them to add a
      // vendor or unstick a stalled dispatch) vs simply WAITING for
      // approval (plan is ready, one click away). Different mental load.
      const blocked = Number(ticketSummary?.needs_admin || 0);
      const ready = Number(ticketSummary?.verified_ready || 0);
      let detail: string;
      if (blocked > 0 && ready > 0) {
        detail = `${blocked} ${tr('bloqueados')} · ${ready} ${tr('com plano da IA pronto')}`;
      } else if (blocked > 0) {
        detail = `${blocked} ${tr('bloqueados — precisa de você')}`;
      } else {
        detail = `${ready} ${tr('com plano da IA pronto para acionar')}`;
      }
      items.push({
        key: 'tickets',
        icon: AlertTriangle,
        tone: 'warning',
        title: urgentTicketCount === 1 ? tr('1 ticket needs attention') : `${urgentTicketCount} ${tr('tickets need attention')}`,
        detail,
        to: '/board/tickets',
      });
    }
    if (Number(receivables?.total_open_cents || 0) > 0) {
      items.push({
        key: 'receivables',
        icon: Wallet,
        tone: Number(receivables?.overdue_cents || 0) > 0 ? 'warning' : 'peach',
        title: `${formatCurrency(Number(receivables?.total_open_cents || 0) / 100)} ${tr('open in dues')}`,
        detail: Number(receivables?.overdue_cents || 0) > 0
          ? `${formatCurrency(Number(receivables?.overdue_cents || 0) / 100)} ${tr('overdue')}`
          : `${Number(receivables?.open_invoice_count || 0)} ${tr('open charges')}`,
        to: '/board/financas',
      });
    }
    if (openSuggestions.length > 0) {
      items.push({
        key: 'suggestions',
        icon: Inbox,
        tone: 'peach',
        title: openSuggestions.length === 1 ? tr('1 resident suggestion') : `${openSuggestions.length} ${tr('resident suggestions')}`,
        detail: tr('Cluster, promote, or dismiss before they pile up.'),
        to: '/board/suggestions',
      });
    }
    if (openProposals.length > 0) {
      items.push({
        key: 'proposals',
        icon: Vote,
        tone: 'sage',
        title: openProposals.length === 1 ? tr('1 active proposal') : `${openProposals.length} ${tr('active proposals')}`,
        detail: tr('Keep budgets, analysis, quorum, and voting windows moving.'),
        to: '/board/proposals',
      });
    }
    if (upcoming.length > 0) {
      items.push({
        key: 'meetings',
        icon: Calendar,
        tone: 'sage',
        title: upcoming.length === 1 ? tr('1 upcoming meeting') : `${upcoming.length} ${tr('upcoming meetings')}`,
        detail: tr('Prepare agenda, notes, decisions, and resident updates.'),
        to: '/board/meetings',
      });
    }
    if (items.length === 0) {
      items.push({
        key: 'clear',
        icon: CheckCircle2,
        tone: 'sage',
        title: tr('Nothing urgent right now'),
        detail: tr('Your building has no admin blockers in the command center.'),
        to: '/board',
      });
    }
    return items;
  }, [dashboard, openProposals.length, openSuggestions.length, pendingResidents, receivables, tr, upcoming.length, urgentTicketCount]);

  return (
    <>
      <PageHeader
        title={<>{tr('Bem-vindo de volta')}, {user?.first_name}.</>}
        subtitle={condoName ? <>{tr('Tudo que precisa da sua atenção no')} {condoName}.</> : tr('Tudo que precisa da sua atenção.')}
      />
      {loadError && (
        <GlassCard variant="clay-peach" className="p-4 mb-6 text-sm text-dusk-500">
          {loadError}
        </GlassCard>
      )}

      <GlassCard variant="clay-sage" className="p-5 mb-8">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-xl text-dusk-500">{tr('Command center')}</h2>
            <p className="text-sm text-dusk-300 mt-1">{tr('Start with what needs a decision, approval, or follow-up today.')}</p>
          </div>
          <Badge tone={attentionItems[0]?.key === 'clear' ? 'sage' : 'peach'}>
            {attentionItems[0]?.key === 'clear' ? tr('All clear') : `${attentionItems.length} ${tr('items')}`}
          </Badge>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {attentionItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} to={item.to} className="rounded-2xl bg-white/60 border border-white/70 p-4 hover:bg-white/80 transition flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  item.tone === 'sage' ? 'bg-sage-200 text-sage-700' : item.tone === 'warning' ? 'bg-peach-100 text-peach-600' : 'bg-peach-100 text-peach-500'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-dusk-500 truncate">{item.title}</div>
                  <div className="text-xs text-dusk-300 mt-0.5 line-clamp-1">{item.detail}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-dusk-300 shrink-0" />
              </Link>
            );
          })}
        </div>
      </GlassCard>

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
          <Badge tone="dark" className="mb-3"><Sparkles className="w-3 h-3" /> {tr('Caixa de IA')}</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">
            {openSuggestions.length === 1
              ? tr('1 sugestão de morador esperando')
              : <>{openSuggestions.length} {tr('sugestões de moradores esperando')}</>}
          </h2>
          <p className="text-sm text-dusk-300 mt-2">{tr('Agrupe, transforme em proposta ou descarte. Um clique cada.')}</p>
          <Link to="/board/suggestions" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            {tr('Abrir caixa')} <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>

        <GlassCard variant="clay-sage" className="p-7">
          <Badge tone="dark" className="mb-3">{tr('Reunião pronta?')}</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">{tr('Cole as anotações. Receba o resumo, tarefas e o comunicado pros moradores.')}</h2>
          <Link to="/board/meetings" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            {tr('Ver reuniões')} <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>
      </div>

      <h2 className="font-display text-xl text-dusk-500 mt-10 mb-4">{tr('Propostas ativas')}</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {openProposals.map((p) => (
          <Link key={p.id} to={`/board/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5">
              <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{tr(STATUS_LABEL[p.status] || p.status)}</Badge>
              <h3 className="font-semibold text-dusk-500 mt-2">{tr(p.title)}</h3>
              {p.status === 'voting' && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-sage-700 font-semibold">{p.votes.yes} {tr('sim')}</span>
                  <span className="text-peach-500 font-semibold">{p.votes.no} {tr('não')}</span>
                  <span className="text-dusk-200">{p.votes.abstain} {tr('abst.')}</span>
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
        <div className="text-xs text-dusk-300 mt-0.5">{translate(label)}</div>
      </GlassCard>
    </Link>
  );
}
