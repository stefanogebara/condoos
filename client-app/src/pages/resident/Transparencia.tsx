// Resident "Transparência" — where the condo's money is going.
// Read-only view of the same /api/finance/expenses endpoint that powers
// /board/financas, with category breakdown + receipt links.
import React, { useEffect, useState } from 'react';
import { Wallet, FileText, ExternalLink, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/i18n';
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

export default function Transparencia() {
  const [data, setData] = useState<ExpenseList | null>(null);

  useEffect(() => {
    apiGet<ExpenseList>('/finance/expenses').then(setData).catch(() => setData(null));
  }, []);

  return (
    <>
      <PageHeader
        title="Transparência"
        subtitle="Tudo que o condomínio gastou nos últimos 12 meses. Cada lançamento traz fornecedor, valor e — quando disponível — o recibo."
      />

      {!data ? (
        <GlassCard className="p-6 text-sm text-dusk-300">Carregando…</GlassCard>
      ) : data.expenses.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <Sparkles className="w-8 h-8 mx-auto text-sage-700 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">Sem despesas registradas ainda.</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            Quando o síndico começar a lançar as despesas do prédio, elas aparecem aqui automaticamente — com valor, fornecedor e link do recibo.
          </p>
        </GlassCard>
      ) : (
        <>
          <CategoryBreakdown totals={data.totals_by_category} totalCents={data.total_cents} />

          <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3">Lançamentos</h2>
          <div className="space-y-2">
            {data.expenses.map((e) => (
              <GlassCard key={e.id} variant="clay" className="p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-dusk-500">{e.description}</span>
                    <Badge tone="neutral">{CATEGORY_LABEL[e.category] || e.category}</Badge>
                    {e.related_proposal_title && (
                      <Badge tone="sage">Proposta: {e.related_proposal_title}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-dusk-300 mt-1">
                    {formatDate(e.spent_at)}{e.vendor && <> · {e.vendor}</>}
                  </div>
                  {e.receipt_url && (
                    <a
                      href={e.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-dusk-400 hover:text-sage-700 mt-1.5 underline decoration-dotted underline-offset-4"
                    >
                      <ExternalLink className="w-3 h-3" /> ver recibo
                    </a>
                  )}
                </div>
                <div className="font-mono font-semibold text-dusk-500 shrink-0 self-center">
                  {formatCurrency(e.amount_cents / 100)}
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function CategoryBreakdown({ totals, totalCents }: { totals: CategoryTotal[]; totalCents: number }) {
  if (totals.length === 0) return null;
  const max = Math.max(...totals.map((t) => t.total_cents), 1);
  return (
    <GlassCard variant="clay-sage" className="p-6 mb-2">
      <div className="flex items-center gap-2 mb-3">
        <Wallet className="w-5 h-5 text-dusk-400" />
        <h3 className="font-display text-lg text-dusk-500">Para onde está indo o dinheiro</h3>
        <Badge tone="dark" className="ml-auto">{formatCurrency(totalCents / 100)}</Badge>
      </div>
      <div className="space-y-1.5">
        {totals.map((t) => {
          const pct = totalCents > 0 ? Math.round((t.total_cents / totalCents) * 100) : 0;
          return (
            <div key={t.category} className="flex items-center gap-3 text-sm">
              <span className="w-44 shrink-0 text-dusk-500 truncate">{CATEGORY_LABEL[t.category] || t.category}</span>
              <div className="flex-1 h-2 rounded-full bg-white/40 overflow-hidden">
                <div className="h-full bg-sage-400" style={{ width: `${(t.total_cents / max) * 100}%` }} />
              </div>
              <span className="w-28 text-right text-dusk-400 font-mono text-[13px]">{formatCurrency(t.total_cents / 100)}</span>
              <span className="w-12 text-right text-[11px] text-dusk-300">{pct}%</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-dusk-300 mt-4">
        Período: últimos 12 meses. Lançado pelo síndico — clique em cada item para ver o recibo, quando disponível.
      </p>
    </GlassCard>
  );
}
