import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CheckCircle2, ClipboardList, Copy, ExternalLink, Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { t, useLocale } from '../../lib/i18n';

// vendor_options is back now that the backend has a cited research tool.
// When live search is not configured, the tool returns manual search URLs
// and the UI still labels them as evidence instead of verified vendors.
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
    confidence: 'high' | 'low';
  } | null;
}

interface BuildingMemorySimilar {
  id: number;
  title: string;
  resolved_at: string | null;
  dispatched_vendors: string | null;
  resolution_note: string;
  estimated_cost_brl: number | null;
}

interface BuildingMemory {
  similar_resolved_tickets: BuildingMemorySimilar[];
  open_similar_count: number;
  inferred_category: string | null;
  is_outside_business_hours: boolean;
  local_hour: number;
}

interface AgentTraceStep {
  tool: string;
  input_keys: string[];
  output_summary: string;
}

interface AgentEvidenceSource {
  type: 'past_ticket' | 'vendor_history' | 'web_citation' | 'photo' | 'pattern' | 'after_hours';
  title: string;
  detail: string;
  url?: string | null;
  source?: string | null;
}

interface AgentResult {
  summary: string;
  task_type: string;
  assumptions: string[];
  recommended_next_step: string;
  existing_network_fit: NetworkFit[];
  options: AgentOption[];
  building_memory?: BuildingMemory | null;
  agent_trace?: AgentTraceStep[];
  evidence_sources?: AgentEvidenceSource[];
  // Vision analysis (roadmap item 6). Present when the runner ran with
  // a ticketId and the ticket had image attachments. Each entry is what
  // the model SAW, surfaced separately from the recommendation so the
  // admin can sanity-check the visual evidence.
  attachment_analysis?: Array<{
    id: number;
    description: string;
    signals: string[];
  }>;
  // Confidence calibration — sanitiser fills this on every response.
  // tier drives the chip colour; reasoning is the disclosure body.
  confidence?: {
    score: number;
    tier: 'high' | 'medium' | 'low';
    reasoning: string[];
  };
  // Conversational rescue chips — clickable suggestions that pre-fill
  // the follow-up composer with a relevant next question when the
  // current call hit a data wall.
  follow_up_suggestions?: string[];
  vendor_search_plan: {
    search_queries: string[];
    shortlisting_criteria: string[];
    outreach_message: string;
  };
  action_plan: Array<{ step: string; owner: string; due: string; details: string }>;
  resident_update: { title: string; body: string };
  proposal_draft: { title: string; description: string; category: string; estimated_cost: number | null } | null;
  risks: string[];
  // Conversational thread metadata — set by the server when the turn is
  // persisted. Tracks which thread + turn this result belongs to so
  // follow-up sends know which thread to append to.
  thread_id?: number;
  turn_index?: number;
  agent_run_id?: number;
  ai_status?: 'ok' | 'degraded' | 'unavailable';
  _fallback?: boolean;
}

interface Turn {
  user_task: string;
  result: AgentResult;
}

interface ThreadSummary {
  id: number;
  title: string;
  mode: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
}

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'general', label: 'Geral' },
  { value: 'repair', label: 'Conserto' },
  { value: 'install', label: 'Instalação' },
  { value: 'vendor_options', label: 'Fornecedores / concorrentes' },
  { value: 'policy', label: 'Regra / política' },
];

interface ServiceContactLite {
  id: number;
  company_name: string;
  category: string;
  whatsapp: string | null;
  email: string | null;
}

interface AiUsageStatus {
  since: string;
  total_calls: number;
  total_tokens: number;
  est_cost_usd: number;
  by_caller: Array<{ caller: string; calls: number; total_tokens: number; est_cost_usd: number }>;
  window_days: number;
  ai_available: boolean;
  breaker_open_until: string | number | null;
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

function formatCompactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function formatUsd(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value || 0);
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
  // Live progress crumbs while the agent is running. We poll
  // /admin-agent/runs every 1.5s to find the current in-flight run, then
  // pull its snapshot to show each step the runner emits ("Buscando
  // chamados anteriores parecidos", "Compondo resposta final"). Renders
  // above the form so the admin sees what's happening during the 30-55s
  // ReAct loop instead of staring at a spinner.
  const [liveProgress, setLiveProgress] = useState<Array<{ at: string; label: string; detail?: string }>>([]);
  React.useEffect(() => {
    if (!loading) {
      setLiveProgress([]);
      return;
    }
    let cancelled = false;
    let runId: number | null = null;
    const tick = async () => {
      try {
        if (runId == null) {
          // Find the most-recent running run for this admin.
          const runs = await apiGet<Array<{ id: number; status: string; created_at: string }>>('/ai/admin-agent/runs?limit=5');
          const latest = runs.find((r) => r.status === 'running');
          if (latest) runId = latest.id;
        }
        if (runId != null && !cancelled) {
          const snap = await apiGet<{ status: string; progress: Array<{ at: string; label: string; detail?: string }> }>(`/ai/admin-agent/runs/${runId}`);
          if (!cancelled) setLiveProgress(snap.progress || []);
        }
      } catch {
        // Polling failures are non-fatal — just keep the existing crumbs.
      }
    };
    tick();
    const id = window.setInterval(tick, 1_500);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [loading]);
  // Conversational thread — each agent run appends a turn instead of
  // overwriting a single result. threadId is set on the first turn and
  // re-sent on subsequent turns so the server appends rather than
  // creating a new thread. followUpTask is the smaller composer that
  // shows up below the latest turn for "what about X?" style asks.
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [followUpTask, setFollowUpTask] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);
  // Side panel — list of recent active threads. Toggled by the admin to
  // resume a past conversation. Loaded on mount; refreshed after each
  // send so a brand-new thread appears at the top.
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  // Vendor directory is loaded once a plan exists so we can resolve the
  // model's `existing_network_fit[i].company_name` back to a real service
  // contact id for the "Enviar via WhatsApp" button. The full vendor list
  // is cheap (<10KB typical) and avoids per-card resolution roundtrips.
  const [vendors, setVendors] = useState<ServiceContactLite[]>([]);
  const [outreachTarget, setOutreachTarget] = useState<{ vendor: ServiceContactLite; initialMessage: string } | null>(null);
  const [waHealth, setWaHealth] = useState<WhatsAppHealth | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageStatus | null>(null);

  // The most-recent turn drives the result UI (network cards, options,
  // resident update, etc.). Older turns render as small "ago" cards on
  // top so the conversation reads top-down.
  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const result = latestTurn?.result || null;

  const refreshThreads = React.useCallback(() => {
    apiGet<ThreadSummary[]>('/ai/admin-agent/threads').then(setThreads).catch(() => setThreads([]));
  }, []);
  React.useEffect(() => { refreshThreads(); }, [refreshThreads]);

  const refreshAiUsage = React.useCallback(() => {
    apiGet<AiUsageStatus>('/ai/admin-agent/usage?days=7').then(setAiUsage).catch(() => setAiUsage(null));
  }, []);
  React.useEffect(() => { refreshAiUsage(); }, [refreshAiUsage]);

  // Reset to a fresh conversation — clears thread state, lets the next
  // submit create a new thread server-side.
  function newConversation() {
    setTurns([]);
    setThreadId(null);
    setTask('');
    setFollowUpTask('');
  }

  // Open an existing thread from the side panel. Loads every persisted
  // turn so the admin sees the full conversation, then closes the panel.
  async function openThread(id: number) {
    try {
      const full = await apiGet<{ id: number; turns: Array<{ user_task: string; plan: AgentResult }> }>(`/ai/admin-agent/threads/${id}`);
      setThreadId(full.id);
      setTurns(full.turns.map((t) => ({ user_task: t.user_task, result: t.plan })));
      setShowHistory(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao abrir conversa'));
    }
  }

  async function archiveThread(id: number) {
    if (!confirm(tr('Arquivar essa conversa?'))) return;
    try {
      await apiPost(`/ai/admin-agent/threads/${id}/archive`, {});
      if (id === threadId) newConversation();
      refreshThreads();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao arquivar'));
    }
  }

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
        thread_id: threadId ?? undefined,
      });
      setTurns([...turns, { user_task: task, result: out }]);
      if (out.thread_id) setThreadId(out.thread_id);
      refreshThreads();
      refreshAiUsage();
      // Clear the main composer so the same text doesn't accidentally
      // get resubmitted as a follow-up. The form fields (mode/budget/
      // urgency/location) stay so the admin can refine without retyping.
      setTask('');
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

  // Follow-up — appends to the existing thread. Smaller composer, just
  // text, no mode/budget/urgency reset. Designed for "what about cost?"
  // / "the first vendor said no, try another" / "wait, isn't this the
  // same as last time?" patterns. Reuses the same agent endpoint with
  // thread_id so the server's prior_turns logic kicks in.
  async function sendFollowUp() {
    if (followUpTask.trim().length < 3) {
      toast.error(tr('Escreva sua pergunta de acompanhamento.'));
      return;
    }
    setFollowUpLoading(true);
    try {
      const out = await apiPost<AgentResult>('/ai/admin-agent', {
        task: followUpTask,
        mode,
        locale,
        thread_id: threadId ?? undefined,
      });
      setTurns([...turns, { user_task: followUpTask, result: out }]);
      if (out.thread_id) setThreadId(out.thread_id);
      setFollowUpTask('');
      refreshThreads();
      refreshAiUsage();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao enviar pergunta'));
    } finally {
      setFollowUpLoading(false);
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
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory((x) => !x)}
            >
              {tr('Conversas')} {threads.length > 0 ? `(${threads.length})` : ''}
            </Button>
            {(turns.length > 0 || threadId) && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={newConversation}
                leftIcon={<Sparkles className="w-3.5 h-3.5" />}
              >
                {tr('Nova conversa')}
              </Button>
            )}
          </div>
        }
      />

      {/* Thread history drawer — collapsed by default, opens above the
          workbench so the admin can pick a past conversation to resume.
          Hidden when there's nothing to show. */}
      {showHistory && threads.length > 0 && (
        <GlassCard className="p-4 mb-5 animate-fade-up">
          <div className="text-xs uppercase tracking-wider text-dusk-300 mb-2">
            {tr('Conversas recentes')}
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {threads.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border p-2.5 text-sm ${
                  t.id === threadId
                    ? 'bg-sage-100/60 border-sage-300/60'
                    : 'bg-white/60 border-white/70 hover:bg-white/80'
                }`}
              >
                <button
                  type="button"
                  className="flex-1 text-left min-w-0"
                  onClick={() => openThread(t.id)}
                >
                  <div className="font-medium text-dusk-500 truncate">{t.title || tr('Conversa sem título')}</div>
                  <div className="text-xs text-dusk-300 mt-0.5">
                    {t.turn_count} {tr(t.turn_count === 1 ? 'turno' : 'turnos')} · {new Date(t.updated_at).toLocaleString(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => archiveThread(t.id)}
                  className="text-xs text-dusk-300 hover:text-peach-700 px-2"
                  aria-label={tr('Arquivar')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

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
              {tr('Pesquisa externa só aparece com fontes; sem provedor configurado, o agente mostra buscas manuais e não inventa fornecedores ou preços.')}
            </p>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-4 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={aiUsage?.ai_available === false ? 'warning' : 'sage'}>
                {aiUsage?.ai_available === false ? tr('IA indisponível') : tr('IA disponível')}
              </Badge>
              <span className="text-xs uppercase tracking-[0.18em] text-dusk-300">
                {tr('Uso dos últimos 7 dias')}
              </span>
            </div>
            <p className="text-sm text-dusk-400 mt-2">
              {aiUsage?.ai_available === false && aiUsage.breaker_open_until
                ? `${tr('Circuito de créditos aberto até')} ${new Date(aiUsage.breaker_open_until).toLocaleString(locale)}`
                : tr('Mostra chamadas reais ao modelo, tokens e custo estimado para o condomínio ativo.')}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 min-w-full lg:min-w-[360px]">
            <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-dusk-300">{tr('Chamadas')}</p>
              <p className="font-display text-xl text-dusk-500 mt-1">{aiUsage ? aiUsage.total_calls : '—'}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-dusk-300">{tr('Tokens')}</p>
              <p className="font-display text-xl text-dusk-500 mt-1">{aiUsage ? formatCompactNumber(aiUsage.total_tokens, locale) : '—'}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-dusk-300">{tr('Custo est.')}</p>
              <p className="font-display text-xl text-dusk-500 mt-1">{aiUsage ? formatUsd(aiUsage.est_cost_usd, locale) : '—'}</p>
            </div>
          </div>
        </div>
        {aiUsage?.by_caller?.[0] && (
          <div className="mt-3 text-xs text-dusk-300">
            {tr('Maior uso')}: <span className="text-dusk-500 font-medium">{aiUsage.by_caller[0].caller}</span>
            {' · '}
            {formatCompactNumber(aiUsage.by_caller[0].total_tokens, locale)} {tr('tokens')}
          </div>
        )}
      </GlassCard>

      {/* Live progress while a request is in flight. Renders each crumb
          the runner emits so the 30-55s ReAct wait becomes legible. The
          last step gets a spinning icon to signal "this is still
          happening". Hidden when no progress yet (first ~1s) or when
          the request settles. */}
      {loading && liveProgress.length > 0 && (
        <GlassCard variant="clay-sage" className="p-4 mb-5 animate-fade-up">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-dusk-300 mb-2">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            {tr('O agente está pesquisando')}
          </div>
          <ol className="space-y-1.5">
            {liveProgress.map((step, idx) => {
              const isLast = idx === liveProgress.length - 1;
              return (
                <li key={idx} className="flex items-center gap-2 text-sm">
                  {isLast ? (
                    <Loader2 className="w-3.5 h-3.5 text-sage-700 animate-spin shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-sage-700 shrink-0" />
                  )}
                  <span className={isLast ? 'text-dusk-500 font-medium' : 'text-dusk-400'}>
                    {step.label}
                  </span>
                  {step.detail && (
                    <span className="text-xs text-dusk-300 truncate">— {step.detail}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </GlassCard>
      )}

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

      {/* Prior turns ribbon — collapsed cards above the latest result so
          the admin sees what they've already asked. Only renders when
          there's more than one turn (otherwise the "latest" IS the only
          turn and there's nothing to scroll past). Compact by design;
          the latest turn keeps the full plan layout below. */}
      {turns.length > 1 && (
        <div className="space-y-2 mb-4 animate-fade-up">
          <div className="text-xs uppercase tracking-wider text-dusk-300">
            {tr('Turnos anteriores')}
          </div>
          {turns.slice(0, -1).map((t, idx) => (
            <GlassCard key={idx} className="p-3">
              <div className="text-xs text-dusk-300 mb-1">
                <span className="inline-block rounded-full bg-dusk-200/60 text-dusk-500 px-2 py-0.5 font-semibold">
                  {tr('Você')}
                </span>
              </div>
              <div className="text-sm text-dusk-500 mb-2">{t.user_task}</div>
              <div className="text-xs text-dusk-300 mb-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-sage-200/60 text-dusk-500 px-2 py-0.5 font-semibold">
                  <Bot className="w-3 h-3" /> {tr('Agente')}
                </span>
              </div>
              <div className="text-sm text-dusk-400 whitespace-pre-line">{t.result.summary}</div>
            </GlassCard>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-5 animate-fade-up">
          {/* Echo the latest user task above the agent card so the admin
              has visual anchor — especially helpful on the second+ turn
              when there's a stack of replies and questions. */}
          {latestTurn && turns.length > 1 && (
            <div className="rounded-3xl bg-dusk-200/40 border border-dusk-200/60 p-3 text-sm text-dusk-500">
              <span className="text-xs uppercase tracking-wider text-dusk-400 mr-2">{tr('Você')}</span>
              {latestTurn.user_task}
            </div>
          )}
          {/* Tool-use trace — only renders on ReAct path. Shows what the
              agent looked up before answering. Builds trust ("it actually
              checked the past tickets, didn't just make this up") and
              doubles as a debugging surface when output looks off. */}
          {result.agent_trace && result.agent_trace.length > 0 && (
            <details className="rounded-3xl bg-white/60 border border-white/70 px-4 py-3 text-sm">
              <summary className="cursor-pointer text-dusk-400 inline-flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{tr('Como o agente pesquisou')} ({result.agent_trace.length})</span>
              </summary>
              <ol className="mt-3 space-y-1.5 text-xs text-dusk-400">
                {result.agent_trace.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="font-semibold text-sage-700 shrink-0">{idx + 1}.</span>
                    <div className="min-w-0">
                      <div className="font-medium text-dusk-500">{tr(step.tool)}</div>
                      {step.output_summary && (
                        <div className="text-dusk-300 mt-0.5">{step.output_summary}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {/* Fallback mode is not a tailored plan — say so loudly. A small
              badge alone lets an admin mistake the generic checklist for
              real AI output. This fires when the LLM call failed (e.g.
              OpenRouter out of credits) and the deterministic template
              was served instead. */}
          {result._fallback && (
            <div className="rounded-3xl border border-peach-200 bg-peach-50/80 p-4">
              <p className="text-sm font-medium text-peach-500">⚠ {tr('A IA não rodou — checklist genérico')}</p>
              <p className="text-xs text-dusk-400 mt-1">{tr('O serviço de IA está indisponível (sem créditos). Este é um checklist padrão, não um plano sob medida para o seu prédio. Para reativar a IA, recarregue os créditos do OpenRouter.')}</p>
            </div>
          )}

          <GlassCard variant="clay" className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="sage">{tr('Plano gerado')}</Badge>
                  {result._fallback ? <Badge tone="warning">{tr('Fallback seguro')}</Badge> : null}
                  <Badge tone="neutral">{agentTaskTypeLabel(result.task_type, tr)}</Badge>
                  {turns.length > 1 && <Badge tone="neutral">{tr('Turno')} {turns.length}</Badge>}
                  {result.confidence && <ConfidenceChip confidence={result.confidence} tr={tr} />}
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
            {/* Data-wall rescue chips — when the agent couldn't fully
                answer (no vendor, no cost data, unclear scope), it
                surfaces follow-up questions the admin can click to
                pre-fill the composer. Turns a wall into a conversation
                pivot. Renders nothing when there's nothing to suggest. */}
            {result.follow_up_suggestions && result.follow_up_suggestions.length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-dusk-300 mb-2">{tr('Sugestões para continuar')}</p>
                <div className="flex flex-wrap gap-2">
                  {result.follow_up_suggestions.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setFollowUpTask(s);
                        // Scroll the composer into view so the admin sees
                        // the prefill landed.
                        setTimeout(() => {
                          const ta = Array.from(document.querySelectorAll('textarea')).find((t) => /Ricardo/.test((t as HTMLTextAreaElement).placeholder || ''));
                          ta?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          (ta as HTMLTextAreaElement | undefined)?.focus();
                        }, 100);
                      }}
                      className="text-xs text-left rounded-full px-3 py-1.5 bg-white/70 border border-white/80 text-dusk-500 hover:bg-sage-100/60 hover:border-sage-300/60 transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>

          {result.evidence_sources && result.evidence_sources.length > 0 && (
            <EvidenceSourcesSection sources={result.evidence_sources} tr={tr} />
          )}

          {/* Building memory: the agent's recall of this building's own
              history. Rendered before the network because past resolutions
              are stronger evidence than abstract vendor matching. Renders
              nothing when memory is empty (new buildings, no patterns,
              business hours) — empty silence is honest. */}
          {result.building_memory && <BuildingMemorySection memory={result.building_memory} locale={locale} tr={tr} />}

          {result.attachment_analysis && result.attachment_analysis.length > 0 && (
            <VisualEvidenceSection items={result.attachment_analysis} tr={tr} />
          )}

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
                        // High confidence (3+ past expenses) → sage chip,
                        // "Histórico". Low confidence (1-2) → neutral chip,
                        // "Valor de referência" + explicit caveat. One
                        // past invoice ≠ a reliable estimate.
                        cost.confidence === 'high' ? (
                          <div className="mt-3 rounded-2xl bg-sage-100/60 border border-sage-200/60 p-2.5 text-xs text-dusk-400">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="font-semibold text-sage-700">{tr('Histórico')}:</span>
                              {cost.last_amount_brl != null && (
                                <span>
                                  {tr('última vez')} <span className="font-semibold text-dusk-500">{formatEstimatedCost(cost.last_amount_brl, locale)}</span>
                                </span>
                              )}
                              {cost.avg_brl != null && (
                                <span className="text-dusk-300">
                                  · {tr('média')} {formatEstimatedCost(cost.avg_brl, locale)} ({cost.expense_count}×)
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-2xl bg-white/60 border border-white/70 p-2.5 text-xs text-dusk-400">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="font-semibold text-dusk-400">{tr('Valor de referência')}:</span>
                              {cost.last_amount_brl != null && (
                                <span>
                                  <span className="font-semibold text-dusk-500">{formatEstimatedCost(cost.last_amount_brl, locale)}</span>
                                </span>
                              )}
                              <span className="text-dusk-300">
                                · {cost.expense_count === 1 ? tr('1 cobrança anterior') : `${cost.expense_count} ${tr('cobranças anteriores')}`}
                              </span>
                            </div>
                            <div className="text-[11px] text-dusk-300 mt-0.5">{tr('Peça orçamento atualizado.')}</div>
                          </div>
                        )
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

          {result.vendor_search_plan && (
            (result.vendor_search_plan.search_queries.length > 0 ||
              result.vendor_search_plan.shortlisting_criteria.length > 0 ||
              !!result.vendor_search_plan.outreach_message) && (
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                  <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-sage-700" />
                    {tr('Plano de pesquisa')}
                  </h2>
                  {result.vendor_search_plan.outreach_message && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => copyText(result.vendor_search_plan.outreach_message)} leftIcon={<Copy className="w-4 h-4" />}>
                      {tr('Copiar mensagem')}
                    </Button>
                  )}
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {result.vendor_search_plan.search_queries.length > 0 && (
                    <div className="rounded-3xl bg-white/60 border border-white/70 p-4">
                      <MiniList title={tr('Buscas prontas')} items={result.vendor_search_plan.search_queries} />
                    </div>
                  )}
                  {result.vendor_search_plan.shortlisting_criteria.length > 0 && (
                    <div className="rounded-3xl bg-white/60 border border-white/70 p-4">
                      <MiniList title={tr('Critérios de seleção')} items={result.vendor_search_plan.shortlisting_criteria} />
                    </div>
                  )}
                </div>
                {result.vendor_search_plan.outreach_message && (
                  <div className="mt-4 rounded-3xl bg-cream-50/70 border border-white/70 p-4">
                    <h3 className="text-xs uppercase tracking-[0.16em] text-dusk-300 mb-2">{tr('Mensagem para fornecedores')}</h3>
                    <p className="text-sm text-dusk-500">{result.vendor_search_plan.outreach_message}</p>
                  </div>
                )}
              </GlassCard>
            )
          )}

          {/* Action plan only renders when the server's denylist filter
              kept at least one item. Empty plan = nothing the platform
              can't already do, which is the honest answer for most
              repair cases. */}
          {result.action_plan.length > 0 && (
            <GlassCard className="p-5">
              <h2 className="font-display text-xl text-dusk-500 mb-3">{tr('Próximos passos manuais')}</h2>
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
          )}

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

          {/* Follow-up composer — only renders when a result exists, so
              the admin's mental model is "first plan above → ask a
              follow-up here." Smaller than the main form: just a textarea
              + send. Mode/budget/urgency carry over from the parent
              state so the admin doesn't reconfigure for follow-ups. */}
          <GlassCard variant="clay-sage" className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-dusk-400" />
              <span className="text-sm font-semibold text-dusk-500">{tr('Continuar a conversa')}</span>
              <span className="text-xs text-dusk-300">— {tr('o agente lembra o que vocês discutiram acima')}</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <textarea
                className="input flex-1 min-h-[60px] resize-none"
                value={followUpTask}
                onChange={(e) => setFollowUpTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendFollowUp();
                }}
                maxLength={4000}
                placeholder={tr('ex: "E se Ricardo disser que está ocupado?" ou "Quanto tempo costuma demorar?"')}
                disabled={followUpLoading}
              />
              <Button
                type="button"
                variant="primary"
                loading={followUpLoading}
                disabled={followUpTask.trim().length < 3}
                onClick={sendFollowUp}
                leftIcon={<Send className="w-4 h-4" />}
              >
                {tr('Enviar')}
              </Button>
            </div>
          </GlassCard>
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

// Building memory section — surfaces three signals the model also sees in
// its prompt context:
//   1. Past resolved tickets with the same symptom in this building
//   2. Pattern alert when >=3 similar tickets are open
//   3. After-hours warning so the admin doesn't get an "act now"
//      suggestion at 11pm
// Each signal renders only when present; an empty memory block renders
// nothing (the parent guards on `result.building_memory` being truthy).
// Confidence chip — sage/neutral/peach tone matches the tier. Hover/tap
// reveals the reasoning so the admin can verify the rating. Score is
// rendered as a percentage for legibility ("85%" not "0.85").
function ConfidenceChip({ confidence, tr }: {
  confidence: { score: number; tier: 'high' | 'medium' | 'low'; reasoning: string[] };
  tr: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const tone = confidence.tier === 'high' ? 'sage' : confidence.tier === 'medium' ? 'neutral' : 'peach';
  const pct = Math.round(confidence.score * 100);
  const label = confidence.tier === 'high' ? tr('alta confiança')
    : confidence.tier === 'medium' ? tr('confiança moderada')
    : tr('baixa confiança');
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex">
        <Badge tone={tone}>{label} · {pct}%</Badge>
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-20 w-72 rounded-2xl bg-white/95 backdrop-blur border border-white/80 shadow-clay p-3 text-xs text-dusk-400"
          onClick={() => setOpen(false)}
        >
          <div className="font-semibold text-dusk-500 mb-1.5">{tr('Por quê essa confiança?')}</div>
          <ul className="space-y-1">
            {confidence.reasoning.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-dusk-300 mt-0.5">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function agentTaskTypeLabel(type: string, tr: (k: string) => string) {
  const labels: Record<string, string> = {
    repair: 'Conserto',
    install: 'Instalação',
    vendor_research: 'Pesquisa de fornecedores',
    policy: 'Política',
    general: 'Geral',
  };
  return tr(labels[type] || type);
}

function evidenceTypeLabel(type: AgentEvidenceSource['type'], tr: (k: string) => string) {
  const labels: Record<AgentEvidenceSource['type'], string> = {
    past_ticket: 'Chamado anterior',
    vendor_history: 'Histórico do fornecedor',
    web_citation: 'Citação web',
    photo: 'Foto',
    pattern: 'Padrão',
    after_hours: 'Fora do expediente',
  };
  return tr(labels[type]);
}

function EvidenceSourcesSection({ sources, tr }: {
  sources: AgentEvidenceSource[];
  tr: (k: string) => string;
}) {
  const toneFor = (type: AgentEvidenceSource['type']): 'sage' | 'peach' | 'neutral' => {
    if (type === 'web_citation' || type === 'vendor_history') return 'sage';
    if (type === 'pattern' || type === 'after_hours') return 'peach';
    return 'neutral';
  };
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          {tr('Evidências usadas')}
        </h2>
        <Badge tone="neutral">{sources.length}</Badge>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {sources.map((source, idx) => (
          <div key={`${source.type}-${idx}`} className="rounded-3xl bg-white/60 border border-white/70 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={toneFor(source.type)}>{evidenceTypeLabel(source.type, tr)}</Badge>
              {source.source && <span className="text-[11px] text-dusk-300">{source.source}</span>}
            </div>
            <h3 className="font-semibold text-dusk-500 mt-2">{source.title}</h3>
            <p className="text-sm text-dusk-400 mt-1">{source.detail}</p>
            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sage-700 font-semibold mt-3 hover:text-sage-800"
              >
                {tr('Abrir fonte')} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// Visual evidence section — what the agent actually SAW. We show this
// even when the model didn't cite the photos in its summary, because
// the admin should always see what the vision pipeline produced. Tags
// are colour-coded — urgency_high gets the peach treatment so the
// admin's eye lands on it first.
function VisualEvidenceSection({ items, tr }: {
  items: Array<{ id: number; description: string; signals: string[] }>;
  tr: (k: string) => string;
}) {
  const tagTone = (tag: string): 'sage' | 'peach' | 'neutral' => {
    if (tag === 'urgency_high') return 'peach';
    if (/^(leak_active|water_visible|exposed_wiring|electrical_burn|mold_visible|broken_)/.test(tag)) return 'peach';
    if (tag === 'urgency_low' || tag === 'no_visible_problem') return 'sage';
    if (/^(photo_|is_)/.test(tag)) return 'neutral';
    return 'neutral';
  };
  return (
    <GlassCard variant="clay" className="p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          {tr('O que a IA viu nas fotos')}
        </h2>
        <Badge tone="neutral">{items.length}</Badge>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl bg-white/60 border border-white/70 p-3">
            <p className="text-sm text-dusk-500">{item.description}</p>
            {item.signals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {item.signals.map((s) => (
                  <Badge key={s} tone={tagTone(s)}>{tr(s)}</Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function BuildingMemorySection({ memory, locale, tr }: {
  memory: BuildingMemory;
  locale: string;
  tr: (k: string) => string;
}) {
  const showPattern = memory.open_similar_count >= 3;
  const showAfterHours = memory.is_outside_business_hours;
  const showResolutions = memory.similar_resolved_tickets.length > 0;
  if (!showResolutions && !showPattern && !showAfterHours) return null;

  return (
    <GlassCard variant="clay" className="p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-xl text-dusk-500 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          {tr('Memória do prédio')}
        </h2>
        {memory.inferred_category && (
          <Badge tone="neutral">{tr(memory.inferred_category)}</Badge>
        )}
      </div>

      {showPattern && (
        <div className="rounded-2xl bg-peach-100/50 border border-peach-300/50 p-3 mb-3 text-sm text-dusk-500">
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-peach-700" />
            {tr('Padrão detectado')}
          </div>
          <div className="text-xs text-dusk-400 mt-1">
            {memory.open_similar_count} {tr('chamados abertos da mesma categoria nos últimos 30 dias. Considere vistoria preventiva antes que vire emergência.')}
          </div>
        </div>
      )}

      {showAfterHours && (
        <div className="rounded-2xl bg-white/50 border border-white/70 p-3 mb-3 text-xs text-dusk-400">
          {tr('Fora do horário comercial agora')} ({String(memory.local_hour).padStart(2, '0')}h). {tr('Para tarefas não urgentes, prefira contatar amanhã de manhã.')}
        </div>
      )}

      {showResolutions && (
        <div>
          <div className="text-xs uppercase tracking-wider text-dusk-300 mb-2">
            {tr('Resoluções anteriores')}
          </div>
          <div className="space-y-2">
            {memory.similar_resolved_tickets.map((t) => (
              <div key={t.id} className="rounded-2xl bg-white/60 border border-white/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-dusk-500 text-sm">{t.title}</div>
                  {t.resolved_at && (
                    <div className="text-xs text-dusk-300 shrink-0">
                      {new Date(t.resolved_at).toLocaleDateString(locale, { year: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
                {t.resolution_note && (
                  <div className="text-xs text-dusk-400 mt-1.5">{t.resolution_note}</div>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
                  {t.dispatched_vendors && (
                    <span className="rounded-full bg-white/70 border border-white/80 px-2 py-0.5 text-dusk-400">
                      {t.dispatched_vendors}
                    </span>
                  )}
                  {t.estimated_cost_brl != null && (
                    <span className="rounded-full bg-sage-100/60 border border-sage-200/60 px-2 py-0.5 text-dusk-500 font-semibold">
                      {formatEstimatedCost(t.estimated_cost_brl, locale)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
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
