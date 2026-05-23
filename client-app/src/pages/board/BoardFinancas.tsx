// Admin "Finanças" — money in (dues/payments) + money out (expenses).
// Residents see the read-only mirror in /app/transparencia.
import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Plus,
  ReceiptText,
  Trash2,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatCurrency, formatDate, t } from '../../lib/i18n';
import { openUploadedFile, uploadFileToCondoOS } from '../../lib/uploads';

interface Expense {
  id: number;
  amount_cents: number;
  currency: string;
  category: string;
  vendor: string | null;
  description: string;
  admin_explanation: string | null;
  spent_at: string;
  receipt_url: string | null;
  receipt_file_id: number | null;
  receipt_file_name: string | null;
  related_proposal_id: number | null;
  related_proposal_title: string | null;
  created_at: string;
}

interface CategoryTotal { category: string; total_cents: number; count: number; }

interface ExpenseList {
  since: string;
  expenses: Expense[];
  totals_by_category: CategoryTotal[];
  total_cents: number;
  currency: string;
}

interface DuesSchedule {
  id: number;
  name: string;
  amount_cents: number;
  currency: string;
  frequency: 'monthly' | 'quarterly' | 'annual' | 'one_time';
  due_day: number;
  active: number;
  created_at: string;
}

interface ReceivableUnit {
  unit_id: number;
  unit_number: string;
  building_name: string;
  resident_names: string;
  open_cents: number;
  overdue_cents: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  oldest_due_date: string | null;
}

interface ReceivableInvoice {
  id: number;
  unit_id: number;
  unit_number: string;
  building_name: string;
  resident_names: string;
  schedule_id: number | null;
  schedule_name: string | null;
  amount_cents: number;
  paid_cents: number;
  remaining_cents: number;
  currency: string;
  period: string;
  due_date: string;
  status: string;
  raw_status: string;
  notes: string | null;
  created_at: string;
}

interface Receivables {
  total_open_cents: number;
  overdue_cents: number;
  open_invoice_count: number;
  overdue_invoice_count: number;
  unit_count: number;
  units: ReceivableUnit[];
  invoices: ReceivableInvoice[];
}

interface BudgetCategorySummary {
  category: string;
  budget_cents: number;
  actual_cents: number;
  variance_cents: number;
  expense_count: number;
  receipt_count: number;
  receipt_coverage_percent: number;
  currency: string;
  notes: string | null;
}

interface BudgetSummary {
  month: string;
  currency: string;
  total_budget_cents: number;
  total_actual_cents: number;
  variance_cents: number;
  expense_count: number;
  receipt_count: number;
  receipt_coverage_percent: number;
  over_budget_category_count: number;
  categories: BudgetCategorySummary[];
}

interface PaymentProof {
  id: number;
  invoice_id: number;
  resident_user_id: number;
  file_id: number;
  amount_cents: number;
  method: string;
  reference: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
  rejection_reason: string | null;
  payment_id: number | null;
  created_at: string;
  unit_number: string;
  building_name: string;
  resident_name: string;
  file_name: string | null;
  currency: string;
  period: string;
  due_date: string;
}

export const EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'maintenance',    label: 'Manutenção' },
  { value: 'utilities',      label: 'Contas (luz, água, gás)' },
  { value: 'cleaning',       label: 'Limpeza' },
  { value: 'security',       label: 'Segurança / portaria' },
  { value: 'staff',          label: 'Funcionários' },
  { value: 'admin',          label: 'Administração' },
  { value: 'infrastructure', label: 'Obras / infraestrutura' },
  { value: 'amenity',        label: 'Áreas comuns' },
  { value: 'insurance',      label: 'Seguro' },
  { value: 'tax',            label: 'Impostos / taxas' },
  { value: 'reserve',        label: 'Fundo de reserva' },
  { value: 'other',          label: 'Outros' },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label]),
);

const FREQUENCY_LABEL: Record<DuesSchedule['frequency'], string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  annual: 'Anual',
  one_time: 'Uma vez',
};

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function dueDateInputFor(period: string, day = 10) {
  const safeDay = String(Math.min(Math.max(day || 10, 1), 28)).padStart(2, '0');
  return `${period}-${safeDay}`;
}

function parseAmountToCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function parseBudgetAmountToCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function amountInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function openInvoices(receivables: Receivables | null) {
  return (receivables?.invoices || [])
    .filter((invoice) => invoice.raw_status !== 'void' && invoice.remaining_cents > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

function exportReceivablesCsv(receivables: Receivables | null) {
  if (!receivables) return;
  const headers = [
    'unit',
    'building',
    'residents',
    'period',
    'due_date',
    'status',
    'amount',
    'paid',
    'remaining',
    'schedule',
    'notes',
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = receivables.invoices.map((invoice) => [
    invoice.unit_number,
    invoice.building_name,
    invoice.resident_names,
    invoice.period,
    invoice.due_date,
    invoice.status,
    (invoice.amount_cents / 100).toFixed(2),
    (invoice.paid_cents / 100).toFixed(2),
    (invoice.remaining_cents / 100).toFixed(2),
    invoice.schedule_name || '',
    invoice.notes || '',
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `condoos-receivables-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BoardFinancas() {
  const [data, setData] = useState<ExpenseList | null>(null);
  const [schedules, setSchedules] = useState<DuesSchedule[]>([]);
  const [receivables, setReceivables] = useState<Receivables | null>(null);
  const [budgetMonth, setBudgetMonth] = useState(currentPeriod());
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(null);
  const [paymentProofs, setPaymentProofs] = useState<PaymentProof[]>([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<ReceivableInvoice | null>(null);

  const load = async () => {
    const [expensesNext, schedulesNext, receivablesNext, budgetSummaryNext, paymentProofsNext] = await Promise.all([
      apiGet<ExpenseList>('/finance/expenses'),
      apiGet<DuesSchedule[]>('/finance/schedules'),
      apiGet<Receivables>('/finance/receivables'),
      apiGet<BudgetSummary>(`/finance/budget-summary?month=${budgetMonth}`),
      apiGet<PaymentProof[]>('/finance/payment-proofs'),
    ]);
    setData(expensesNext);
    setSchedules(schedulesNext);
    setReceivables(receivablesNext);
    setBudgetSummary(budgetSummaryNext);
    setPaymentProofs(paymentProofsNext);
  };

  useEffect(() => {
    load().catch(() => {
      setData(null);
      setReceivables(null);
      setBudgetSummary(null);
      toast.error(t('Não foi possível carregar finanças'));
    });
  }, [budgetMonth]);

  const invoicesOpen = useMemo(() => openInvoices(receivables), [receivables]);

  return (
    <>
      <PageHeader
        title={t('Finanças')}
        subtitle={t('Controle cobranças, pagamentos, despesas e recibos em um só lugar. Moradores veem a parte transparente sem editar nada.')}
        actions={
          <>
            <Button
              variant={showInvoiceForm ? 'ghost' : 'primary'}
              leftIcon={showInvoiceForm ? <X className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4" />}
              onClick={() => setShowInvoiceForm((x) => !x)}
            >
              {showInvoiceForm ? t('Cancelar') : t('Gerar cobranças')}
            </Button>
            <Button
              variant={showExpenseForm ? 'ghost' : 'sage'}
              leftIcon={showExpenseForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              onClick={() => setShowExpenseForm((x) => !x)}
            >
              {showExpenseForm ? t('Cancelar') : t('Nova despesa')}
            </Button>
          </>
        }
      />

      <FinanceHealth receivables={receivables} />

      <BudgetSummaryPanel
        summary={budgetSummary}
        month={budgetMonth}
        onMonthChange={setBudgetMonth}
        onSaved={load}
      />

      <PaymentProofReviewPanel proofs={paymentProofs} onChanged={load} />

      {showScheduleForm && (
        <ScheduleForm
          onCreated={() => {
            setShowScheduleForm(false);
            load();
          }}
        />
      )}

      {showInvoiceForm && (
        <GenerateInvoicesForm
          schedules={schedules}
          units={receivables?.units || []}
          onCreated={() => {
            setShowInvoiceForm(false);
            load();
          }}
        />
      )}

      <div className="grid xl:grid-cols-[0.9fr_1.4fr] gap-6 mb-8">
        <DuesSchedulePanel
          schedules={schedules}
          onNew={() => setShowScheduleForm((x) => !x)}
        />
        <ReceivablesPanel
          receivables={receivables}
          invoices={invoicesOpen}
          onPay={setPaymentTarget}
          onExport={() => exportReceivablesCsv(receivables)}
        />
      </div>

      {showExpenseForm && (
        <NewExpenseForm
          onCreated={() => {
            setShowExpenseForm(false);
            load();
          }}
        />
      )}

      <CategorySummary totals={data?.totals_by_category || []} totalCents={data?.total_cents || 0} currency={data?.currency || 'BRL'} />

      <h2 className="font-display text-xl text-dusk-500 mb-3">{t('Lançamentos')}</h2>
      {!data ? (
        <GlassCard className="p-6 text-sm text-dusk-300">{t('Carregando…')}</GlassCard>
      ) : data.expenses.length === 0 ? (
        <GlassCard className="p-6 text-sm text-dusk-300 flex flex-col items-center gap-3 text-center">
          <span>{t('Nenhuma despesa registrada nos últimos 12 meses. Comece pelas contas fixas (luz, água, condomínio da empresa de portaria).')}</span>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setShowExpenseForm(true)}
          >
            {t('Lançar primeira despesa')}
          </Button>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {data.expenses.map((e) => <ExpenseRow key={e.id} expense={e} onDeleted={load} />)}
        </div>
      )}

      {paymentTarget && (
        <PaymentModal
          invoice={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => {
            setPaymentTarget(null);
            load();
          }}
        />
      )}
    </>
  );
}

function BudgetSummaryPanel({
  summary,
  month,
  onMonthChange,
  onSaved,
}: {
  summary: BudgetSummary | null;
  month: string;
  onMonthChange: (month: string) => void;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!summary) {
      setDrafts({});
      return;
    }
    const next: Record<string, string> = {};
    summary.categories.forEach((row) => {
      next[row.category] = row.budget_cents > 0 ? amountInput(row.budget_cents) : '';
    });
    setDrafts(next);
  }, [summary]);

  if (!summary) {
    return (
      <GlassCard className="p-5 mb-6 text-sm text-dusk-300">
        {t('Carregando…')}
      </GlassCard>
    );
  }

  const remaining = summary.total_budget_cents - summary.total_actual_cents;
  const budgetUsed = summary.total_budget_cents > 0
    ? Math.round((summary.total_actual_cents / summary.total_budget_cents) * 100)
    : 0;
  const visibleRows = summary.categories.filter((row) => row.budget_cents > 0 || row.actual_cents > 0);
  const rows = visibleRows.length > 0 ? visibleRows : summary.categories;

  async function saveTargets() {
    if (!summary) return;
    setSaving(true);
    try {
      const targets = summary.categories.map((row) => {
        const amount = parseBudgetAmountToCents(drafts[row.category] || '');
        if (amount === null) {
          throw new Error('invalid_amount');
        }
        return {
          category: row.category,
          amount_cents: amount,
        };
      });

      await apiPost('/finance/budget-targets/bulk', {
        month,
        currency: summary.currency || 'BRL',
        targets,
      });
      toast.success(t('Orçamento salvo'));
      onSaved();
    } catch (err: any) {
      if (err?.message === 'invalid_amount') {
        toast.error(t('Valor inválido — use números (ex: 1500 ou 1500,00)'));
      } else {
        toast.error(err?.response?.data?.error || t('Falha ao salvar orçamento'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-xl text-dusk-500">{t('Orçamento vs realizado')}</h2>
          <p className="text-sm text-dusk-300 mt-1">
            {t('Defina o teto mensal por categoria e acompanhe o gasto real lançado.')}
          </p>
        </div>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Mês')}
          <input
            className="input mt-1 w-44"
            type="month"
            value={month}
            onChange={(e) => onMonthChange(e.target.value || currentPeriod())}
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <BudgetMetric
          label={t('Orçamento do mês')}
          value={formatCurrency(summary.total_budget_cents / 100, summary.currency)}
        />
        <BudgetMetric
          label={t('Gasto atual')}
          value={formatCurrency(summary.total_actual_cents / 100, summary.currency)}
        />
        <BudgetMetric
          label={t(remaining < 0 ? 'Acima do orçamento' : 'Sobra no orçamento')}
          value={formatCurrency(Math.abs(remaining) / 100, summary.currency)}
        />
        <BudgetMetric
          label={t('Cobertura de recibos')}
          value={`${summary.receipt_coverage_percent}%`}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Badge tone={summary.total_budget_cents > 0 && budgetUsed > 100 ? 'warning' : 'sage'}>
          {summary.total_budget_cents > 0 ? `${budgetUsed}% ${t('do orçamento usado')}` : t('O orçamento ainda não foi configurado para este mês.')}
        </Badge>
        <Badge tone={summary.receipt_coverage_percent >= 80 ? 'sage' : 'peach'}>
          {summary.receipt_count}/{summary.expense_count} {t('com recibo')}
        </Badge>
        {summary.over_budget_category_count > 0 && (
          <Badge tone="warning">
            {summary.over_budget_category_count} {t('Categorias acima do orçamento')}
          </Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-3xl border border-white/70 bg-white/35">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-dusk-300">
              <th className="px-4 py-3">{t('Categoria')}</th>
              <th className="px-4 py-3">{t('Meta do mês')}</th>
              <th className="px-4 py-3 text-right">{t('Realizado')}</th>
              <th className="px-4 py-3 text-right">{t('Diferença')}</th>
              <th className="px-4 py-3">{t('Recibos anexados')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowUsed = row.budget_cents > 0
                ? Math.min(100, Math.round((row.actual_cents / row.budget_cents) * 100))
                : row.actual_cents > 0 ? 100 : 0;
              const rowOver = row.budget_cents > 0 && row.actual_cents > row.budget_cents;
              return (
                <tr key={row.category} className="border-t border-white/60 align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-dusk-500">{t(CATEGORY_LABEL[row.category] || row.category)}</div>
                    {row.notes && <div className="text-xs text-dusk-300 mt-0.5">{row.notes}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="input h-10 max-w-[150px]"
                      inputMode="decimal"
                      placeholder={t('Sem meta')}
                      value={drafts[row.category] || ''}
                      onChange={(e) => setDrafts({ ...drafts, [row.category]: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-dusk-500">
                    {formatCurrency(row.actual_cents / 100, row.currency)}
                    <div className="h-1.5 rounded-full bg-white/60 overflow-hidden mt-2">
                      <div className={`h-full ${rowOver ? 'bg-amber-500' : 'bg-sage-400'}`} style={{ width: `${rowUsed}%` }} />
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${row.variance_cents < 0 ? 'text-amber-800' : 'text-sage-700'}`}>
                    {row.budget_cents > 0
                      ? formatCurrency(Math.abs(row.variance_cents) / 100, row.currency)
                      : t('Sem meta')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={row.receipt_coverage_percent >= 80 ? 'sage' : row.expense_count > 0 ? 'peach' : 'neutral'}>
                      {row.receipt_count}/{row.expense_count} · {row.receipt_coverage_percent}%
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {summary.expense_count === 0 && (
        <p className="text-xs text-dusk-300 mt-3">{t('Nenhum gasto lançado neste mês.')}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <p className="text-xs text-dusk-300">{t('Use valores zerados para limpar uma meta.')}</p>
        <Button
          variant="primary"
          loading={saving}
          leftIcon={<Wallet className="w-4 h-4" />}
          onClick={() => saveTargets()}
        >
          {t('Salvar orçamento do mês')}
        </Button>
      </div>
    </GlassCard>
  );
}

function BudgetMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/55 border border-white/70 p-4">
      <div className="text-[11px] uppercase tracking-wider text-dusk-300">{label}</div>
      <div className="font-display text-2xl text-dusk-500 mt-0.5">{value}</div>
    </div>
  );
}

function PaymentProofReviewPanel({
  proofs,
  onChanged,
}: {
  proofs: PaymentProof[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingProof, setRejectingProof] = useState<PaymentProof | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const pending = proofs.filter((proof) => proof.status === 'pending');

  function closeRejectModal() {
    setRejectingProof(null);
    setRejectReason('');
  }

  useEffect(() => {
    if (!rejectingProof) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRejectModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rejectingProof]);

  async function approve(proof: PaymentProof) {
    setBusyId(proof.id);
    try {
      await apiPost(`/finance/payment-proofs/${proof.id}/approve`, {});
      toast.success(t('Comprovante aprovado'));
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao aprovar comprovante'));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(proof: PaymentProof, reason: string) {
    if (!reason.trim()) {
      toast.error(t('Informe o motivo para o morador corrigir o envio.'));
      return;
    }
    setBusyId(proof.id);
    try {
      await apiPost(`/finance/payment-proofs/${proof.id}/reject`, {
        reason: reason.trim(),
      });
      toast.success(t('Comprovante rejeitado'));
      closeRejectModal();
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao rejeitar comprovante'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <GlassCard className="p-5 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-xl text-dusk-500">{t('Comprovantes pendentes')}</h2>
            <p className="text-sm text-dusk-300 mt-1">{t('Revise recibos enviados por moradores antes de registrar o pagamento.')}</p>
          </div>
          <Badge tone={pending.length > 0 ? 'peach' : 'sage'}>
            {pending.length} {t('pendente')}
          </Badge>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-2xl bg-white/55 border border-white/70 p-4 text-sm text-dusk-300">
            {t('Nenhum comprovante pendente.')}
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((proof) => (
              <div key={proof.id} className="rounded-2xl bg-white/55 border border-white/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-dusk-500">{t('Unidade')} {proof.unit_number}</span>
                      <Badge tone="neutral">{proof.resident_name}</Badge>
                      <Badge tone="warning">{t('Aguardando revisão')}</Badge>
                    </div>
                    <p className="text-xs text-dusk-300 mt-1">
                      {proof.period} · {formatDate(proof.due_date)} · {proof.method}
                      {proof.reference ? ` · ${proof.reference}` : ''}
                    </p>
                    {proof.note && <p className="text-xs text-dusk-400 mt-1.5">{proof.note}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold text-dusk-500">
                      {formatCurrency(proof.amount_cents / 100, proof.currency)}
                    </div>
                    <div className="text-xs text-dusk-300">{formatDate(proof.created_at)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<ExternalLink className="w-4 h-4" />}
                    onClick={() => openUploadedFile(proof.file_id, proof.file_name || 'payment-proof')}
                  >
                    {t('Abrir comprovante')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === proof.id}
                    onClick={() => {
                      setRejectingProof(proof);
                      setRejectReason('');
                    }}
                  >
                    {t('Rejeitar')}
                  </Button>
                  <Button
                    size="sm"
                    variant="sage"
                    loading={busyId === proof.id}
                    leftIcon={<CheckCircle2 className="w-4 h-4" />}
                    onClick={() => approve(proof)}
                  >
                    {t('Aprovar comprovante')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {rejectingProof && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-dusk-500/30 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="reject-proof-title">
          <div className="w-full max-w-lg rounded-[2rem] border border-white/70 bg-cream-50/95 p-5 shadow-clay">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="reject-proof-title" className="font-display text-2xl text-dusk-500">{t('Rejeitar comprovante')}</h3>
                <p className="mt-1 text-sm text-dusk-300">
                  {t('Informe o motivo para o morador corrigir o envio.')}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full bg-white/70 p-2 text-dusk-300 transition hover:text-dusk-500"
                onClick={closeRejectModal}
                aria-label={t('Cancelar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 rounded-2xl bg-white/55 border border-white/70 p-3 text-sm text-dusk-400">
              <div className="font-semibold text-dusk-500">{t('Unidade')} {rejectingProof.unit_number}</div>
              <div>{rejectingProof.resident_name} · {formatCurrency(rejectingProof.amount_cents / 100, rejectingProof.currency)}</div>
            </div>
            <label className="mt-4 block text-sm font-semibold text-dusk-400">
              {t('Motivo da rejeição')}
              <textarea
                className="input mt-2 min-h-[120px] resize-y"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder={t('Ex.: recibo ilegível, valor divergente ou comprovante de outra cobrança.')}
                autoFocus
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeRejectModal}>
                {t('Cancelar')}
              </Button>
              <Button
                type="button"
                variant="peach"
                disabled={!rejectReason.trim()}
                loading={busyId === rejectingProof.id}
                onClick={() => reject(rejectingProof, rejectReason)}
              >
                {t('Rejeitar comprovante')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FinanceHealth({ receivables }: { receivables: Receivables | null }) {
  const open = receivables?.total_open_cents || 0;
  const overdue = receivables?.overdue_cents || 0;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
      <MetricCard
        icon={Wallet}
        label={t('Saldo aberto')}
        value={formatCurrency(open / 100)}
        tone={open > 0 ? 'peach' : 'sage'}
      />
      <MetricCard
        icon={AlertTriangle}
        label={t('Em atraso')}
        value={formatCurrency(overdue / 100)}
        tone={overdue > 0 ? 'warning' : 'sage'}
      />
      <MetricCard
        icon={ReceiptText}
        label={t('Cobranças abertas')}
        value={String(receivables?.open_invoice_count || 0)}
        tone="neutral"
      />
      <MetricCard
        icon={CheckCircle2}
        label={t('Unidades')}
        value={String(receivables?.unit_count || 0)}
        tone="sage"
      />
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone: 'neutral' | 'sage' | 'peach' | 'warning';
}) {
  const color = tone === 'sage'
    ? 'bg-sage-200 text-sage-700'
    : tone === 'warning'
      ? 'bg-amber-100 text-amber-800'
      : tone === 'peach'
        ? 'bg-peach-100 text-peach-500'
        : 'bg-white/70 text-dusk-400';
  return (
    <GlassCard variant="clay" className="p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-dusk-300">{label}</div>
        <div className="font-display text-2xl text-dusk-500">{value}</div>
      </div>
    </GlassCard>
  );
}

function DuesSchedulePanel({ schedules, onNew }: { schedules: DuesSchedule[]; onNew: () => void }) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-xl text-dusk-500">{t('Regras de cobrança')}</h2>
          <p className="text-sm text-dusk-300 mt-1">{t('Defina o valor recorrente que vira cobrança para as unidades.')}</p>
        </div>
        <Button size="sm" variant="ghost" leftIcon={<Plus className="w-4 h-4" />} onClick={onNew}>
          {t('Nova regra')}
        </Button>
      </div>

      {schedules.length === 0 ? (
        <div className="rounded-2xl bg-white/55 border border-white/70 p-5 text-sm text-dusk-300 flex flex-col items-start gap-3">
          <span>{t('Nenhuma regra de cobrança ainda. Crie a mensalidade do condomínio ou uma taxa recorrente.')}</span>
          <Button size="sm" variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={onNew}>
            {t('Criar primeira regra')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="rounded-2xl bg-white/55 border border-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-dusk-500">{schedule.name}</span>
                    <Badge tone={schedule.active ? 'sage' : 'neutral'}>{schedule.active ? t('ativo') : t('inativo')}</Badge>
                  </div>
                  <p className="text-xs text-dusk-300 mt-1">
                    {t(FREQUENCY_LABEL[schedule.frequency])} · {t('vence dia')} {schedule.due_day}
                  </p>
                </div>
                <div className="font-mono font-semibold text-dusk-500 shrink-0">
                  {formatCurrency(schedule.amount_cents / 100, schedule.currency)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function ReceivablesPanel({
  receivables,
  invoices,
  onPay,
  onExport,
}: {
  receivables: Receivables | null;
  invoices: ReceivableInvoice[];
  onPay: (invoice: ReceivableInvoice) => void;
  onExport: () => void;
}) {
  const topUnits = (receivables?.units || [])
    .filter((unit) => unit.open_cents > 0)
    .sort((a, b) => b.open_cents - a.open_cents)
    .slice(0, 4);

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-xl text-dusk-500">{t('Cobranças e pagamentos')}</h2>
          <p className="text-sm text-dusk-300 mt-1">{t('Veja saldos por unidade e registre pagamentos manuais quando entrarem.')}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Download className="w-4 h-4" />}
          onClick={onExport}
          disabled={!receivables?.invoices?.length}
        >
          {t('Exportar CSV')}
        </Button>
      </div>

      {topUnits.length > 0 && (
        <div className="grid md:grid-cols-2 gap-2 mb-4">
          {topUnits.map((unit) => (
            <div key={unit.unit_id} className="rounded-2xl bg-white/55 border border-white/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-dusk-500">{t('Unidade')} {unit.unit_number}</div>
                <Badge tone={unit.overdue_cents > 0 ? 'warning' : 'peach'}>
                  {formatCurrency(unit.open_cents / 100)}
                </Badge>
              </div>
              <p className="text-xs text-dusk-300 mt-1 truncate">
                {unit.resident_names || t('Sem morador ativo')} · {unit.oldest_due_date ? `${t('Vence em')} ${formatDate(unit.oldest_due_date)}` : t('Sem vencimento')}
              </p>
            </div>
          ))}
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="rounded-2xl bg-white/55 border border-white/70 p-4 text-sm text-dusk-300">
          {t('Nenhum saldo aberto. Gere cobranças quando começar o próximo ciclo.')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-dusk-300">
                <th className="py-2 pr-3">{t('Unidade')}</th>
                <th className="py-2 pr-3">{t('Cobrança')}</th>
                <th className="py-2 pr-3">{t('Vencimento')}</th>
                <th className="py-2 pr-3 text-right">{t('Restante')}</th>
                <th className="py-2 pr-3">{t('Status')}</th>
                <th className="py-2 text-right">{t('Ação')}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0, 12).map((invoice) => (
                <tr key={invoice.id} className="border-t border-white/60">
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-dusk-500">{invoice.unit_number}</div>
                    <div className="text-xs text-dusk-300 truncate max-w-[180px]">{invoice.resident_names || invoice.building_name}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="text-dusk-500">{invoice.schedule_name || t('Cobrança avulsa')}</div>
                    <div className="text-xs text-dusk-300">{invoice.period}</div>
                  </td>
                  <td className="py-3 pr-3 text-dusk-400">{formatDate(invoice.due_date)}</td>
                  <td className="py-3 pr-3 text-right font-mono font-semibold text-dusk-500">
                    {formatCurrency(invoice.remaining_cents / 100, invoice.currency)}
                  </td>
                  <td className="py-3 pr-3">
                    <InvoiceStatusBadge invoice={invoice} />
                  </td>
                  <td className="py-3 text-right">
                    <Button size="sm" variant="ghost" leftIcon={<CreditCard className="w-4 h-4" />} onClick={() => onPay(invoice)}>
                      {t('Registrar pago')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.length > 12 && (
            <p className="text-xs text-dusk-300 mt-3">{t('Mostrando as 12 cobranças abertas mais antigas. Exporte CSV para ver tudo.')}</p>
          )}
        </div>
      )}
    </GlassCard>
  );
}

function InvoiceStatusBadge({ invoice }: { invoice: ReceivableInvoice }) {
  if (invoice.status === 'overdue') return <Badge tone="warning">{t('Em atraso')}</Badge>;
  if (invoice.paid_cents > 0) return <Badge tone="peach">{t('Parcial')}</Badge>;
  return <Badge tone="dark">{t('Aberto')}</Badge>;
}

function ScheduleForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    name: t('Mensalidade do condomínio'),
    amount: '',
    frequency: 'monthly' as DuesSchedule['frequency'],
    due_day: 10,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(form.amount);
    if (!cents) {
      toast.error(t('Valor inválido — use números (ex: 1500 ou 1500,00)'));
      return;
    }
    setSaving(true);
    try {
      await apiPost('/finance/schedules', {
        name: form.name.trim(),
        amount_cents: cents,
        frequency: form.frequency,
        due_day: form.due_day,
      });
      toast.success(t('Regra de cobrança criada'));
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao salvar'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-6 mb-6 animate-fade-up">
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">{t('Nova regra de cobrança')}</h3>
      <p className="text-sm text-dusk-300 mt-1">{t('Use para mensalidade do condomínio, fundo de reserva ou cobranças recorrentes.')}</p>
      <form onSubmit={submit} className="grid md:grid-cols-4 gap-3 mt-4">
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Nome')}
          <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Valor')}
          <input className="input mt-1" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t('ex: 1500 ou 1500,00')} required />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Vence dia')}
          <input className="input mt-1" type="number" min={1} max={28} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: Number(e.target.value) || 10 })} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Frequência')}
          <select className="input mt-1" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as DuesSchedule['frequency'] })}>
            {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{t(label)}</option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2 flex items-end justify-end">
          <Button type="submit" variant="primary" loading={saving}>{t('Salvar regra')}</Button>
        </div>
      </form>
    </GlassCard>
  );
}

function GenerateInvoicesForm({
  schedules,
  units,
  onCreated,
}: {
  schedules: DuesSchedule[];
  units: ReceivableUnit[];
  onCreated: () => void;
}) {
  const firstSchedule = schedules[0]?.id ? String(schedules[0].id) : 'custom';
  const [form, setForm] = useState({
    schedule_id: firstSchedule,
    period: currentPeriod(),
    due_date: dueDateInputFor(currentPeriod(), schedules[0]?.due_day || 10),
    amount: '',
    unit_id: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const custom = form.schedule_id === 'custom';

  function updatePeriod(period: string) {
    const selected = schedules.find((s) => String(s.id) === form.schedule_id);
    setForm({ ...form, period, due_date: dueDateInputFor(period, selected?.due_day || 10) });
  }

  function updateSchedule(scheduleId: string) {
    const selected = schedules.find((s) => String(s.id) === scheduleId);
    setForm({
      ...form,
      schedule_id: scheduleId,
      due_date: dueDateInputFor(form.period, selected?.due_day || 10),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      period: form.period,
      due_date: `${form.due_date}T12:00:00.000Z`,
      notes: form.notes.trim() || undefined,
    };
    if (custom) {
      const cents = parseAmountToCents(form.amount);
      if (!cents) {
        toast.error(t('Valor inválido — use números (ex: 1500 ou 1500,00)'));
        return;
      }
      body.amount_cents = cents;
    } else {
      body.schedule_id = Number(form.schedule_id);
    }
    if (form.unit_id) body.unit_ids = [Number(form.unit_id)];

    setSaving(true);
    try {
      const res = await apiPost<{ created_count: number; skipped_count: number }>('/finance/invoices', body);
      toast.success(`${t('Cobranças geradas')}: ${res.created_count} · ${t('ignoradas')}: ${res.skipped_count}`);
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao gerar cobranças'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-6 mb-6 animate-fade-up">
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">{t('Gerar cobranças')}</h3>
      <p className="text-sm text-dusk-300 mt-1">{t('Gere para todas as unidades ou apenas uma unidade específica.')}</p>
      <form onSubmit={submit} className="grid md:grid-cols-4 gap-3 mt-4">
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Regra')}
          <select className="input mt-1" value={form.schedule_id} onChange={(e) => updateSchedule(e.target.value)}>
            {schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>{schedule.name} · {formatCurrency(schedule.amount_cents / 100, schedule.currency)}</option>
            ))}
            <option value="custom">{t('Cobrança avulsa')}</option>
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Período')}
          <input className="input mt-1" type="month" value={form.period} onChange={(e) => updatePeriod(e.target.value)} required />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Vencimento')}
          <input className="input mt-1" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required />
        </label>
        {custom && (
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Valor')}
            <input className="input mt-1" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t('ex: 1500 ou 1500,00')} required />
          </label>
        )}
        <label className={`block text-xs text-dusk-300 font-medium ${custom ? '' : 'md:col-span-2'}`}>
          {t('Unidade')}
          <select className="input mt-1" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
            <option value="">{t('Todas as unidades')}</option>
            {units.map((unit) => (
              <option key={unit.unit_id} value={unit.unit_id}>
                {unit.unit_number} · {unit.resident_names || unit.building_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Observações (opcional)')}
          <input className="input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />
        </label>
        <div className="md:col-span-4 flex justify-end">
          <Button type="submit" variant="primary" loading={saving}>{t('Gerar cobranças')}</Button>
        </div>
      </form>
    </GlassCard>
  );
}

function PaymentModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: ReceivableInvoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    amount: amountInput(invoice.remaining_cents),
    method: 'manual',
    reference: '',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(form.amount);
    if (!cents) {
      toast.error(t('Valor inválido — use números (ex: 1500 ou 1500,00)'));
      return;
    }
    setSaving(true);
    try {
      await apiPost('/finance/payments', {
        invoice_id: invoice.id,
        amount_cents: cents,
        method: form.method.trim() || 'manual',
        paid_at: `${form.paid_at}T12:00:00.000Z`,
        reference: form.reference.trim() || undefined,
      });
      toast.success(t('Pagamento registrado'));
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao registrar pagamento'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dusk-500/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-2xl text-dusk-500">{t('Registrar pagamento')}</h2>
            <p className="text-sm text-dusk-300 mt-1">
              {t('Unidade')} {invoice.unit_number} · {invoice.schedule_name || t('Cobrança avulsa')} · {formatCurrency(invoice.remaining_cents / 100, invoice.currency)} {t('restante')}
            </p>
          </div>
          <button className="text-dusk-300 hover:text-dusk-500" onClick={onClose} aria-label={t('Fechar')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Valor')}
            <input className="input mt-1" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Data')}
            <input className="input mt-1" type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} required />
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Método')}
            <input className="input mt-1" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} maxLength={40} />
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Referência (opcional)')}
            <input className="input mt-1" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} maxLength={120} placeholder={t('ex: PIX, transferência, recibo')} />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t('Cancelar')}</Button>
            <Button type="submit" variant="primary" loading={saving}>{t('Registrar pagamento')}</Button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}

function CategorySummary({ totals, totalCents, currency }: { totals: CategoryTotal[]; totalCents: number; currency: string }) {
  if (totals.length < 2) return null;
  const max = Math.max(...totals.map((row) => row.total_cents), 1);
  return (
    <GlassCard variant="clay" className="p-6 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-5 h-5 text-dusk-400" />
        <h3 className="font-display text-lg text-dusk-500">{t('Resumo por categoria')}</h3>
        <Badge tone="dark" className="ml-auto">{formatCurrency(totalCents / 100, currency)}</Badge>
      </div>
      <div className="space-y-1.5">
        {totals.map((row) => (
          <div key={row.category} className="flex items-center gap-3 text-sm">
            <span className="w-44 shrink-0 text-dusk-500 truncate">{t(CATEGORY_LABEL[row.category] || row.category)}</span>
            <div className="flex-1 h-2 rounded-full bg-white/40 overflow-hidden">
              <div className="h-full bg-sage-400" style={{ width: `${(row.total_cents / max) * 100}%` }} />
            </div>
            <span className="w-28 text-right text-dusk-400 font-mono text-[13px]">{formatCurrency(row.total_cents / 100, currency)}</span>
            <span className="w-12 text-right text-[11px] text-dusk-200">{row.count}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ExpenseRow({ expense, onDeleted }: { expense: Expense; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!confirm(`${t('Apagar despesa')} "${expense.description}"?`)) return;
    setDeleting(true);
    try {
      await apiDelete(`/finance/expenses/${expense.id}`);
      toast.success(t('Despesa apagada'));
      onDeleted();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao apagar'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <GlassCard className="p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-dusk-500" data-user-content>{expense.description}</span>
          <Badge tone="neutral">{t(CATEGORY_LABEL[expense.category] || expense.category)}</Badge>
          {expense.related_proposal_title && (
            <Badge tone="sage">{t('Proposta:')} <span data-user-content>{expense.related_proposal_title}</span></Badge>
          )}
        </div>
        <div className="text-xs text-dusk-300 mt-1">
          {formatDate(expense.spent_at)}
          {expense.vendor && <span> · {expense.vendor}</span>}
        </div>
        {expense.admin_explanation && (
          <div className="mt-2 rounded-2xl bg-sage-50/70 border border-sage-100 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-sage-700">{t('Explicação do administrador')}</div>
            <p className="text-xs text-dusk-400 mt-0.5" data-user-content>{expense.admin_explanation}</p>
          </div>
        )}
        {expense.receipt_file_id ? (
          <button
            type="button"
            onClick={() => openUploadedFile(expense.receipt_file_id!, expense.receipt_file_name || 'receipt')}
            className="inline-flex items-center gap-1 text-xs text-dusk-400 hover:text-sage-700 mt-1.5 underline decoration-dotted underline-offset-4"
          >
            <ExternalLink className="w-3 h-3" /> {t('ver recibo')}
          </button>
        ) : expense.receipt_url ? (
          <a
            href={expense.receipt_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-dusk-400 hover:text-sage-700 mt-1.5 underline decoration-dotted underline-offset-4"
          >
            <ExternalLink className="w-3 h-3" /> {t('ver recibo')}
          </a>
        ) : null}
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono font-semibold text-dusk-500">{formatCurrency(expense.amount_cents / 100, expense.currency)}</div>
        <button
          onClick={remove}
          disabled={deleting}
          className="text-dusk-200 hover:text-peach-600 mt-2"
          title={t('Apagar')}
          aria-label={t('Apagar despesa')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </GlassCard>
  );
}

function NewExpenseForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    amount: '',
    category: 'maintenance',
    vendor: '',
    description: '',
    admin_explanation: '',
    spent_at: new Date().toISOString().slice(0, 10),
    receipt_url: '',
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) return;
    const cents = parseAmountToCents(form.amount);
    if (!cents) {
      toast.error(t('Valor inválido — use números (ex: 1500 ou 1500,00)'));
      return;
    }
    setSaving(true);
    try {
      const uploaded = receiptFile
        ? await uploadFileToCondoOS(receiptFile, { purpose: 'receipt', visibility: 'residents' })
        : null;
      await apiPost('/finance/expenses', {
        amount_cents: cents,
        category: form.category,
        vendor: form.vendor.trim() || null,
        description: form.description.trim(),
        admin_explanation: form.admin_explanation.trim() || null,
        spent_at: form.spent_at,
        receipt_url: uploaded ? null : form.receipt_url.trim() || null,
        receipt_file_id: uploaded?.id || null,
      });
      toast.success(t('Despesa registrada — visível para os moradores'));
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao registrar'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-6 mb-6 animate-fade-up">
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">{t('Nova despesa')}</h3>
      <p className="text-sm text-dusk-300 mt-1">
        {t('Tudo que você lançar aqui aparece automaticamente na Transparência dos moradores.')}
      </p>

      <form onSubmit={submit} className="grid md:grid-cols-2 gap-3 mt-4">
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Descrição')}
          <input
            className="input mt-1"
            placeholder={t('ex: Substituição do ar do saguão')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={500}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Valor')}
          <input
            className="input mt-1"
            type="text"
            inputMode="decimal"
            placeholder={t('ex: 47000 ou 47000,00')}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Categoria')}
          <select
            className="input mt-1"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(c.label)}</option>)}
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Fornecedor (opcional)')}
          <input
            className="input mt-1"
            placeholder={t('ex: Cool Breeze HVAC')}
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            maxLength={120}
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Data')}
          <input
            className="input mt-1"
            type="date"
            value={form.spent_at}
            onChange={(e) => setForm({ ...form, spent_at: e.target.value })}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Link do recibo (opcional)')}
          <input
            className="input mt-1"
            type="url"
            placeholder="https://..."
            value={form.receipt_url}
            onChange={(e) => setForm({ ...form, receipt_url: e.target.value })}
            maxLength={2048}
          />
          <span className="text-[11px] text-dusk-200 mt-1 block">
            {t('Cole um link do Drive, Dropbox, ou foto hospedada. Os moradores podem clicar para conferir.')}
          </span>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Explicação para moradores')}
          <textarea
            className="input mt-1 min-h-[90px]"
            placeholder={t('Explique em linguagem simples por que esse gasto foi necessário.')}
            value={form.admin_explanation}
            onChange={(e) => setForm({ ...form, admin_explanation: e.target.value })}
            maxLength={800}
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Arquivo do recibo (opcional)')}
          <input
            className="input mt-1"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
            onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
          />
          <span className="text-[11px] text-dusk-200 mt-1 block">
            {receiptFile ? `${t('Selecionado:')} ${receiptFile.name}` : t('Use upload para guardar o recibo dentro do CondoOS.')}
          </span>
        </label>
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" variant="primary" loading={saving}
                  leftIcon={receiptFile ? <UploadCloud className="w-4 h-4" /> : undefined}>
            {t('Registrar despesa')}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
