import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  CalendarClock,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Loader2,
  Megaphone,
  ReceiptText,
  Search,
  Vote,
  Wrench,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatCurrency, formatDate, t, useLocale } from '../../lib/i18n';

type MemoryType =
  | 'ticket'
  | 'work_order'
  | 'expense'
  | 'proposal'
  | 'announcement'
  | 'document'
  | 'meeting'
  | 'service_contact';

interface MemoryResult {
  type: MemoryType;
  id: number;
  title: string;
  subtitle?: string;
  body?: string;
  status?: string;
  date?: string;
  amount_cents?: number | null;
  url?: string;
  meta?: Record<string, string | number | null | undefined>;
}

interface MemoryResponse {
  query: string;
  results: MemoryResult[];
  total: number;
  counts: Partial<Record<MemoryType, number>>;
}

const TYPE_META: Record<MemoryType, { label: string; icon: any; tone: 'sage' | 'peach' | 'neutral' }> = {
  ticket: { label: 'Chamados', icon: AlertTriangle, tone: 'peach' },
  work_order: { label: 'Ordens de serviço', icon: ClipboardCheck, tone: 'sage' },
  expense: { label: 'Despesas', icon: ReceiptText, tone: 'peach' },
  proposal: { label: 'Propostas', icon: Vote, tone: 'sage' },
  announcement: { label: 'Comunicados', icon: Megaphone, tone: 'neutral' },
  document: { label: 'Documentos', icon: FileText, tone: 'neutral' },
  meeting: { label: 'Reuniões', icon: CalendarClock, tone: 'sage' },
  service_contact: { label: 'Fornecedores', icon: Wrench, tone: 'peach' },
};

const TYPE_ORDER = Object.keys(TYPE_META) as MemoryType[];
const QUICK_SEARCHES = ['Cool Breeze', 'Fitness Pro', 'Otis', 'EV', 'seguro'];

function externalLinks(meta?: MemoryResult['meta']) {
  if (!meta) return [];
  return [
    ['receipt_url', 'Recibo'],
    ['invoice_url', 'Nota fiscal'],
    ['photo_url', 'Foto'],
    ['file_url', 'Documento'],
    ['contract_url', 'Contrato'],
    ['website', 'Site'],
  ]
    .map(([key, label]) => ({ key, label, href: typeof meta[key] === 'string' ? String(meta[key]) : '' }))
    .filter((item) => item.href.startsWith('https://'));
}

function displayFragment(value: string, tr: (key: string) => string) {
  const voteMatch = value.match(/^(\d+)\s+votes?$/i);
  if (voteMatch) {
    const count = Number(voteMatch[1]);
    return `${count} ${tr(count === 1 ? 'voto' : 'votos')}`;
  }
  return tr(value);
}

function displayText(value: string, tr: (key: string) => string) {
  return value.split(' · ').map((part) => displayFragment(part, tr)).join(' · ');
}

export default function BoardMemory() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<MemoryType | 'all'>('all');
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resultTypes = useMemo(() => {
    if (!data) return [];
    return TYPE_ORDER.filter((type) => data.counts[type]);
  }, [data]);

  async function runSearch(nextQuery = query, nextType = activeType) {
    const clean = nextQuery.trim();
    if (!clean) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ query: clean, limit: '60' });
      if (nextType !== 'all') params.set('types', nextType);
      const response = await apiGet<MemoryResponse>(`/memory?${params.toString()}`);
      setData(response);
    } catch (err: any) {
      setError(err?.response?.data?.error || tr('Falha ao buscar memória'));
    } finally {
      setLoading(false);
    }
  }

  function chooseType(type: MemoryType | 'all') {
    setActiveType(type);
    if (query.trim()) runSearch(query, type);
  }

  function quickSearch(value: string) {
    setQuery(value);
    runSearch(value, activeType);
  }

  return (
    <>
      <PageHeader
        title={tr('Memória do prédio')}
        subtitle={tr('Decisões, custos, documentos, chamados e fornecedores do histórico.')}
      />

      <GlassCard variant="clay-sage" className="p-5 mb-5">
        <form
          className="flex flex-col gap-3 md:flex-row md:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-dusk-200" />
            <input
              className="input pl-11"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr('Buscar fornecedor, despesa, proposta, documento ou chamado')}
              maxLength={160}
              data-testid="memory-search-input"
            />
          </div>
          <Button
            type="submit"
            loading={loading}
            leftIcon={<Search className="h-4 w-4" />}
            data-testid="memory-search-submit"
          >
            {tr('Buscar')}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => chooseType('all')}
            className={`chip transition ${activeType === 'all' ? 'bg-dusk-400 text-cream-50' : ''}`}
          >
            {tr('Tudo')}
          </button>
          {TYPE_ORDER.map((type) => {
            const meta = TYPE_META[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => chooseType(type)}
                className={`chip transition ${activeType === type ? 'bg-dusk-400 text-cream-50' : ''}`}
              >
                {tr(meta.label)}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-dusk-200">{tr('Buscas rápidas')}</span>
          {QUICK_SEARCHES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => quickSearch(item)}
              className="rounded-full bg-white/60 px-3 py-1.5 text-xs font-semibold text-dusk-400 transition hover:bg-white/80"
            >
              {tr(item)}
            </button>
          ))}
        </div>
      </GlassCard>

      {error && (
        <GlassCard variant="clay-peach" className="mb-5 p-4 text-sm text-dusk-500">
          {error}
        </GlassCard>
      )}

      {loading && (
        <GlassCard className="p-6 text-sm text-dusk-300">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {tr('Buscando memória do prédio…')}
        </GlassCard>
      )}

      {!loading && !data && (
        <GlassCard className="p-8 text-center">
          <BookOpenText className="mx-auto h-10 w-10 text-sage-700" />
          <h2 className="mt-3 font-display text-xl text-dusk-500">{tr('A memória está pronta para busca.')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-dusk-300">
            {tr('Procure por fornecedor, custo, equipamento, votação, documento ou problema recorrente.')}
          </p>
        </GlassCard>
      )}

      {!loading && data && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-dusk-500">
                {data.total === 1 ? tr('1 registro encontrado') : `${data.total} ${tr('registros encontrados')}`}
              </h2>
              {resultTypes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {resultTypes.map((type) => (
                    <Badge key={type} tone={TYPE_META[type].tone}>
                      {data.counts[type]} {tr(TYPE_META[type].label)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {data.results.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <h2 className="font-display text-xl text-dusk-500">{tr('Nenhum registro encontrado.')}</h2>
              <p className="mt-2 text-sm text-dusk-300">{tr('Tente outro fornecedor, equipamento, despesa ou decisão.')}</p>
            </GlassCard>
          ) : (
            <div className="space-y-3" data-testid="memory-results">
              {data.results.map((item) => (
                <MemoryRow key={`${item.type}-${item.id}`} item={item} tr={tr} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function MemoryRow({ item, tr }: { item: MemoryResult; tr: (key: string) => string }) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const links = externalLinks(item.meta);
  return (
    <GlassCard className="p-5" data-testid={`memory-result-${item.type}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone}>
              <Icon className="h-3 w-3" /> {tr(meta.label)}
            </Badge>
            {item.status && <Badge tone="neutral">{tr(item.status)}</Badge>}
            {item.date && <span className="text-xs text-dusk-200">{formatDate(item.date)}</span>}
            {item.amount_cents ? (
              <span className="rounded-full bg-white/60 px-3 py-1 text-xs font-semibold text-dusk-400">
                {formatCurrency(item.amount_cents / 100)}
              </span>
            ) : null}
          </div>
          <h3 className="mt-3 font-display text-xl text-dusk-500">{tr(item.title)}</h3>
          {item.subtitle && <p className="mt-1 text-sm text-dusk-300">{displayText(item.subtitle, tr)}</p>}
          {item.body && <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-dusk-400">{tr(item.body)}</p>}
          {links.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {links.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1.5 text-xs font-semibold text-dusk-400 hover:bg-white/80"
                >
                  <ExternalLink className="h-3 w-3" /> {tr(link.label)}
                </a>
              ))}
            </div>
          )}
        </div>
        {item.url && (
          <Link
            to={item.url}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-dusk-400 px-4 py-2 text-sm font-semibold text-cream-50 shadow-clay transition hover:-translate-y-0.5"
          >
            {tr('Abrir registro')} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </GlassCard>
  );
}
