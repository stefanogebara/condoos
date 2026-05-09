import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CheckCircle2, ClipboardList, Copy, ExternalLink, Search, Send, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiPost } from '../../lib/api';
import { t, useLocale } from '../../lib/i18n';

type Mode = 'general' | 'repair' | 'install' | 'vendor_options' | 'policy';

interface AgentOption {
  title: string;
  fit: string;
  pros: string[];
  cons: string[];
  estimated_cost_range: string;
  timeline: string;
  questions_for_vendor: string[];
  evaluation_criteria: string[];
}

interface AgentResult {
  summary: string;
  task_type: string;
  assumptions: string[];
  recommended_next_step: string;
  existing_network_fit: Array<{ company_name: string; category: string; reason: string; contact_method: string }>;
  options: AgentOption[];
  vendor_search_plan: {
    search_queries: string[];
    shortlisting_criteria: string[];
    outreach_message: string;
  };
  action_plan: Array<{ step: string; owner: string; due: string; details: string }>;
  resident_update: { title: string; body: string };
  proposal_draft: { title: string; description: string; category: string; estimated_cost: number | null } | null;
  risks: string[];
  _fallback?: boolean;
}

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'general', label: 'Geral' },
  { value: 'repair', label: 'Conserto' },
  { value: 'install', label: 'Instalação' },
  { value: 'vendor_options', label: 'Fornecedores / concorrentes' },
  { value: 'policy', label: 'Regra / política' },
];

const EXAMPLES = [
  'Comparar fornecedores para manutenção da esteira da academia',
  'Encontrar opções para instalar carregadores de carro elétrico',
  'Planejar conserto urgente do portão da garagem',
  'Avaliar concorrentes para controle de acesso',
];

function searchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function formatEstimatedCost(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function BoardAgent() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const navigate = useNavigate();
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<Mode>('general');
  const [location, setLocation] = useState('');
  const [budget, setBudget] = useState('');
  const [urgency, setUrgency] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [creatingProposal, setCreatingProposal] = useState(false);

  async function copyText(value: string, label = 'Copiado') {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      toast.success(tr(label));
    } catch {
      toast.error(tr('Não foi possível copiar'));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (task.trim().length < 10) {
      toast.error(tr('Descreva o problema ou objetivo com mais detalhe.'));
      return;
    }
    setLoading(true);
    try {
      const out = await apiPost<AgentResult>('/ai/admin-agent', {
        task,
        mode,
        location,
        budget,
        urgency,
        locale,
      });
      setResult(out);
      toast.success(tr('Plano gerado'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao gerar plano'));
    } finally {
      setLoading(false);
    }
  }

  async function createProposal() {
    if (!result?.proposal_draft) return;
    setCreatingProposal(true);
    try {
      const created = await apiPost<{ id: number }>('/proposals', {
        title: result.proposal_draft.title,
        description: result.proposal_draft.description,
        category: result.proposal_draft.category,
        estimated_cost: result.proposal_draft.estimated_cost,
        ai_drafted: 1,
      });
      toast.success(tr('Proposta criada'));
      navigate(`/board/proposals/${created.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao criar proposta'));
    } finally {
      setCreatingProposal(false);
    }
  }

  return (
    <>
      <PageHeader
        title={tr('Agente IA')}
        subtitle={tr('Peça ajuda para consertos, instalações, fornecedores, concorrentes e próximos passos operacionais.')}
      />

      <GlassCard variant="clay-sage" className="p-5 mb-5 overflow-hidden relative">
        <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-sage-200/60 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="w-12 h-12 rounded-3xl bg-dusk-400 text-cream-50 flex items-center justify-center shrink-0 shadow-clay">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl text-dusk-500">{tr('Workbench operacional')}</h2>
            <p className="text-sm text-dusk-400 mt-1 max-w-3xl">
              {tr('O agente usa a rede de serviços, áreas comuns, sugestões e propostas do condomínio para montar opções, perguntas para fornecedores, plano de ação, comunicado e rascunho de proposta.')}
            </p>
            <p className="text-xs text-dusk-300 mt-3">
              {tr('Ele não compra, contrata nem promete pesquisa ao vivo: entrega o plano e os atalhos para você executar com controle.')}
            </p>
          </div>
        </div>
      </GlassCard>

      <form onSubmit={submit} className="grid lg:grid-cols-[1.2fr_0.8fr] gap-5 mb-6">
        <GlassCard className="p-5">
          <label className="block text-xs text-dusk-300 font-medium">
            {tr('O que você quer resolver?')}
            <textarea
              className="input mt-2 min-h-[150px]"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              maxLength={6000}
              placeholder={tr('Descreva o conserto, instalação, comparação de fornecedores ou decisão operacional que você precisa tomar.')}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setTask(tr(example))}
                className="text-xs rounded-full px-3 py-1.5 bg-white/60 border border-white/70 text-dusk-400 hover:bg-white/80"
              >
                {tr(example)}
              </button>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5 space-y-3">
          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Tipo de ajuda')}
            <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{tr(m.label)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Localização ou área')}
            <input className="input mt-1" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={240} placeholder={tr('ex: academia, garagem, São Paulo')} />
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Orçamento ou teto')}
            <input className="input mt-1" value={budget} onChange={(e) => setBudget(e.target.value)} maxLength={120} placeholder={tr('ex: até R$ 15.000')} />
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Urgência')}
            <input className="input mt-1" value={urgency} onChange={(e) => setUrgency(e.target.value)} maxLength={120} placeholder={tr('ex: urgente esta semana')} />
          </label>
          <Button type="submit" variant="primary" className="w-full" loading={loading} leftIcon={<Sparkles className="w-4 h-4" />}>
            {tr('Gerar plano')}
          </Button>
        </GlassCard>
      </form>

      {result && (
        <div className="space-y-5 animate-fade-up">
          <GlassCard variant="clay" className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="sage">{tr('Plano gerado')}</Badge>
                  {result._fallback ? <Badge tone="warning">{tr('Fallback seguro')}</Badge> : null}
                  <Badge tone="neutral">{tr(result.task_type)}</Badge>
                </div>
                <h2 className="font-display text-2xl text-dusk-500 mt-3">{tr('Resumo')}</h2>
                <p className="text-sm text-dusk-400 mt-1 whitespace-pre-line">{result.summary}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => copyText(JSON.stringify(result, null, 2))} leftIcon={<Copy className="w-4 h-4" />}>
                {tr('Copiar')}
              </Button>
            </div>
            <div className="mt-4 p-4 rounded-3xl bg-white/60 border border-white/70">
              <p className="text-xs uppercase tracking-[0.18em] text-dusk-300">{tr('Próximo passo')}</p>
              <p className="text-sm text-dusk-500 mt-1">{result.recommended_next_step}</p>
            </div>
          </GlassCard>

          {result.existing_network_fit.length > 0 ? (
            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500 mb-3">{tr('Rede cadastrada')}</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {result.existing_network_fit.map((fit) => (
                  <div key={fit.company_name} className="rounded-3xl bg-white/60 border border-white/70 p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-dusk-500">{fit.company_name}</h3>
                      <Badge tone="neutral">{fit.category}</Badge>
                    </div>
                    <p className="text-sm text-dusk-400 mt-2">{fit.reason}</p>
                    <p className="text-xs text-dusk-300 mt-2">{fit.contact_method}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          ) : null}

          <GlassCard className="p-5">
            <h2 className="font-display text-xl text-dusk-500 mb-3">{tr('Opções')}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {result.options.map((option) => (
                <div key={option.title} className="rounded-[2rem] bg-white/60 border border-white/70 p-5">
                  <h3 className="font-display text-xl text-dusk-500">{option.title}</h3>
                  <p className="text-sm text-dusk-400 mt-1">{option.fit}</p>
                  <div className="grid sm:grid-cols-2 gap-3 mt-4">
                    <MiniList icon={<CheckCircle2 className="w-4 h-4" />} title={tr('Prós')} items={option.pros} />
                    <MiniList icon={<AlertTriangle className="w-4 h-4" />} title={tr('Contras')} items={option.cons} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-dusk-300">
                    <span className="rounded-full bg-cream-50/80 px-3 py-1">{tr('Custo')}: {option.estimated_cost_range}</span>
                    <span className="rounded-full bg-cream-50/80 px-3 py-1">{tr('Prazo')}: {option.timeline}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 mt-4">
                    <MiniList title={tr('Perguntas para fornecedor')} items={option.questions_for_vendor} />
                    <MiniList title={tr('Critérios')} items={option.evaluation_criteria} />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <div className="grid lg:grid-cols-2 gap-5">
            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500">{tr('Plano de pesquisa')}</h2>
              <h3 className="text-xs uppercase tracking-[0.18em] text-dusk-300 mt-4">{tr('Buscas prontas')}</h3>
              <div className="mt-2 space-y-2">
                {result.vendor_search_plan.search_queries.map((query) => (
                  <a key={query} href={searchUrl(query)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-2xl bg-white/60 border border-white/70 p-3 text-sm text-dusk-400 hover:text-dusk-500">
                    <span className="inline-flex items-center gap-2 min-w-0"><Search className="w-4 h-4 shrink-0" /> <span className="truncate">{query}</span></span>
                    <ExternalLink className="w-4 h-4 shrink-0" />
                  </a>
                ))}
              </div>
              <h3 className="text-xs uppercase tracking-[0.18em] text-dusk-300 mt-4">{tr('Critérios de seleção')}</h3>
              <MiniList items={result.vendor_search_plan.shortlisting_criteria} />
            </GlassCard>

            <GlassCard className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl text-dusk-500">{tr('Mensagem para fornecedores')}</h2>
                <Button type="button" variant="ghost" size="sm" onClick={() => copyText(result.vendor_search_plan.outreach_message)} leftIcon={<Copy className="w-4 h-4" />}>
                  {tr('Copiar mensagem')}
                </Button>
              </div>
              <div className="mt-3 rounded-3xl bg-white/60 border border-white/70 p-4 text-sm text-dusk-400 whitespace-pre-line">
                {result.vendor_search_plan.outreach_message}
              </div>
            </GlassCard>
          </div>

          <GlassCard className="p-5">
            <h2 className="font-display text-xl text-dusk-500 mb-3">{tr('Plano de ação')}</h2>
            <div className="space-y-3">
              {result.action_plan.map((action, idx) => (
                <div key={`${action.step}-${idx}`} className="rounded-3xl bg-white/60 border border-white/70 p-4 grid md:grid-cols-[1fr_160px_120px] gap-3">
                  <div>
                    <h3 className="font-semibold text-dusk-500">{action.step}</h3>
                    <p className="text-sm text-dusk-400 mt-1">{action.details}</p>
                  </div>
                  <div className="text-xs text-dusk-300"><span className="font-semibold text-dusk-400">{tr('Responsável')}:</span> {action.owner}</div>
                  <div className="text-xs text-dusk-300"><span className="font-semibold text-dusk-400">{tr('Quando')}:</span> {action.due}</div>
                </div>
              ))}
            </div>
          </GlassCard>

          <div className="grid lg:grid-cols-2 gap-5">
            <GlassCard variant="clay-sage" className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl text-dusk-500">{tr('Comunicado aos moradores')}</h2>
                <Button type="button" variant="ghost" size="sm" onClick={() => copyText(`${result.resident_update.title}\n\n${result.resident_update.body}`)} leftIcon={<Copy className="w-4 h-4" />}>
                  {tr('Copiar comunicado')}
                </Button>
              </div>
              <h3 className="font-semibold text-dusk-500 mt-4">{result.resident_update.title}</h3>
              <p className="text-sm text-dusk-400 mt-2 whitespace-pre-line">{result.resident_update.body}</p>
            </GlassCard>

            {result.proposal_draft ? (
              <GlassCard variant="clay-peach" className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-xl text-dusk-500">{tr('Proposta pronta')}</h2>
                  <Button type="button" variant="primary" size="sm" loading={creatingProposal} onClick={createProposal} leftIcon={<Send className="w-4 h-4" />}>
                    {tr('Criar proposta')}
                  </Button>
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <Badge tone="neutral">{tr(result.proposal_draft.category)}</Badge>
                  {result.proposal_draft.estimated_cost !== null ? <Badge tone="sage">{formatEstimatedCost(result.proposal_draft.estimated_cost, locale)}</Badge> : null}
                </div>
                <h3 className="font-semibold text-dusk-500 mt-4">{result.proposal_draft.title}</h3>
                <p className="text-sm text-dusk-400 mt-2 whitespace-pre-line">{result.proposal_draft.description}</p>
              </GlassCard>
            ) : null}
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> {tr('Riscos')}</h2>
              <MiniList items={result.risks} />
            </GlassCard>
            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2"><ClipboardList className="w-5 h-5" /> {tr('Premissas')}</h2>
              <MiniList items={result.assumptions} />
            </GlassCard>
          </div>
        </div>
      )}
    </>
  );
}

function MiniList({ title, items, icon }: { title?: string; items: string[]; icon?: React.ReactNode }) {
  return (
    <div className={title ? '' : 'mt-2'}>
      {title ? <h4 className="text-xs uppercase tracking-[0.16em] text-dusk-300 mb-2 flex items-center gap-1">{icon}{title}</h4> : null}
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm text-dusk-400">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-sage-300 shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
