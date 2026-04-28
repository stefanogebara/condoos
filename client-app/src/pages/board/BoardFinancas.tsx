// Admin "Finanças" — log every condo expense, attach a receipt URL,
// see totals by category. Pairs with /app/transparencia (resident view)
// which renders the same data read-only.
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Trash2, Wallet, FileText, ExternalLink } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost, apiDelete } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/i18n';

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

export default function BoardFinancas() {
  const [data, setData] = useState<ExpenseList | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => apiGet<ExpenseList>('/finance/expenses').then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader
        title="Finanças"
        subtitle="Onde o condomínio gasta. Cada lançamento aparece para os moradores no painel de transparência — coloque o link do recibo sempre que possível."
        actions={
          <Button
            onClick={() => setShowForm((x) => !x)}
            variant={showForm ? 'ghost' : 'primary'}
            leftIcon={showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showForm ? 'Cancelar' : 'Nova despesa'}
          </Button>
        }
      />

      {showForm && <NewExpenseForm onCreated={() => { setShowForm(false); load(); }} />}

      <CategorySummary totals={data?.totals_by_category || []} totalCents={data?.total_cents || 0} />

      <h2 className="font-display text-xl text-dusk-500 mb-3">Lançamentos</h2>
      {!data ? (
        <GlassCard className="p-6 text-sm text-dusk-300">Carregando…</GlassCard>
      ) : data.expenses.length === 0 ? (
        <GlassCard className="p-6 text-sm text-dusk-300 text-center">
          Nenhuma despesa registrada nos últimos 12 meses. Comece pelas contas fixas (luz, água, condomínio da empresa de portaria).
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {data.expenses.map((e) => <ExpenseRow key={e.id} expense={e} onDeleted={load} />)}
        </div>
      )}
    </>
  );
}

function CategorySummary({ totals, totalCents }: { totals: CategoryTotal[]; totalCents: number }) {
  if (totals.length === 0) return null;
  const max = Math.max(...totals.map((t) => t.total_cents), 1);
  return (
    <GlassCard variant="clay" className="p-6 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-5 h-5 text-dusk-400" />
        <h3 className="font-display text-lg text-dusk-500">Resumo por categoria</h3>
        <Badge tone="dark" className="ml-auto">{formatCurrency(totalCents / 100)}</Badge>
      </div>
      <div className="space-y-1.5">
        {totals.map((t) => (
          <div key={t.category} className="flex items-center gap-3 text-sm">
            <span className="w-44 shrink-0 text-dusk-500 truncate">{CATEGORY_LABEL[t.category] || t.category}</span>
            <div className="flex-1 h-2 rounded-full bg-white/40 overflow-hidden">
              <div className="h-full bg-sage-400" style={{ width: `${(t.total_cents / max) * 100}%` }} />
            </div>
            <span className="w-28 text-right text-dusk-400 font-mono text-[13px]">{formatCurrency(t.total_cents / 100)}</span>
            <span className="w-12 text-right text-[11px] text-dusk-200">{t.count}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ExpenseRow({ expense, onDeleted }: { expense: Expense; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!confirm(`Apagar a despesa "${expense.description}"?`)) return;
    setDeleting(true);
    try {
      await apiDelete(`/finance/expenses/${expense.id}`);
      toast.success('Despesa apagada');
      onDeleted();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao apagar');
    } finally { setDeleting(false); }
  }

  return (
    <GlassCard className="p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-dusk-500">{expense.description}</span>
          <Badge tone="neutral">{CATEGORY_LABEL[expense.category] || expense.category}</Badge>
          {expense.related_proposal_title && (
            <Badge tone="sage">Proposta: {expense.related_proposal_title}</Badge>
          )}
        </div>
        <div className="text-xs text-dusk-300 mt-1">
          {formatDate(expense.spent_at)}
          {expense.vendor && <span> · {expense.vendor}</span>}
        </div>
        {expense.receipt_url && (
          <a
            href={expense.receipt_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-dusk-400 hover:text-sage-700 mt-1.5 underline decoration-dotted underline-offset-4"
          >
            <ExternalLink className="w-3 h-3" /> ver recibo
          </a>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono font-semibold text-dusk-500">{formatCurrency(expense.amount_cents / 100)}</div>
        <button
          onClick={remove}
          disabled={deleting}
          className="text-dusk-200 hover:text-peach-600 mt-2"
          title="Apagar"
          aria-label="Apagar despesa"
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
    spent_at: new Date().toISOString().slice(0, 10),
    receipt_url: '',
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) return;
    const cents = Math.round(parseFloat(form.amount.replace(',', '.')) * 100);
    if (!Number.isInteger(cents) || cents <= 0) {
      toast.error('Valor inválido — use números (ex: 1500 ou 1500,00)');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/finance/expenses', {
        amount_cents: cents,
        category: form.category,
        vendor: form.vendor.trim() || null,
        description: form.description.trim(),
        spent_at: form.spent_at,
        receipt_url: form.receipt_url.trim() || null,
      });
      toast.success('Despesa registrada — visível para os moradores');
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao registrar');
    } finally { setSaving(false); }
  }

  return (
    <GlassCard className="p-6 mb-6 animate-fade-up">
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">Nova despesa</h3>
      <p className="text-sm text-dusk-300 mt-1">
        Tudo que você lançar aqui aparece automaticamente na <strong>Transparência</strong> dos moradores.
      </p>

      <form onSubmit={submit} className="grid md:grid-cols-2 gap-3 mt-4">
        <label className="block text-xs text-dusk-300 font-medium">
          Descrição
          <input
            className="input mt-1"
            placeholder="ex: Substituição do ar do saguão"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={500}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Valor (R$)
          <input
            className="input mt-1"
            type="text"
            inputMode="decimal"
            placeholder="ex: 47000 ou 47000,00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Categoria
          <select
            className="input mt-1"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Fornecedor (opcional)
          <input
            className="input mt-1"
            placeholder="ex: Cool Breeze HVAC"
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            maxLength={120}
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Data
          <input
            className="input mt-1"
            type="date"
            value={form.spent_at}
            onChange={(e) => setForm({ ...form, spent_at: e.target.value })}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Link do recibo (opcional)
          <input
            className="input mt-1"
            type="url"
            placeholder="https://..."
            value={form.receipt_url}
            onChange={(e) => setForm({ ...form, receipt_url: e.target.value })}
            maxLength={2048}
          />
          <span className="text-[11px] text-dusk-200 mt-1 block">
            Cole um link do Drive, Dropbox, ou foto hospedada. Os moradores podem clicar para conferir.
          </span>
        </label>
        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" variant="primary" loading={saving}>Registrar despesa</Button>
        </div>
      </form>
    </GlassCard>
  );
}
