import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CheckCircle2, ClipboardList, Copy, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { t, useLocale } from '../../lib/i18n';

// 'vendor_options' mode dropped — the platform doesn't actually do live
// vendor research (no public web access, no vendor catalog beyond saved
// contacts). Keeping it in the dropdown was selling capability the prompt
// is explicitly forbidden from delivering ("do not invent vendors").
type Mode = 'general' | 'repair' | 'install' | 'policy';

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

interface NetworkFit {
  company_name: string;
  category: string;
  reason: string;
  contact_method: string;
  // Populated server-side from the expenses ledger when the admin has
  // logged prior spend with this vendor. Null when no history.
  cost_history?: {
    expense_count: number;
    last_amount_brl: number | null;
    last_spent_at: string | null;
    avg_brl: number | null;
    min_brl: number | null;
    max_brl: number | null;
  } | null;
}

interface AgentResult {
  summary: string;
  task_type: string;
  assumptions: string[];
  recommended_next_step: string;
  existing_network_fit: NetworkFit[];
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
  { value: 'policy', label: 'Regra / política' },
];

interface ServiceContactLite {
  id: number;
  company_name: string;
  category: string;
  whatsapp: string | null;
  email: string | null;
}

const EXAMPLES = [
  'Comparar fornecedores para manutenção da esteira da academia',
  'Encontrar opções para instalar carregadores de carro elétrico',
  'Planejar conserto urgente do portão da garagem',
  'Avaliar concorrentes para controle de acesso',
];

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
  // Vendor directory is loaded once a plan exists so we can resolve the
  // model's `existing_network_fit[i].company_name` back to a real service
  // contact id for the "Enviar via WhatsApp" button. The full vendor list
  // is cheap (<10KB typical) and avoids per-card resolution roundtrips.
  const [vendors, setVendors] = useState<ServiceContactLite[]>([]);
  const [outreachTarget, setOutreachTarget] = useState<{ vendor: ServiceContactLite; initialMessage: string } | null>(null);
  const [waHealth, setWaHealth] = useState<WhatsAppHealth | null>(null);

  // Fetch WhatsApp health alongside the page load — admin sees the sending
  // phone right inside the outreach modal, plus the modal can warn if the
  // session is offline. Cached server-side for 60s so this is cheap.
  React.useEffect(() => {
    apiGet<WhatsAppHealth>('/service-contacts/whatsapp/health').then(setWaHealth).catch(() => setWaHealth(null));
  }, []);

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
      // Pull vendor list in parallel so the network-fit cards can resolve
      // company_name → id without forcing the user to wait. Failure here is
      // non-fatal: cards still render, just without the send button.
      apiGet<ServiceContactLite[]>('/service-contacts').then(setVendors).catch(() => setVendors([]));
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
        subtitle={tr('Copiloto operacional para consertos, instalações e decisões — usa a sua rede de fornecedores cadastrada para sugerir e enviar o próximo passo.')}
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
              {tr('Usa a rede de serviços, áreas comuns e propostas do condomínio para sugerir o próximo passo — e te dá um botão para enviar a mensagem ao fornecedor certo direto pelo WhatsApp.')}
            </p>
            <p className="text-xs text-dusk-300 mt-3">
              {tr('Sem pesquisa ao vivo na web, sem inventar fornecedores ou preços. Trabalha com a sua rede cadastrada.')}
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

          {/* Hero: the only block in the result panel with a write action.
              Each existing-network-fit card lets the admin send the agent's
              outreach_message to that exact saved vendor via WhatsApp in
              one click. Without this, the workbench is a glorified notes
              app — with it, the agent's plan becomes a real outbound
              message. When `existing_network_fit` is empty, render an
              honest empty state pointing to /board/services so the admin
              can add the missing vendor (vendor-add auto-rewires blocked
              tickets, so this isn't a dead-end). */}
          <GlassCard className="p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-display text-xl text-dusk-500">{tr('Sua rede cadastrada')}</h2>
              {result.vendor_search_plan?.outreach_message && (
                <Button type="button" variant="ghost" size="sm" onClick={() => copyText(result.vendor_search_plan.outreach_message)} leftIcon={<Copy className="w-4 h-4" />}>
                  {tr('Copiar mensagem genérica')}
                </Button>
              )}
            </div>
            {result.existing_network_fit.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-3">
                {result.existing_network_fit.map((fit) => {
                  const vendor = vendors.find((v) => v.company_name === fit.company_name);
                  const canSend = !!vendor?.whatsapp || !!vendor?.email;
                  const cost = fit.cost_history;
                  return (
                    <div key={fit.company_name} className="rounded-3xl bg-white/60 border border-white/70 p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-dusk-500">{fit.company_name}</h3>
                        <Badge tone="neutral">{fit.category}</Badge>
                      </div>
                      <p className="text-sm text-dusk-400 mt-2">{fit.reason}</p>
                      <p className="text-xs text-dusk-300 mt-2">{fit.contact_method}</p>
                      {cost && cost.expense_count > 0 && (
                        <div className="mt-3 rounded-2xl bg-sage-100/60 border border-sage-200/60 p-2.5 text-xs text-dusk-400">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-semibold text-sage-700">{tr('Histórico')}:</span>
                            {cost.last_amount_brl != null && (
                              <span>
                                {tr('última vez')} <span className="font-semibold text-dusk-500">{formatEstimatedCost(cost.last_amount_brl, locale)}</span>
                              </span>
                            )}
                            {cost.avg_brl != null && cost.expense_count > 1 && (
                              <span className="text-dusk-300">
                                · {tr('média')} {formatEstimatedCost(cost.avg_brl, locale)} ({cost.expense_count}×)
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="mt-3">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={!canSend}
                          onClick={() => vendor && setOutreachTarget({ vendor, initialMessage: result.vendor_search_plan?.outreach_message || '' })}
                          leftIcon={<MessageCircle className="w-4 h-4" />}
                        >
                          {canSend ? tr('Enviar mensagem') : tr('Sem contato no cadastro')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl bg-white/40 border border-white/60 p-4 text-sm text-dusk-400">
                <p>{tr('Nenhum fornecedor da sua rede combina com essa categoria.')}</p>
                <p className="text-xs text-dusk-300 mt-1">
                  {tr('Adicione um em Operação para que o agente possa acioná-lo automaticamente em chamados futuros.')}
                </p>
                <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => navigate('/board/services')}>
                  {tr('Ir para Operação')}
                </Button>
              </div>
            )}
          </GlassCard>

          {/* Options: collapse to a single "Recommendation" card when the
              model only returned one. The pros/cons/timeline grid makes
              sense for comparison, not for a single item. */}
          {result.options.length >= 2 ? (
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
          ) : result.options.length === 1 ? (
            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500 mb-3">{tr('Recomendação')}</h2>
              <div className="rounded-[2rem] bg-white/60 border border-white/70 p-5">
                <h3 className="font-display text-xl text-dusk-500">{result.options[0].title}</h3>
                <p className="text-sm text-dusk-400 mt-1">{result.options[0].fit}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-dusk-300">
                  <span className="rounded-full bg-cream-50/80 px-3 py-1">{tr('Custo')}: {result.options[0].estimated_cost_range}</span>
                  <span className="rounded-full bg-cream-50/80 px-3 py-1">{tr('Prazo')}: {result.options[0].timeline}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <MiniList title={tr('Perguntas para fornecedor')} items={result.options[0].questions_for_vendor} />
                  <MiniList title={tr('Critérios')} items={result.options[0].evaluation_criteria} />
                </div>
              </div>
            </GlassCard>
          ) : null}

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

            {/* Proposal draft is gated by mode: 'repair' is operational
                triage (no resident vote required), 'general' is too vague.
                Only show the "Criar proposta" path when the request is
                explicitly about an install or a policy change — those are
                the contexts where a residents-vote makes sense.  Avoids
                the "vote on whether to fix the elevator" anti-pattern. */}
            {result.proposal_draft && (mode === 'install' || mode === 'policy') ? (
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

      {outreachTarget && (
        <OutreachModal
          target={outreachTarget}
          onClose={() => setOutreachTarget(null)}
          onSent={() => setOutreachTarget(null)}
          tr={tr}
          health={waHealth}
        />
      )}
    </>
  );
}

interface OutboxStatus {
  id: number;
  channel: string;
  provider: string;
  phone: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sent_at: string | null;
  last_error: string | null;
  attempts: number;
}

interface WhatsAppHealth {
  configured: boolean;
  provider: string;
  reachable: boolean;
  session_status: string | null;
  me_phone: string | null;
  me_name: string | null;
  checked_at: string;
  error: string | null;
}

// Send the agent's outreach_message to a specific saved vendor. Editable
// before send because the model-generated message is generic and often
// reads like a template bot; the admin should be able to tighten it in 10
// seconds before pressing send.
//
// After the send, the modal stays open and polls the outbox row every 2s
// for up to 60s so the admin sees actual delivery progress: queued → sent
// → (or failed with the provider's error). This replaces the previous
// fake-success toast that always said "Mensagem enviada" even when the
// provider couldn't reach the destination.
function OutreachModal({ target, onClose, onSent, tr, health }: {
  target: { vendor: ServiceContactLite; initialMessage: string };
  onClose: () => void;
  onSent: () => void;
  tr: (k: string) => string;
  health: WhatsAppHealth | null;
}) {
  const [message, setMessage] = useState(target.initialMessage);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>(target.vendor.whatsapp ? 'whatsapp' : 'email');
  const [sending, setSending] = useState(false);
  const [outbox, setOutbox] = useState<OutboxStatus | null>(null);
  // Polling timer reference so we can clear on unmount / channel terminal.
  const pollRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  React.useEffect(() => {
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  async function send() {
    if (!message.trim()) {
      toast.error(tr('Mensagem vazia'));
      return;
    }
    setSending(true);
    try {
      const res = await apiPost<{ outbox_id: number; channel: string; vendor: { id: number; company_name: string } }>(
        `/service-contacts/${target.vendor.id}/outreach`,
        { message: message.trim(), channel }
      );
      toast.success(tr('Enfileirada para envio'));
      // Begin polling. Stop at sent/failed/skipped or after 60s (30 polls).
      let polls = 0;
      const tick = async () => {
        polls += 1;
        try {
          const status = await apiGet<OutboxStatus>(`/service-contacts/outbox/${res.outbox_id}`);
          setOutbox(status);
          if (status.status === 'sent' || status.status === 'failed' || status.status === 'skipped' || polls >= 30) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            if (status.status === 'sent') {
              setTimeout(onSent, 1_500);  // give the admin a beat to see "Enviada"
            }
          }
        } catch {
          // Polling errors are non-fatal — just stop and let the admin close.
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
      pollRef.current = window.setInterval(tick, 2_000);
      tick();  // immediate first read
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao enviar mensagem'));
    } finally {
      setSending(false);
    }
  }

  const canWhatsApp = !!target.vendor.whatsapp;
  const canEmail = !!target.vendor.email;
  // Seed-pattern detection — the demo seed uses +5511955551XXX. If the
  // admin tries to send to one of those, warn them: the message will
  // queue and "succeed" but won't reach a real WhatsApp user.
  const phoneToSend = channel === 'whatsapp' ? target.vendor.whatsapp : target.vendor.email;
  const looksLikeSeedNumber = !!(phoneToSend && /^\+?5511955551\d{3}$/.test(phoneToSend.replace(/\D/g, '').replace(/^/, '+')));

  return (
    <div className="fixed inset-0 bg-dusk-500/30 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <GlassCard className="p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-xl text-dusk-500">{tr('Enviar para')} {target.vendor.company_name}</h2>
            <p className="text-xs text-dusk-300 mt-1">{tr('Você pode editar antes de enviar.')}</p>
            {/* From-line — admin needs to know which phone is sending. WAHA
                sessions are bound to a real WhatsApp account, so the
                receiver sees that name. */}
            {health?.reachable && health.me_phone && (
              <p className="text-xs text-dusk-300 mt-1">
                {tr('De:')} <span className="font-medium text-dusk-400">{health.me_name || tr('Sessão WhatsApp')}</span> {health.me_phone}
              </p>
            )}
            {health && !health.reachable && (
              <p className="text-xs text-peach-700 mt-1">
                {tr('Atenção: WhatsApp não está conectado')} ({health.error || tr('verifique a sessão')})
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label={tr('Fechar')} className="text-dusk-300 hover:text-dusk-500"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setChannel('whatsapp')}
            disabled={!canWhatsApp || !!outbox}
            className={`text-xs rounded-full px-3 py-1.5 border ${channel === 'whatsapp' ? 'bg-sage-300/60 border-sage-500/60 text-dusk-500' : 'bg-white/60 border-white/70 text-dusk-400'} ${(!canWhatsApp || !!outbox) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            WhatsApp {canWhatsApp ? '' : `(${tr('não cadastrado')})`}
          </button>
          <button
            type="button"
            onClick={() => setChannel('email')}
            disabled={!canEmail || !!outbox}
            className={`text-xs rounded-full px-3 py-1.5 border ${channel === 'email' ? 'bg-sage-300/60 border-sage-500/60 text-dusk-500' : 'bg-white/60 border-white/70 text-dusk-400'} ${(!canEmail || !!outbox) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Email {canEmail ? '' : `(${tr('não cadastrado')})`}
          </button>
        </div>

        {looksLikeSeedNumber && !outbox && (
          <div className="mb-3 rounded-2xl bg-peach-100/50 border border-peach-300/50 p-2.5 text-xs text-dusk-500">
            {tr('Esse número parece ser do dado de demonstração. A mensagem vai ser enfileirada mas não chega a um WhatsApp real. Atualize o cadastro do fornecedor com um número de teste antes de enviar.')}
          </div>
        )}

        <textarea
          className="input min-h-[160px]"
          value={message}
          maxLength={4_000}
          disabled={!!outbox}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={tr('Escreva uma mensagem curta e direta. Ex: "Olá Ricardo, elevador A parando entre andares. Pode vir hoje?"')}
        />

        {/* Live delivery state after send. Replaces fake-success toast with
            real provider feedback. Pending = WAHA accepted; sent = phone
            on the other side got it (or WAHA queued it for delivery);
            failed = real error from the provider, shown verbatim. */}
        {outbox && (
          <div className={`mt-3 rounded-2xl p-3 text-sm ${
            outbox.status === 'sent' ? 'bg-sage-100/60 border border-sage-300/60 text-dusk-500' :
            outbox.status === 'failed' || outbox.status === 'skipped' ? 'bg-peach-100/60 border border-peach-300/60 text-dusk-500' :
            'bg-white/60 border border-white/70 text-dusk-400'
          }`}>
            <div className="font-semibold">
              {outbox.status === 'pending' && <>{tr('Enviando…')} ({outbox.provider})</>}
              {outbox.status === 'sent' && <>{tr('Mensagem entregue ao provedor')} ({outbox.provider})</>}
              {outbox.status === 'failed' && <>{tr('Falha na entrega')}</>}
              {outbox.status === 'skipped' && <>{tr('Mensagem ignorada')}</>}
            </div>
            {outbox.phone && <div className="text-xs mt-1">{tr('Destino:')} {outbox.phone}</div>}
            {outbox.last_error && <div className="text-xs mt-1 text-peach-700">{tr('Erro:')} {outbox.last_error}</div>}
            {outbox.status === 'sent' && (
              <div className="text-xs mt-1 text-dusk-300">
                {tr('O provedor aceitou. Veja sua sessão de WhatsApp para confirmar entrega real.')}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {outbox ? tr('Fechar') : tr('Cancelar')}
          </Button>
          {!outbox && (
            <Button type="button" variant="primary" loading={sending} onClick={send} leftIcon={<Send className="w-4 h-4" />}>
              {tr('Enviar agora')}
            </Button>
          )}
        </div>
      </GlassCard>
    </div>
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
