import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Copy,
  Download,
  FileText,
  Printer,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Vote,
  Wallet,
  Wrench,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { api, apiGet } from '../../lib/api';
import { formatCurrency, formatDate, t, useLocale } from '../../lib/i18n';

interface BoardPacket {
  month: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  condominium: { id: number; name: string; address: string | null };
  summary: {
    bullets: string[];
    expense_total_cents: number;
    open_dues_cents: number;
    overdue_dues_cents: number;
    open_ticket_count: number;
    urgent_ticket_count: number;
    active_work_order_count: number;
    active_proposal_count: number;
    upcoming_meeting_count: number;
    vendor_count: number;
  };
  finances: {
    currency: string;
    expenses_total_cents: number;
    expense_count: number;
    by_category: Array<{ category: string; total_cents: number; count: number }>;
    top_expenses: Array<{
      id: number;
      category: string;
      vendor: string | null;
      description: string;
      amount_cents: number;
      currency: string;
      spent_at: string;
      receipt_url: string | null;
    }>;
    receivables: {
      total_open_cents: number;
      overdue_cents: number;
      open_invoice_count: number;
      overdue_invoice_count: number;
      overdue_units: Array<{
        id: number;
        unit_number: string;
        building_name: string;
        due_date: string;
        remaining_cents: number;
        currency: string;
      }>;
    };
  };
  tickets: {
    created_count: number;
    resolved_count: number;
    open_count: number;
    urgent_open_count: number;
    by_status: Array<{ status: string; count: number }>;
    by_priority: Array<{ priority: string; count: number }>;
    active: Array<{
      id: number;
      title: string;
      priority: string;
      status: string;
      remediation_status: string | null;
      updated_at: string;
      reporter_name: string;
      unit_number: string | null;
    }>;
    work_orders: {
      total_count: number;
      open_count: number;
      completed_count: number;
      value_cents: number;
      active: Array<{
        id: number;
        ticket_id: number;
        title: string;
        status: string;
        vendor_name: string | null;
        scheduled_for: string | null;
        amount_cents: number | null;
      }>;
    };
  };
  proposals: {
    active_count: number;
    closed_count: number;
    by_status: Array<{ status: string; count: number }>;
    active: Array<{
      id: number;
      title: string;
      status: string;
      estimated_cost: number | null;
      voting_closes_at: string | null;
      yes_votes: number;
      no_votes: number;
      abstain_votes: number;
      created_at: string;
    }>;
  };
  meetings: {
    upcoming_count: number;
    completed_count: number;
    upcoming: Array<{ id: number; title: string; scheduled_for: string; status: string }>;
  };
  announcements: {
    count: number;
    recent: Array<{ id: number; title: string; pinned: number; created_at: string }>;
  };
  vendors: {
    count: number;
    open_work_count: number;
    tracked_spend_cents: number;
    response_rate_percent: number | null;
    top_by_work: Array<{
      id: number;
      company_name: string;
      category: string;
      work_orders_total: number;
      work_orders_open: number;
      work_order_value_cents: number;
      dispatches_total: number;
      dispatches_responded: number;
      expense_total_cents: number;
    }>;
  };
  risks: Array<{ level: 'high' | 'medium' | 'low'; title: string; detail: string; action: string }>;
  next_steps: string[];
  markdown: string;
}

function defaultMonth() {
  return new Date().toISOString().slice(0, 7);
}

function money(cents: number | null | undefined, currency = 'BRL') {
  return formatCurrency((cents || 0) / 100, currency);
}

function fileSafeMonth(month: string) {
  return month.replace(/[^0-9-]/g, '');
}

function translateToken(value: string | null | undefined, tr: (key: string) => string) {
  if (!value) return '';
  return tr(value.replace(/_/g, ' '));
}

function translateSavedText(value: string | null | undefined, tr: (key: string) => string) {
  if (!value) return '';
  return tr(value);
}

function riskTone(level: BoardPacket['risks'][number]['level']): 'warning' | 'peach' | 'sage' {
  if (level === 'high') return 'warning';
  if (level === 'medium') return 'peach';
  return 'sage';
}

function summaryBullets(packet: BoardPacket, tr: (key: string) => string) {
  return [
    `${money(packet.summary.expense_total_cents, packet.finances.currency)} ${tr('gastos registrados no mês')} · ${packet.finances.expense_count} ${tr(packet.finances.expense_count === 1 ? 'lançamento' : 'lançamentos')}.`,
    `${money(packet.summary.open_dues_cents, packet.finances.currency)} ${tr('em cobranças abertas')} · ${money(packet.summary.overdue_dues_cents, packet.finances.currency)} ${tr('em atraso')}.`,
    `${packet.summary.open_ticket_count} ${tr('chamados abertos')} · ${packet.summary.urgent_ticket_count} ${tr('urgentes')}.`,
    `${packet.summary.active_proposal_count} ${tr('propostas ativas')} · ${packet.summary.upcoming_meeting_count} ${tr('reuniões próximas')}.`,
  ];
}

function riskCards(packet: BoardPacket, tr: (key: string) => string) {
  return [
    packet.summary.urgent_ticket_count > 0 && {
      level: 'high' as const,
      title: `${packet.summary.urgent_ticket_count} ${tr('chamados urgentes abertos')}`,
      detail: tr('Problemas urgentes ainda esperam ação.'),
      action: tr('Revise a fila de chamados e atribua responsável ou fornecedor hoje.'),
    },
    packet.summary.overdue_dues_cents > 0 && {
      level: 'high' as const,
      title: `${money(packet.summary.overdue_dues_cents, packet.finances.currency)} ${tr('em atraso')}`,
      detail: `${packet.finances.receivables.overdue_invoice_count} ${tr('cobranças estão vencidas')}.`,
      action: tr('Envie lembrete de cobrança para as unidades em atraso.'),
    },
    packet.summary.active_work_order_count > 0 && {
      level: 'medium' as const,
      title: `${packet.summary.active_work_order_count} ${tr('ordens de serviço abertas')}`,
      detail: tr('Há reparos planejados que ainda não foram concluídos.'),
      action: tr('Confirme agenda, orçamento, recibo e foto de conclusão com o fornecedor.'),
    },
    packet.summary.vendor_count === 0 && {
      level: 'low' as const,
      title: tr('Nenhum fornecedor cadastrado'),
      detail: tr('O prédio ainda não tem rede operacional reutilizável.'),
      action: tr('Cadastre fornecedores de emergência, manutenção, elevador, limpeza e áreas comuns.'),
    },
  ].filter(Boolean) as Array<{ level: 'high' | 'medium' | 'low'; title: string; detail: string; action: string }>;
}

function nextSteps(packet: BoardPacket, tr: (key: string) => string) {
  const items = [
    packet.summary.urgent_ticket_count > 0 && tr('Resolver chamados urgentes ou atribuir acompanhamento no mesmo dia.'),
    packet.summary.overdue_dues_cents > 0 && tr('Enviar lembretes das cobranças vencidas.'),
    packet.summary.active_work_order_count > 0 && tr('Atualizar agenda, orçamento, recibo ou foto das ordens de serviço.'),
    packet.summary.active_proposal_count > 0 && tr('Revisar propostas ativas antes dos prazos de votação.'),
    packet.summary.upcoming_meeting_count > 0 && tr('Preparar pauta e pacote para as próximas reuniões.'),
  ].filter(Boolean) as string[];
  return items.length ? items : [tr('Nenhum risco crítico detectado este mês; mantenha o relatório atualizado antes da reunião.')];
}

export default function BoardReports() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [month, setMonth] = useState(defaultMonth());
  const [packet, setPacket] = useState<BoardPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const localizedSummary = useMemo(() => (packet ? summaryBullets(packet, tr) : []), [packet, locale]);
  const localizedRisks = useMemo(() => (packet ? riskCards(packet, tr) : []), [packet, locale]);
  const localizedSteps = useMemo(() => (packet ? nextSteps(packet, tr) : []), [packet, locale]);

  // Brand-new buildings produce a report where every SectionCard is just
  // a stack of "Nenhum X" placeholders. Detect that and collapse the four
  // detail cards into a single onboarding card so the admin sees a path
  // forward instead of a wall of empty mini-panels.
  const isZeroActivity = useMemo(() => {
    if (!packet) return false;
    return (
      packet.finances.expense_count === 0
      && packet.finances.receivables.open_invoice_count === 0
      && packet.summary.open_ticket_count === 0
      && packet.tickets.work_orders.active.length === 0
      && packet.proposals.active_count === 0
      && packet.proposals.closed_count === 0
      && packet.meetings.upcoming_count === 0
      && packet.meetings.completed_count === 0
      && packet.announcements.recent.length === 0
      && packet.vendors.count === 0
    );
  }, [packet]);

  const metrics = useMemo(() => {
    if (!packet) return [];
    return [
      {
        icon: ReceiptText,
        label: tr('Despesas do mês'),
        value: money(packet.summary.expense_total_cents, packet.finances.currency),
        detail: `${packet.finances.expense_count} ${tr(packet.finances.expense_count === 1 ? 'lançamento' : 'lançamentos')}`,
        tone: 'neutral' as const,
      },
      {
        icon: Wallet,
        label: tr('Cobranças em aberto'),
        value: money(packet.summary.open_dues_cents, packet.finances.currency),
        detail: `${packet.finances.receivables.overdue_invoice_count} ${tr('em atraso')}`,
        tone: packet.summary.overdue_dues_cents > 0 ? 'warning' as const : 'sage' as const,
      },
      {
        icon: AlertTriangle,
        label: tr('Chamados abertos'),
        value: String(packet.summary.open_ticket_count),
        detail: `${packet.summary.urgent_ticket_count} ${tr('urgentes')}`,
        tone: packet.summary.urgent_ticket_count > 0 ? 'warning' as const : 'neutral' as const,
      },
      {
        icon: Wrench,
        label: tr('Ordens abertas'),
        value: String(packet.summary.active_work_order_count),
        detail: tr('em andamento'),
        tone: packet.summary.active_work_order_count > 0 ? 'peach' as const : 'sage' as const,
      },
      {
        icon: Vote,
        label: tr('Propostas ativas'),
        value: String(packet.summary.active_proposal_count),
        detail: `${packet.proposals.closed_count} ${tr('fechadas no mês')}`,
        tone: 'neutral' as const,
      },
      {
        icon: CalendarDays,
        label: tr('Reuniões próximas'),
        value: String(packet.summary.upcoming_meeting_count),
        detail: tr('na agenda'),
        tone: 'neutral' as const,
      },
    ];
  }, [packet, locale]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<BoardPacket>(`/reports/board-packet?month=${encodeURIComponent(month)}`);
      setPacket(response);
    } catch (err: any) {
      setError(err?.response?.data?.error || tr('Não foi possível carregar relatório'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyPacket() {
    if (!packet) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(packet.markdown);
      }
      toast.success(tr('Pacote copiado'));
    } catch {
      toast.error(tr('Não foi possível copiar'));
    }
  }

  function downloadMarkdown() {
    if (!packet) return;
    const blob = new Blob([packet.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `condoos-board-packet-${fileSafeMonth(packet.month)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPdf() {
    if (!packet) return;
    try {
      const response = await api.get(`/reports/board-packet.pdf?month=${encodeURIComponent(packet.month)}`, { responseType: 'blob' });
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `condoos-board-packet-${fileSafeMonth(packet.month)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(tr('Não foi possível baixar PDF'));
    }
  }

  return (
    <>
      <PageHeader
        title={tr('Relatórios')}
        subtitle={tr('Pacote mensal para conselho, administração e reunião de prestação de contas.')}
        actions={
          <>
            <label className="inline-flex items-center gap-2 rounded-full bg-white/55 px-4 py-2 text-sm font-semibold text-dusk-400 shadow-clay">
              <span className="hidden sm:inline">{tr('Mês do relatório')}</span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="bg-transparent outline-none"
                aria-label={tr('Mês do relatório')}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              onClick={load}
              loading={loading}
              leftIcon={<RefreshCw className="w-4 h-4" />}
              data-testid="board-packet-refresh"
            >
              {tr('Atualizar')}
            </Button>
          </>
        }
      />

      {error && (
        <GlassCard variant="clay-peach" className="mb-5 p-4 text-sm text-dusk-500">
          {error}
        </GlassCard>
      )}

      {loading && !packet ? (
        <GlassCard className="p-6 text-sm text-dusk-300">{tr('Carregando relatório…')}</GlassCard>
      ) : packet ? (
        <div className="space-y-6" data-testid="board-packet-page">
          <GlassCard variant="clay" className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-dusk-500">
                  <ClipboardList className="h-5 w-5 text-sage-600" />
                  <h2 className="font-display text-2xl">{packet.condominium.name}</h2>
                </div>
                <p className="mt-1 text-sm text-dusk-300">
                  {tr('Dados gerados em')} {formatDate(packet.generated_at)} · {formatDate(packet.period_start)} {tr('até')} {formatDate(packet.period_end)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={copyPacket} leftIcon={<Copy className="w-4 h-4" />} data-testid="board-packet-copy">
                  {tr('Copiar pacote')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={downloadMarkdown} leftIcon={<Download className="w-4 h-4" />} data-testid="board-packet-download">
                  {tr('Baixar Markdown')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={downloadPdf} leftIcon={<FileText className="w-4 h-4" />} data-testid="board-packet-pdf">
                  {tr('Baixar PDF')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => window.print()} leftIcon={<Printer className="w-4 h-4" />}>
                  {tr('Imprimir')}
                </Button>
              </div>
            </div>
          </GlassCard>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </div>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2 text-dusk-500">
              <FileText className="h-5 w-5 text-sage-600" />
              <h2 className="font-display text-xl">{tr('Resumo executivo')}</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {localizedSummary.map((bullet) => (
                <div key={bullet} className="rounded-3xl bg-white/55 p-4 text-sm text-dusk-400">
                  {bullet}
                </div>
              ))}
            </div>
          </GlassCard>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <GlassCard className="p-5">
              <div className="flex items-center gap-2 text-dusk-500">
                <AlertTriangle className="h-5 w-5 text-peach-500" />
                <h2 className="font-display text-xl">{tr('Riscos e próximos passos')}</h2>
              </div>
              <div className="mt-4 space-y-3">
                {localizedRisks.length === 0 ? (
                  <div className="rounded-3xl bg-sage-50/80 p-4 text-sm text-dusk-400">
                    {tr('Sem riscos críticos detectados.')}
                  </div>
                ) : localizedRisks.map((risk) => (
                  <div key={`${risk.level}-${risk.title}`} className="rounded-3xl bg-white/55 p-4">
                    <Badge tone={riskTone(risk.level)}>{tr(risk.level)}</Badge>
                    <h3 className="mt-3 font-display text-lg text-dusk-500">{risk.title}</h3>
                    <p className="mt-1 text-sm text-dusk-300">{risk.detail}</p>
                    <p className="mt-2 text-sm font-semibold text-dusk-400">{risk.action}</p>
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500">{tr('Próximos passos')}</h2>
              <ol className="mt-4 space-y-3">
                {localizedSteps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm text-dusk-400">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage-100 text-xs font-bold text-sage-700">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </GlassCard>
          </div>

          {isZeroActivity ? <ZeroActivityCard tr={tr} /> : (
          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard title={tr('Finanças')} icon={<Wallet className="h-5 w-5 text-sage-600" />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <MiniPanel title={tr('Categorias de despesa')}>
                  {packet.finances.by_category.length === 0 ? (
                    <EmptyLine>{tr('Nenhuma despesa neste mês.')}</EmptyLine>
                  ) : packet.finances.by_category.map((row) => (
                    <KeyValue
                      key={row.category}
                      label={`${translateToken(row.category, tr)} · ${row.count}`}
                      value={money(row.total_cents, packet.finances.currency)}
                    />
                  ))}
                </MiniPanel>
                <MiniPanel title={tr('Unidades em atraso')}>
                  {packet.finances.receivables.overdue_units.length === 0 ? (
                    <EmptyLine>{tr('Nenhuma unidade em atraso.')}</EmptyLine>
                  ) : packet.finances.receivables.overdue_units.map((unit) => (
                    <KeyValue
                      key={unit.id}
                      label={`${unit.building_name} ${unit.unit_number} · ${formatDate(unit.due_date)}`}
                      value={money(unit.remaining_cents, unit.currency)}
                    />
                  ))}
                </MiniPanel>
              </div>
              <MiniPanel title={tr('Maiores despesas')} className="mt-3">
                {packet.finances.top_expenses.length === 0 ? (
                  <EmptyLine>{tr('Nenhuma despesa neste mês.')}</EmptyLine>
                ) : packet.finances.top_expenses.map((expense) => (
                  <KeyValue
                    key={expense.id}
                    label={`${translateSavedText(expense.vendor, tr) || tr('Sem fornecedor')} · ${translateSavedText(expense.description, tr)}`}
                    value={money(expense.amount_cents, expense.currency)}
                  />
                ))}
              </MiniPanel>
            </SectionCard>

            <SectionCard title={tr('Operação')} icon={<Wrench className="h-5 w-5 text-sage-600" />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <MiniPanel title={tr('Chamados por status')}>
                  {packet.tickets.by_status.map((row) => (
                    <KeyValue key={row.status} label={translateToken(row.status, tr)} value={String(row.count)} />
                  ))}
                </MiniPanel>
                <MiniPanel title={tr('Chamados por prioridade')}>
                  {packet.tickets.by_priority.length === 0 ? (
                    <EmptyLine>{tr('Nenhum chamado ativo.')}</EmptyLine>
                  ) : packet.tickets.by_priority.map((row) => (
                    <KeyValue key={row.priority} label={translateToken(row.priority, tr)} value={String(row.count)} />
                  ))}
                </MiniPanel>
              </div>
              <MiniPanel title={tr('Chamados ativos')} className="mt-3">
                {packet.tickets.active.length === 0 ? (
                  <EmptyLine>{tr('Nenhum chamado ativo.')}</EmptyLine>
                ) : (
                  <>
                    {/* The "Operação" card was spamming 7+ identical ticket
                        rows on the report, drowning out the rest of the
                        finance/votação cards. Show the 3 most recent and
                        link out to /board/tickets for the long tail.
                        Reports is a summary surface, not a duplicate
                        of the chamados list. */}
                    {packet.tickets.active.slice(0, 3).map((ticket) => (
                      <KeyValue
                        key={ticket.id}
                        label={`${translateSavedText(ticket.title, tr)} · ${ticket.unit_number || ticket.reporter_name}`}
                        value={translateToken(ticket.priority, tr)}
                      />
                    ))}
                    {packet.tickets.active.length > 3 && (
                      <Link
                        to="/board/tickets"
                        className="mt-2 inline-flex items-center text-xs font-medium text-dusk-400 hover:text-dusk-500 underline-offset-4 hover:underline"
                      >
                        {tr('Ver todos os')} {packet.tickets.active.length} {tr('chamados ativos')} →
                      </Link>
                    )}
                  </>
                )}
              </MiniPanel>
              <MiniPanel title={tr('Ordens de serviço ativas')} className="mt-3">
                {packet.tickets.work_orders.active.length === 0 ? (
                  <EmptyLine>{tr('Nenhuma ordem ativa.')}</EmptyLine>
                ) : packet.tickets.work_orders.active.map((order) => (
                  <KeyValue
                    key={order.id}
                    label={`${translateSavedText(order.title, tr)} · ${translateSavedText(order.vendor_name, tr) || tr('Sem fornecedor')}`}
                    value={order.amount_cents ? money(order.amount_cents, packet.finances.currency) : translateToken(order.status, tr)}
                  />
                ))}
              </MiniPanel>
            </SectionCard>

            <SectionCard title={tr('Votações e reuniões')} icon={<Vote className="h-5 w-5 text-sage-600" />}>
              <MiniPanel title={tr('Propostas em andamento')}>
                {packet.proposals.active.length === 0 ? (
                  <EmptyLine>{tr('Nenhuma proposta ativa.')}</EmptyLine>
                ) : packet.proposals.active.map((proposal) => (
                  <KeyValue
                    key={proposal.id}
                    label={`${translateSavedText(proposal.title, tr)} · ${translateToken(proposal.status, tr)}`}
                    value={`${proposal.yes_votes} ${tr('Sim')} · ${proposal.no_votes} ${tr('Não')}`}
                  />
                ))}
              </MiniPanel>
              <MiniPanel title={tr('Próximas reuniões')} className="mt-3">
                {packet.meetings.upcoming.length === 0 ? (
                  <EmptyLine>{tr('Nenhuma reunião próxima.')}</EmptyLine>
                ) : packet.meetings.upcoming.map((meeting) => (
                  <KeyValue key={meeting.id} label={translateSavedText(meeting.title, tr)} value={formatDate(meeting.scheduled_for)} />
                ))}
              </MiniPanel>
              <MiniPanel title={tr('Comunicados recentes')} className="mt-3">
                {packet.announcements.recent.length === 0 ? (
                  <EmptyLine>{tr('Nenhum comunicado recente.')}</EmptyLine>
                ) : packet.announcements.recent.map((announcement) => (
                  <KeyValue key={announcement.id} label={translateSavedText(announcement.title, tr)} value={formatDate(announcement.created_at)} />
                ))}
              </MiniPanel>
            </SectionCard>

            <SectionCard title={tr('Fornecedores')} icon={<BarChart3 className="h-5 w-5 text-sage-600" />}>
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat label={tr('Rede operacional')} value={String(packet.vendors.count)} />
                <MiniStat
                  label={tr('Taxa média de resposta')}
                  value={packet.vendors.response_rate_percent == null ? tr('Sem histórico') : `${packet.vendors.response_rate_percent}%`}
                />
                <MiniStat label={tr('Gasto rastreado')} value={money(packet.vendors.tracked_spend_cents, packet.finances.currency)} />
              </div>
              <MiniPanel title={tr('Fornecedores')} className="mt-3">
                {packet.vendors.top_by_work.length === 0 ? (
                  <EmptyLine>{tr('Nenhum fornecedor cadastrado.')}</EmptyLine>
                ) : packet.vendors.top_by_work.map((vendor) => (
                  <KeyValue
                    key={vendor.id}
                    label={`${translateSavedText(vendor.company_name, tr)} · ${translateToken(vendor.category, tr)}`}
                    value={`${vendor.work_orders_open}/${vendor.work_orders_total}`}
                  />
                ))}
              </MiniPanel>
            </SectionCard>
          </div>
          )}
        </div>
      ) : null}
    </>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'sage' | 'peach' | 'warning';
}) {
  const toneClass = {
    neutral: 'bg-white/65',
    sage: 'bg-sage-50/85',
    peach: 'bg-peach-50/85',
    warning: 'bg-amber-50/90',
  }[tone];
  return (
    <div className={`rounded-[2rem] p-5 shadow-clay ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-dusk-300">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-3 font-display text-3xl text-dusk-500">{value}</div>
      <div className="mt-1 text-sm text-dusk-300">{detail}</div>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2 text-dusk-500">
        {icon}
        <h2 className="font-display text-xl">{title}</h2>
      </div>
      {children}
    </GlassCard>
  );
}

function MiniPanel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-dusk-300">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-white/55 px-4 py-3 text-sm">
      <span className="min-w-0 text-dusk-400">{label}</span>
      <span className="shrink-0 font-semibold text-dusk-500">{value}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/55 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dusk-300">{label}</div>
      <div className="mt-1 font-display text-xl text-dusk-500">{value}</div>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white/45 px-4 py-3 text-sm text-dusk-300">{children}</div>;
}

function ZeroActivityCard({ tr }: { tr: (key: string) => string }) {
  const actions: Array<{ to: string; icon: React.ReactNode; title: string; detail: string }> = [
    {
      to: '/board/financas',
      icon: <Wallet className="h-5 w-5 text-sage-600" />,
      title: tr('Lançar primeira despesa'),
      detail: tr('Comece pelas contas fixas (luz, água, portaria).'),
    },
    {
      to: '/board/tickets',
      icon: <Wrench className="h-5 w-5 text-sage-600" />,
      title: tr('Abrir primeiro chamado'),
      detail: tr('Registre manutenções e reparos com fornecedor.'),
    },
    {
      to: '/board/proposals',
      icon: <Vote className="h-5 w-5 text-sage-600" />,
      title: tr('Criar primeira proposta'),
      detail: tr('Coloque uma decisão em votação dos moradores.'),
    },
    {
      to: '/board/services',
      icon: <BarChart3 className="h-5 w-5 text-sage-600" />,
      title: tr('Cadastrar fornecedor no diretório'),
      detail: tr('Monte a rede operacional reutilizável do prédio.'),
    },
  ];
  return (
    <GlassCard variant="clay" className="p-6">
      <div className="flex items-center gap-2 text-dusk-500">
        <Sparkles className="h-5 w-5 text-sage-600" />
        <h2 className="font-display text-xl">{tr('Mês ainda sem movimentação')}</h2>
      </div>
      <p className="mt-2 text-sm text-dusk-300">
        {tr('Esse relatório mostra o que aconteceu no mês. Comece por uma das ações abaixo para preencher o pacote.')}
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="group flex items-start gap-3 rounded-3xl bg-white/55 p-4 shadow-clay transition hover:bg-white/75"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sage-100">
              {action.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-dusk-500">{action.title}</span>
                <ArrowRight className="h-4 w-4 text-dusk-300 transition group-hover:translate-x-0.5 group-hover:text-sage-600" />
              </div>
              <p className="mt-1 text-xs text-dusk-300">{action.detail}</p>
            </div>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}
