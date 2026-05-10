// Resident "Transparência" — money out (expenses) and money owed (dues).
// Read-only view backed by /api/finance/expenses and /api/finance/statements.
import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileText, ReceiptText, Sparkles, Wallet } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatCurrency, formatDate, t, useLocale } from '../../lib/i18n';
import { CATEGORY_LABEL } from '../board/BoardFinancas';

interface Expense {
  id: number;
  amount_cents: number;
  currency: string;
  category: string;
  vendor: string | null;
  description: string;
  spent_at: string;
  receipt_url: string | null;
  related_proposal_id: number | null;
  related_proposal_title: string | null;
}

interface CategoryTotal { category: string; total_cents: number; count: number; }

interface ExpenseList {
  since: string;
  expenses: Expense[];
  totals_by_category: CategoryTotal[];
  total_cents: number;
}

interface Membership {
  status: string;
  unit_id: number;
  unit_number: string;
  building_name: string;
}

interface Invoice {
  id: number;
  amount_cents: number;
  currency: string;
  period: string;
  due_date: string;
  status: string;
  paid_cents: number;
  notes: string | null;
}

interface Statement {
  unit: { id: number; number: string; building_name: string };
  invoices: Invoice[];
  balance_cents: number;
  payments: Array<{ id: number }>;
}

type BadgeTone = 'neutral' | 'sage' | 'peach' | 'warning' | 'dark';

export default function Transparencia() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [data, setData] = useState<ExpenseList | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementLoading, setStatementLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    apiGet<ExpenseList>('/finance/expenses')
      .then((next) => { if (alive) setData(next); })
      .catch(() => { if (alive) setData(null); });

    apiGet<Membership[]>('/onboarding/me')
      .then(async (rows) => {
        if (!alive) return;
        const active = rows.filter((m) => m.status === 'active');
        setMemberships(active);
        if (active.length === 0) {
          setStatement(null);
          setStatementLoading(false);
          return;
        }
        try {
          const next = await apiGet<Statement>(`/finance/statements/${active[0].unit_id}`);
          if (alive) setStatement(next);
        } catch {
          if (alive) setStatement(null);
        } finally {
          if (alive) setStatementLoading(false);
        }
      })
      .catch(() => {
        if (!alive) return;
        setMemberships([]);
        setStatement(null);
        setStatementLoading(false);
      });

    return () => { alive = false; };
  }, []);

  return (
    <>
      <PageHeader
        title={tr('Transparência')}
        subtitle={tr('Tudo que o condomínio gastou nos últimos 12 meses. Cada lançamento traz fornecedor, valor e — quando disponível — o recibo.')}
      />

      <ResidentStatement
        statement={statement}
        memberships={memberships}
        loading={statementLoading}
        tr={tr}
      />

      {!data ? (
        <GlassCard className="p-6 text-sm text-dusk-300">{tr('Carregando…')}</GlassCard>
      ) : (
        <>
          {data.expenses.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <Sparkles className="w-8 h-8 mx-auto text-sage-700 mb-3" />
              <h3 className="font-display text-lg text-dusk-500">{tr('Sem despesas registradas ainda.')}</h3>
              <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
                {tr('Quando o síndico começar a lançar as despesas do prédio, elas aparecem aqui automaticamente — com valor, fornecedor e link do recibo.')}
              </p>
            </GlassCard>
          ) : (
            <>
              <CategoryBreakdown totals={data.totals_by_category} totalCents={data.total_cents} tr={tr} />

              <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3">{tr('Lançamentos')}</h2>
              <div className="space-y-2">
                {data.expenses.map((expense) => (
                  <GlassCard key={expense.id} variant="clay" className="p-4 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-dusk-500">{expense.description}</span>
                        <Badge tone="neutral">{tr(CATEGORY_LABEL[expense.category] || expense.category)}</Badge>
                        {expense.related_proposal_title && (
                          <Badge tone="sage">{tr('Proposta:')} {expense.related_proposal_title}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-dusk-300 mt-1">
                        {formatDate(expense.spent_at)}{expense.vendor && <> · {expense.vendor}</>}
                      </div>
                      {expense.receipt_url && (
                        <a
                          href={expense.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-dusk-400 hover:text-sage-700 mt-1.5 underline decoration-dotted underline-offset-4"
                        >
                          <ExternalLink className="w-3 h-3" /> {tr('ver recibo')}
                        </a>
                      )}
                    </div>
                    <div className="font-mono font-semibold text-dusk-500 shrink-0 self-center">
                      {formatCurrency(expense.amount_cents / 100)}
                    </div>
                  </GlassCard>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function ResidentStatement({
  statement,
  memberships,
  loading,
  tr,
}: {
  statement: Statement | null;
  memberships: Membership[];
  loading: boolean;
  tr: (key: string) => string;
}) {
  if (loading) {
    return <GlassCard className="p-6 text-sm text-dusk-300 mb-4">{tr('Carregando…')}</GlassCard>;
  }
  if (memberships.length === 0) {
    return (
      <GlassCard className="p-5 mb-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-peach-500 mt-0.5" />
        <div>
          <h3 className="font-display text-lg text-dusk-500">{tr('Minhas cobranças')}</h3>
          <p className="text-sm text-dusk-300">{tr('Nenhuma unidade ativa encontrada para exibir cobranças.')}</p>
        </div>
      </GlassCard>
    );
  }
  if (!statement) {
    return null;
  }

  const openInvoices = statement.invoices.filter((invoice) => {
    const paid = Number(invoice.paid_cents || 0);
    return invoice.status !== 'void' && paid < invoice.amount_cents;
  });
  const nextDue = [...openInvoices].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;

  return (
    <div className="space-y-3 mb-8">
      <GlassCard variant={statement.balance_cents > 0 ? 'clay' : 'clay-sage'} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-5 h-5 text-dusk-400" />
              <h3 className="font-display text-lg text-dusk-500">{tr('Minha unidade')}</h3>
              <Badge tone="neutral">{tr('Apto')} {statement.unit.number}</Badge>
            </div>
            <p className="text-xs text-dusk-300">{statement.unit.building_name}</p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-dusk-300">{tr('Saldo aberto')}</div>
            <div className="font-display text-2xl text-dusk-500">{formatCurrency(statement.balance_cents / 100)}</div>
            {statement.balance_cents === 0 && (
              <div className="inline-flex items-center gap-1 text-xs text-sage-700 mt-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {tr('Em dia')}
              </div>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          <Metric label={tr('Próximo vencimento')} value={nextDue ? formatDate(nextDue.due_date) : tr('Nenhuma cobrança aberta')} />
          <Metric label={tr('Pagamentos registrados')} value={String(statement.payments.length)} />
          <Metric label={tr('Minhas cobranças')} value={String(statement.invoices.length)} />
        </div>
      </GlassCard>

      <div>
        <h2 className="font-display text-xl text-dusk-500 mb-3">{tr('Minhas cobranças')}</h2>
        {statement.invoices.length === 0 ? (
          <GlassCard className="p-5 text-sm text-dusk-300">{tr('Sem cobranças geradas para sua unidade ainda.')}</GlassCard>
        ) : (
          <div className="space-y-2">
            {statement.invoices.slice(0, 6).map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} tr={tr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/45 border border-white/60 p-3">
      <div className="text-[11px] uppercase tracking-wider text-dusk-300">{label}</div>
      <div className="font-semibold text-dusk-500 mt-0.5">{value}</div>
    </div>
  );
}

function InvoiceRow({ invoice, tr }: { invoice: Invoice; tr: (key: string) => string }) {
  const paid = Number(invoice.paid_cents || 0);
  const remaining = Math.max(0, invoice.amount_cents - paid);
  const paidInFull = remaining === 0 || invoice.status === 'paid';
  const cancelled = invoice.status === 'void';
  const partial = !paidInFull && !cancelled && paid > 0;
  const label = cancelled ? tr('Cancelado') : paidInFull ? tr('Pago') : partial ? tr('Parcial') : tr('Aberto');
  const tone: BadgeTone = cancelled ? 'neutral' : paidInFull ? 'sage' : partial ? 'peach' : 'dark';

  return (
    <GlassCard variant="clay" className="p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-2xl bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
        <ReceiptText className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-dusk-500">{invoice.period}</span>
          <Badge tone={tone}>{label}</Badge>
          <span className="text-xs text-dusk-300">{tr('Vence em')} {formatDate(invoice.due_date)}</span>
        </div>
        {invoice.notes && <p className="text-xs text-dusk-300 mt-1">{invoice.notes}</p>}
        <div className="text-xs text-dusk-300 mt-1.5">
          {tr('Pago até agora')}: {formatCurrency(paid / 100)} · {tr('Restante')}: {formatCurrency(remaining / 100)}
        </div>
      </div>
      <div className="font-mono font-semibold text-dusk-500 shrink-0 self-center">
        {formatCurrency(invoice.amount_cents / 100, invoice.currency)}
      </div>
    </GlassCard>
  );
}

function CategoryBreakdown({
  totals,
  totalCents,
  tr,
}: {
  totals: CategoryTotal[];
  totalCents: number;
  tr: (key: string) => string;
}) {
  if (totals.length === 0) return null;
  const max = Math.max(...totals.map((row) => row.total_cents), 1);
  return (
    <GlassCard variant="clay-sage" className="p-6 mb-2">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-5 h-5 text-dusk-400" />
        <h3 className="font-display text-lg text-dusk-500">{tr('Para onde está indo o dinheiro')}</h3>
        <Badge tone="dark" className="ml-auto">{formatCurrency(totalCents / 100)}</Badge>
      </div>
      <div className="space-y-1.5">
        {totals.map((row) => {
          const pct = totalCents > 0 ? Math.round((row.total_cents / totalCents) * 100) : 0;
          return (
            <div key={row.category} className="flex items-center gap-3 text-sm">
              <span className="w-44 shrink-0 text-dusk-500 truncate">{tr(CATEGORY_LABEL[row.category] || row.category)}</span>
              <div className="flex-1 h-2 rounded-full bg-white/40 overflow-hidden">
                <div className="h-full bg-sage-400" style={{ width: `${(row.total_cents / max) * 100}%` }} />
              </div>
              <span className="w-28 text-right text-dusk-400 font-mono text-[13px]">{formatCurrency(row.total_cents / 100)}</span>
              <span className="w-12 text-right text-[11px] text-dusk-300">{pct}%</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-dusk-300 mt-4">
        {tr('Período: últimos 12 meses. Lançado pelo síndico — clique em cada item para ver o recibo, quando disponível.')}
      </p>
    </GlassCard>
  );
}
