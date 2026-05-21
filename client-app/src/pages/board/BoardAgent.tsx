import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ClipboardList, Copy, ExternalLink, Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost, apiPatch } from '../../lib/api';
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
  diagnostics_available?: boolean;
  debug_view?: {
    building_memory?: BuildingMemory | null;
    agent_trace?: AgentTraceStep[];
    evidence_sources?: AgentEvidenceSource[];
    attachment_analysis?: Array<{
      id: number;
      description: string;
      signals: string[];
    }>;
    confidence?: {
      score: number;
      tier: 'high' | 'medium' | 'low';
      reasoning: string[];
    };
  };
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

function agentFallbackCopy(status: AgentResult['ai_status'] | undefined, tr: (key: string) => string) {
  if (status === 'unavailable') {
    return {
      title: tr('IA indisponível — checklist seguro'),
      detail: tr('O serviço de IA não está disponível agora. Este checklist é operacional, mas não foi personalizado pelo modelo; use-o como triagem e tente gerar novamente quando a IA voltar.'),
    };
  }
  return {
    title: tr('IA incompleta — checklist seguro'),
    detail: tr('O agente não conseguiu concluir uma resposta sob medida, então mostramos um checklist seguro para não travar o fluxo. Você ainda pode copiar mensagens, procurar fornecedores e continuar a conversa.'),
  };
}

function formatAgentPlanForCopy(result: AgentResult, tr: (key: string) => string) {
  const lines: string[] = [
    `${tr('Resumo')}:`,
    result.summary,
    '',
    `${tr('Próximo passo')}:`,
    result.recommended_next_step,
  ];

  if (result.existing_network_fit.length > 0) {
    lines.push('', `${tr('Sua rede cadastrada')}:`);
    for (const fit of result.existing_network_fit) {
      lines.push(`- ${fit.company_name}: ${fit.reason}`);
    }
  }

  if (result.options.length > 0) {
    lines.push('', `${tr(result.options.length >= 2 ? 'Opções' : 'Recomendação')}:`);
    for (const option of result.options) {
      lines.push(`- ${option.title}: ${option.fit}`);
      lines.push(`  ${tr('Custo')}: ${option.estimated_cost_range}; ${tr('Prazo')}: ${option.timeline}`);
    }
  }

  if (result.vendor_search_plan?.outreach_message) {
    lines.push('', `${tr('Mensagem para fornecedores')}:`, result.vendor_search_plan.outreach_message);
  }

  if (result.resident_update?.title || result.resident_update?.body) {
    lines.push('', `${tr('Comunicado aos moradores')}:`, result.resident_update.title, result.resident_update.body);
  }

  if (result.risks.length > 0) {
    lines.push('', `${tr('Riscos')}:`, ...result.risks.map((risk) => `- ${risk}`));
  }

  return lines.filter((line, idx, all) => line !== '' || all[idx - 1] !== '').join('\n');
}

function getAgentDebugView(result: AgentResult | null): AgentResult['debug_view'] | null {
  if (!result) return null;
  if (result.debug_view) return result.debug_view;
  const fallbackDebug = {
    building_memory: result.building_memory,
    agent_trace: result.agent_trace,
    evidence_sources: result.evidence_sources,
    attachment_analysis: result.attachment_analysis,
    confidence: result.confidence,
  };
  const hasFallbackDebug = !!(
    fallbackDebug.building_memory ||
    fallbackDebug.confidence ||
    (fallbackDebug.agent_trace && fallbackDebug.agent_trace.length > 0) ||
    (fallbackDebug.evidence_sources && fallbackDebug.evidence_sources.length > 0) ||
    (fallbackDebug.attachment_analysis && fallbackDebug.attachment_analysis.length > 0)
  );
  return hasFallbackDebug ? fallbackDebug : null;
}

export default function BoardAgent() {
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const navigate = useNavigate();
  // ARC-R5 — Auto-dispatch kill switch state. Surface the current
  // setting + a toggle so the board can pause automatic vendor sends
  // without a redeploy. The agent itself still runs (drafting outreach
  // for the admin is still valuable); only the auto-WhatsApp fire is
  // gated. Reads from /api/admin/agent/kill-switch on mount.
  const [autoDispatchEnabled, setAutoDispatchEnabled] = useState<boolean | null>(null);
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);
  React.useEffect(() => {
    apiGet<{ auto_dispatch_enabled: boolean }>('/admin/agent/kill-switch')
      .then((r) => setAutoDispatchEnabled(r.auto_dispatch_enabled))
      .catch(() => setAutoDispatchEnabled(null));
  }, []);
  async function toggleAutoDispatch() {
    if (autoDispatchEnabled == null || killSwitchBusy) return;
    setKillSwitchBusy(true);
    try {
      const next = !autoDispatchEnabled;
      await apiPatch('/admin/agent/kill-switch', { auto_dispatch_enabled: next });
      setAutoDispatchEnabled(next);
      toast.success(next ? tr('Auto-dispatch ligado') : tr('Auto-dispatch pausado'));
    } catch {
      toast.error(tr('Não foi possível atualizar'));
    } finally {
      setKillSwitchBusy(false);
    }
  }

  // Observability — dispatch queue snapshot, polled every 12s while
  // the page is open. 12s lines up with the 5s worker tick + small
  // network latency; a fresh enqueue shows up "queued: 1" within
  // one poll and transitions to "claimed" or "done" on the next.
  // Stops polling when the tab is hidden so we don't burn Fly hours
  // on a backgrounded tab.
  const [queueStatus, setQueueStatus] = useState<{
    counts: { queued: number; claimed: number; done: number; failed: number };
    oldest_queued_age_seconds: number | null;
    oldest_claimed_age_seconds: number | null;
    failed_24h: number;
    recent_failures: Array<{ id: number; ticket_id: number; finished_at: string; last_error: string | null; attempt_count: number }>;
    active_workers: string[];
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await apiGet<typeof queueStatus extends infer T ? Exclude<T, null> : never>('/admin/agent/queue/status');
        if (!cancelled) setQueueStatus(r as any);
      } catch { /* transient — try again next tick */ }
      if (!cancelled && document.visibilityState !== 'hidden') {
        timer = setTimeout(tick, 12_000);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible' && !timer) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  // Health heuristic. Healthy when no failures in 24h AND queue isn't
  // backed up (no row queued >30s, no row claimed >5min). Surfaces
  // the worst signal as the banner tone — green/sage on healthy,
  // amber on lag, red on recent failures.
  const queueHealth: { tone: 'sage' | 'amber' | 'red'; reason: string | null } = (() => {
    if (!queueStatus) return { tone: 'sage', reason: null };
    if (queueStatus.failed_24h > 0) {
      return { tone: 'red', reason: tr('Falhas recentes — confira os chamados afetados') };
    }
    if ((queueStatus.oldest_queued_age_seconds ?? 0) > 30) {
      return { tone: 'amber', reason: tr('Fila com atraso — worker pode estar travado') };
    }
    if ((queueStatus.oldest_claimed_age_seconds ?? 0) > 300) {
      return { tone: 'amber', reason: tr('Análise em andamento há muito tempo') };
    }
    return { tone: 'sage', reason: null };
  })();
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

  function openResearchPlan() {
    const section = document.getElementById('agent-research-plan');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const hasVendorSearchPlan = !!result && (
    result.vendor_search_plan.search_queries.length > 0 ||
    result.vendor_search_plan.shortlisting_criteria.length > 0 ||
    !!result.vendor_search_plan.outreach_message
  );
  const hasResidentUpdate = !!result && !!(
    result.resident_update.title.trim() ||
    result.resident_update.body.trim()
  );
  const canCreateProposal = !!result?.proposal_draft && (mode === 'install' || mode === 'policy');
  const debugView = getAgentDebugView(result);
  const hasTechnicalDiagnostics = !!(debugView || aiUsage);
  const primaryFit = result?.existing_network_fit?.[0] || null;
  const primaryVendor = primaryFit
    ? vendors.find((v) => v.company_name === primaryFit.company_name) || null
    : null;
  const primaryVendorCanSend = !!primaryVendor && (!!primaryVendor.whatsapp || !!primaryVendor.email);
  const primarySearchQuery = result?.vendor_search_plan?.search_queries?.[0] || '';
  const hasPlanDetails = !!result && (
    result.existing_network_fit.length > 1 ||
    result.options.length > 0 ||
    hasVendorSearchPlan ||
    result.action_plan.length > 0 ||
    hasResidentUpdate ||
    canCreateProposal ||
    result.risks.length > 0 ||
    result.assumptions.length > 0
  );

  return (
    <>
      <PageHeader
        title={tr('Agente IA')}
        subtitle={tr('Copiloto operacional para consertos, instalações e decisões — usa a sua rede de fornecedores cadastrada para sugerir e enviar o próximo passo.')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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

      {/* ARC-R5 — Auto-dispatch kill switch. Compact banner that shows
          the current state and lets the board pause / resume without
          a redeploy. Hidden until the GET resolves so we don't flash
          a wrong default state. */}
      {autoDispatchEnabled !== null && (
        <GlassCard
          className={`p-3 mb-5 flex items-center justify-between gap-3 ${
            autoDispatchEnabled ? '' : 'border-amber-300 bg-amber-50/60'
          }`}
        >
          <div className="flex items-center gap-2.5 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${autoDispatchEnabled ? 'bg-sage-500' : 'bg-amber-500'}`} />
            <div>
              <div className="font-medium text-dusk-500">
                {autoDispatchEnabled
                  ? tr('Auto-dispatch ativo')
                  : tr('Auto-dispatch pausado')}
              </div>
              <div className="text-xs text-dusk-300">
                {autoDispatchEnabled
                  ? tr('Chamados verificados são enviados ao fornecedor automaticamente após a janela de cancelamento.')
                  : tr('O agente continua analisando, mas nenhum disparo automático é enviado. Aprovação manual obrigatória.')}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant={autoDispatchEnabled ? 'ghost' : 'primary'}
            size="sm"
            onClick={toggleAutoDispatch}
            loading={killSwitchBusy}
          >
            {autoDispatchEnabled ? tr('Pausar') : tr('Reativar')}
          </Button>
        </GlassCard>
      )}

      {/* Observability — dispatch queue snapshot. UX inspection
          2026-05-21: was always visible 4-stat-tile panel competing
          with the form for visual attention. Most days the queue is
          healthy and the stats don't change anything the admin does.
          Now: render as a single compact health indicator that auto-
          expands only when the health tone is amber/red OR when the
          admin clicks the chip to see the detail. */}
      {queueStatus && (() => {
        const isUnhealthy = queueHealth.tone !== 'sage';
        return (
          <details
            data-testid="queue-ops-panel"
            className="mb-5 group"
            open={isUnhealthy}
          >
            <summary className={`cursor-pointer list-none inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs border transition ${
              queueHealth.tone === 'red' ? 'border-red-300 bg-red-50/80 text-red-800'
              : queueHealth.tone === 'amber' ? 'border-amber-300 bg-amber-50/80 text-amber-900'
              : 'border-white/70 bg-white/60 text-dusk-400 hover:bg-white/80'
            }`}>
              <span className={`inline-block w-2 h-2 rounded-full ${
                queueHealth.tone === 'red' ? 'bg-red-500'
                : queueHealth.tone === 'amber' ? 'bg-amber-500'
                : 'bg-sage-500'
              }`} />
              <span className="font-medium">{tr('Fila de despachos')}</span>
              {queueStatus.counts.queued + queueStatus.counts.claimed > 0 && (
                <span className="text-dusk-300">· {queueStatus.counts.queued + queueStatus.counts.claimed} {tr('ativos')}</span>
              )}
              {queueStatus.failed_24h > 0 && (
                <span className="text-red-700">· {queueStatus.failed_24h} {tr('falhas 24h')}</span>
              )}
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180 ml-1" />
            </summary>
            <GlassCard
              className={`mt-3 p-4 ${
                queueHealth.tone === 'red' ? 'border-red-300 bg-red-50/60'
                : queueHealth.tone === 'amber' ? 'border-amber-300 bg-amber-50/60'
                : ''
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-3 text-xs text-dusk-300">
                <span>{queueStatus.active_workers.length} {tr('worker(s) ativo(s)')}</span>
                {queueHealth.reason && <span className="text-dusk-400">{queueHealth.reason}</span>}
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-xl bg-white/60 px-2 py-2" data-testid="queue-ops-queued">
                  <div className="text-lg font-display text-dusk-500">{queueStatus.counts.queued}</div>
                  <div className="text-dusk-300">{tr('Em fila')}</div>
                </div>
                <div className="rounded-xl bg-white/60 px-2 py-2" data-testid="queue-ops-claimed">
                  <div className="text-lg font-display text-dusk-500">{queueStatus.counts.claimed}</div>
                  <div className="text-dusk-300">{tr('Em análise')}</div>
                </div>
                <div className="rounded-xl bg-white/60 px-2 py-2" data-testid="queue-ops-done">
                  <div className="text-lg font-display text-dusk-500">{queueStatus.counts.done}</div>
                  <div className="text-dusk-300">{tr('Concluídos')}</div>
                </div>
                <div className="rounded-xl bg-white/60 px-2 py-2" data-testid="queue-ops-failed">
                  <div className="text-lg font-display text-dusk-500">{queueStatus.failed_24h}</div>
                  <div className="text-dusk-300">{tr('Falhas (24h)')}</div>
                </div>
              </div>
              {queueStatus.recent_failures.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {queueStatus.recent_failures.map((f) => (
                    <li key={f.id} className="rounded-lg bg-white/60 px-2 py-1.5 flex items-center justify-between gap-2">
                      <span className="font-mono text-dusk-300">#{f.ticket_id}</span>
                      <span className="text-dusk-500 truncate flex-1">{f.last_error || tr('sem detalhes')}</span>
                      <span className="text-dusk-300">{new Date(f.finished_at).toLocaleString(locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </details>
        );
      })()}

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

      {/* UX inspection 2026-05-21 — the intro card only helps first-
          time users. Returning admins with prior conversations don't
          need a daily reminder of what the agent does. Show only when
          no result AND no prior threads have been started by this
          admin. */}
      {!result && !loading && threads.length === 0 && (
        <GlassCard variant="clay-sage" className="p-5 mb-5 overflow-hidden relative">
          <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-sage-200/60 blur-2xl" />
          <div className="relative flex items-start gap-4">
            <div className="w-12 h-12 rounded-3xl bg-dusk-400 text-cream-50 flex items-center justify-center shrink-0 shadow-clay">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display text-2xl text-dusk-500">{tr('Agente operacional')}</h2>
              <p className="text-sm text-dusk-400 mt-1 max-w-3xl">
                {tr('Descreva o problema ou decisão. O agente devolve um próximo passo, uma mensagem pronta e os detalhes só quando você quiser abrir.')}
              </p>
            </div>
          </div>
        </GlassCard>
      )}

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
                    {tr(step.label)}
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

      {/* UX inspection — form hidden while loading so the thinking
          pane has the user's full attention (was "where do I look"
          confusion). Also hidden when there's already a result; the
          follow-up textarea below the result becomes the entry point
          for the next turn. */}
      {!result && !loading && (
      <form onSubmit={submit} className="grid lg:grid-cols-[1.5fr_0.5fr] gap-5 mb-6">
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

          {/* UX inspection — Tipo de ajuda / Localização / Orçamento /
              Urgência are nice-to-haves. Hide them behind a disclosure
              so the default flow is "type + submit", and let admins
              who want to add context one click away. */}
          <details className="mt-4 group">
            <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs text-dusk-300 hover:text-dusk-500">
              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              {tr('+ adicionar contexto (tipo, local, orçamento, urgência)')}
            </summary>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
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
            </div>
          </details>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col items-stretch justify-center">
          <Button type="submit" variant="primary" className="w-full" loading={loading} leftIcon={<Sparkles className="w-4 h-4" />}>
            {tr('Gerar plano')}
          </Button>
          <p className="text-xs text-dusk-300 mt-3 text-center">
            {tr('30-60s, usa seu histórico do prédio')}
          </p>
        </GlassCard>
      </form>
      )}

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
        <div className="space-y-4 animate-fade-up">
          {latestTurn && turns.length > 1 && (
            <div className="rounded-3xl bg-dusk-200/40 border border-dusk-200/60 p-3 text-sm text-dusk-500">
              <span className="text-xs uppercase tracking-wider text-dusk-400 mr-2">{tr('Você')}</span>
              {latestTurn.user_task}
            </div>
          )}

          {result._fallback && (
            <div className="rounded-3xl border border-peach-200 bg-peach-50/80 p-4">
              {(() => {
                const copy = agentFallbackCopy(result.ai_status, tr);
                return (
                  <>
                    <p className="text-sm font-medium text-peach-500">! {copy.title}</p>
                    <p className="text-xs text-dusk-400 mt-1">{copy.detail}</p>
                  </>
                );
              })()}
            </div>
          )}

          <GlassCard variant="clay" className="p-5 overflow-hidden relative">
            <div className="absolute -right-16 -top-16 w-44 h-44 rounded-full bg-sage-200/50 blur-3xl" />
            <div className="relative">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="sage">{tr('Ação recomendada')}</Badge>
                    {result._fallback ? (
                      <Badge tone="warning">{tr('Fallback seguro')}</Badge>
                    ) : result.ai_status === 'ok' ? (
                      // Positive confirmation — the full pipeline ran end-to-end.
                      // Sets expectation that the plan is grounded in tool-call
                      // data (network fit, building memory, etc.) rather than a
                      // skeleton from the safety fallback. Tooltip points to
                      // the diagnostics drawer for admins who want proof.
                      <span title={result.diagnostics_available ? tr('Plano com diagnóstico — abra "Detalhes do plano"') : tr('Plano gerado com IA')}>
                        <Badge tone="neutral">✓ {tr('Plano IA')}</Badge>
                      </span>
                    ) : null}
                    <Badge tone="neutral">{agentTaskTypeLabel(result.task_type, tr)}</Badge>
                    {turns.length > 1 && <Badge tone="neutral">{tr('Turno')} {turns.length}</Badge>}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl text-dusk-500 mt-3">{result.recommended_next_step}</h2>
                  <p className="text-sm text-dusk-400 mt-3 max-w-3xl whitespace-pre-line">{result.summary}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="self-start sm:shrink-0" onClick={() => copyText(formatAgentPlanForCopy(result, tr))} leftIcon={<Copy className="w-4 h-4" />}>
                  {tr('Copiar plano')}
                </Button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {primaryFit ? (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!primaryVendorCanSend}
                    onClick={() => primaryVendor && setOutreachTarget({ vendor: primaryVendor, initialMessage: result.vendor_search_plan?.outreach_message || '' })}
                    leftIcon={<MessageCircle className="w-4 h-4" />}
                  >
                    {primaryVendorCanSend ? tr('Enviar mensagem') : tr('Sem contato no cadastro')}
                  </Button>
                ) : primarySearchQuery ? (
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(primarySearchQuery)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-sage-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sage-700 transition-colors"
                  >
                    {tr('Buscar fornecedores')} <ExternalLink className="w-4 h-4" />
                  </a>
                ) : canCreateProposal ? (
                  <Button type="button" variant="primary" loading={creatingProposal} onClick={createProposal} leftIcon={<Send className="w-4 h-4" />}>
                    {tr('Criar proposta')}
                  </Button>
                ) : hasResidentUpdate ? (
                  <Button type="button" variant="primary" onClick={() => copyText(`${result.resident_update.title}\n\n${result.resident_update.body}`)} leftIcon={<Copy className="w-4 h-4" />}>
                    {tr('Copiar comunicado')}
                  </Button>
                ) : null}

                {result.vendor_search_plan?.outreach_message && (
                  <Button type="button" variant="ghost" onClick={() => copyText(result.vendor_search_plan.outreach_message)} leftIcon={<Copy className="w-4 h-4" />}>
                    {tr('Copiar mensagem')}
                  </Button>
                )}
                {primaryFit && primarySearchQuery && (
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(primarySearchQuery)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-white/65 border border-white/80 px-4 py-2 text-sm font-semibold text-dusk-500 hover:bg-white/85 transition-colors"
                  >
                    {tr('Buscar alternativa')} <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                {!primaryFit && hasVendorSearchPlan && (
                  <Button type="button" variant="ghost" onClick={() => navigate('/board/services')}>
                    {tr('Cadastrar fornecedor')}
                  </Button>
                )}
              </div>

              {primaryFit && (
                <div className="mt-5 rounded-3xl bg-white/60 border border-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-dusk-300">{tr('Fornecedor sugerido')}</p>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-dusk-500">{primaryFit.company_name}</h3>
                    <Badge tone="neutral">{primaryFit.category}</Badge>
                  </div>
                  <p className="text-sm text-dusk-400 mt-1">{primaryFit.reason}</p>
                  <p className="text-xs text-dusk-300 mt-1">{primaryFit.contact_method}</p>
                </div>
              )}

              {result.vendor_search_plan?.outreach_message && (
                <div className="mt-5 rounded-3xl bg-cream-50/75 border border-white/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs uppercase tracking-[0.16em] text-dusk-300">{tr('Mensagem pronta')}</h3>
                    <Button type="button" variant="ghost" size="sm" onClick={() => copyText(result.vendor_search_plan.outreach_message)} leftIcon={<Copy className="w-4 h-4" />}>
                      {tr('Copiar')}
                    </Button>
                  </div>
                  <p className="text-sm text-dusk-500 mt-2 whitespace-pre-line">{result.vendor_search_plan.outreach_message}</p>
                </div>
              )}

              {result.follow_up_suggestions && result.follow_up_suggestions.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-dusk-300 mb-2">{tr('Sugestões para continuar')}</p>
                  <div className="flex flex-wrap gap-2">
                    {result.follow_up_suggestions.map((s, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setFollowUpTask(s);
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
            </div>
          </GlassCard>

          {hasPlanDetails && (
            <details className="group">
              <summary className="cursor-pointer list-none flex items-center gap-2 rounded-3xl bg-white/55 border border-white/70 px-4 py-3 text-sm text-dusk-500 hover:bg-white/75 transition-colors">
                <ClipboardList className="w-4 h-4 shrink-0 text-sage-700" />
                <span>{tr('Detalhes do plano')}</span>
                <ChevronDown className="w-4 h-4 ml-auto shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <GlassCard className="mt-3 p-5 space-y-5">
                {result.existing_network_fit.length > 0 && (
                  <section>
                    <h3 className="font-display text-xl text-dusk-500 mb-3">{tr('Fornecedores salvos')}</h3>
                    <div className="grid md:grid-cols-2 gap-3">
                      {result.existing_network_fit.map((fit) => {
                        const vendor = vendors.find((v) => v.company_name === fit.company_name);
                        const canSend = !!vendor?.whatsapp || !!vendor?.email;
                        const cost = fit.cost_history;
                        return (
                          <div key={fit.company_name} className="rounded-3xl bg-white/60 border border-white/70 p-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-dusk-500">{fit.company_name}</h4>
                              <Badge tone="neutral">{fit.category}</Badge>
                            </div>
                            <p className="text-sm text-dusk-400 mt-2">{fit.reason}</p>
                            <p className="text-xs text-dusk-300 mt-2">{fit.contact_method}</p>
                            {cost && cost.expense_count > 0 && (
                              <div className={`mt-3 rounded-2xl p-2.5 text-xs text-dusk-400 ${cost.confidence === 'high' ? 'bg-sage-100/60 border border-sage-200/60' : 'bg-white/60 border border-white/70'}`}>
                                <span className="font-semibold text-dusk-500">
                                  {cost.confidence === 'high' ? tr('Histórico') : tr('Valor de referência')}:
                                </span>
                                {cost.last_amount_brl != null && (
                                  <span> {formatEstimatedCost(cost.last_amount_brl, locale)}</span>
                                )}
                                {cost.avg_brl != null && (
                                  <span className="text-dusk-300"> · {tr('média')} {formatEstimatedCost(cost.avg_brl, locale)} ({cost.expense_count}x)</span>
                                )}
                              </div>
                            )}
                            <div className="mt-3">
                              <Button
                                type="button"
                                variant="ghost"
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
                  </section>
                )}

                {result.existing_network_fit.length === 0 && hasVendorSearchPlan && (
                  <section className="rounded-3xl bg-white/50 border border-white/70 p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <h3 className="font-display text-xl text-dusk-500">{tr('Encontrar fornecedor')}</h3>
                        <p className="text-sm text-dusk-400 mt-1">{tr('Nenhum fornecedor salvo combina com esse pedido. Use a busca pronta e cadastre o escolhido para a próxima vez.')}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {primarySearchQuery && (
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(primarySearchQuery)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-sage-100/70 border border-sage-300/60 px-3 py-1.5 text-xs font-semibold text-sage-800 hover:bg-sage-200/70"
                          >
                            {tr('Buscar fornecedores')} <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/board/services')}>
                          {tr('Cadastrar fornecedor')}
                        </Button>
                      </div>
                    </div>
                  </section>
                )}

                {result.options.length > 0 && (
                  <section>
                    <h3 className="font-display text-xl text-dusk-500 mb-3">{tr(result.options.length >= 2 ? 'Opções' : 'Recomendação')}</h3>
                    <div className="grid md:grid-cols-2 gap-3">
                      {result.options.map((option) => (
                        <div key={option.title} className="rounded-3xl bg-white/60 border border-white/70 p-4">
                          <h4 className="font-semibold text-dusk-500">{option.title}</h4>
                          <p className="text-sm text-dusk-400 mt-1">{option.fit}</p>
                          {/* UX inspection — "Confirmar por orçamento"
                              used to render as plain "Custo: Confirmar
                              por orçamento" string which read like
                              missing data. Style it as a muted neutral
                              chip when the model couldn't price the
                              option; only show full text when there's
                              a real number. */}
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-300">
                            {/^(confirmar por or[çc]amento|tbd|n\/a|—|to be|—)/i.test(option.estimated_cost_range) ? (
                              <span className="rounded-full bg-white/55 border border-white/70 px-3 py-1 text-dusk-300 italic">
                                {tr('Custo: pedir orçamento')}
                              </span>
                            ) : (
                              <span className="rounded-full bg-cream-50/80 px-3 py-1">{tr('Custo')}: {option.estimated_cost_range}</span>
                            )}
                            <span className="rounded-full bg-cream-50/80 px-3 py-1">{tr('Prazo')}: {option.timeline}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {hasVendorSearchPlan && (
                  <section id="agent-research-plan">
                    <h3 className="font-display text-xl text-dusk-500 mb-3">{tr('Plano de pesquisa')}</h3>
                    <div className="grid md:grid-cols-2 gap-3">
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
                  </section>
                )}

                {result.action_plan.length > 0 && (
                  <section>
                    <h3 className="font-display text-xl text-dusk-500 mb-3">{tr('Próximos passos manuais')}</h3>
                    <div className="space-y-3">
                      {result.action_plan.map((action, idx) => (
                        <div key={`${action.step}-${idx}`} className="rounded-3xl bg-white/60 border border-white/70 p-4 grid md:grid-cols-[1fr_150px_110px] gap-3">
                          <div>
                            <h4 className="font-semibold text-dusk-500">{action.step}</h4>
                            <p className="text-sm text-dusk-400 mt-1">{action.details}</p>
                          </div>
                          <div className="text-xs text-dusk-300"><span className="font-semibold text-dusk-400">{tr('Responsável')}:</span> {action.owner}</div>
                          <div className="text-xs text-dusk-300"><span className="font-semibold text-dusk-400">{tr('Quando')}:</span> {action.due}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {(hasResidentUpdate || canCreateProposal) && (
                  <section className="grid lg:grid-cols-2 gap-3">
                    {hasResidentUpdate && (
                      <div className="rounded-3xl bg-sage-100/45 border border-sage-200/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-display text-xl text-dusk-500">{tr('Comunicado aos moradores')}</h3>
                          <Button type="button" variant="ghost" size="sm" onClick={() => copyText(`${result.resident_update.title}\n\n${result.resident_update.body}`)} leftIcon={<Copy className="w-4 h-4" />}>
                            {tr('Copiar')}
                          </Button>
                        </div>
                        <h4 className="font-semibold text-dusk-500 mt-3">{result.resident_update.title}</h4>
                        <p className="text-sm text-dusk-400 mt-2 whitespace-pre-line">{result.resident_update.body}</p>
                      </div>
                    )}
                    {canCreateProposal ? (
                      <div className="rounded-3xl bg-peach-100/45 border border-peach-200/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-display text-xl text-dusk-500">{tr('Proposta pronta')}</h3>
                          <Button type="button" variant="primary" size="sm" loading={creatingProposal} onClick={createProposal} leftIcon={<Send className="w-4 h-4" />}>
                            {tr('Criar proposta')}
                          </Button>
                        </div>
                        <div className="mt-3 flex gap-2 flex-wrap">
                          <Badge tone="neutral">{tr(result.proposal_draft!.category)}</Badge>
                          {result.proposal_draft!.estimated_cost !== null ? <Badge tone="sage">{formatEstimatedCost(result.proposal_draft!.estimated_cost, locale)}</Badge> : null}
                        </div>
                        <h4 className="font-semibold text-dusk-500 mt-3">{result.proposal_draft!.title}</h4>
                        <p className="text-sm text-dusk-400 mt-2 whitespace-pre-line">{result.proposal_draft!.description}</p>
                      </div>
                    ) : null}
                  </section>
                )}

                {(result.risks.length > 0 || result.assumptions.length > 0) && (
                  <section className="grid lg:grid-cols-2 gap-3">
                    {result.risks.length > 0 && (
                      <div className="rounded-3xl bg-white/60 border border-white/70 p-4">
                        <h3 className="font-display text-xl text-dusk-500 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> {tr('Riscos')}</h3>
                        <MiniList items={result.risks} />
                      </div>
                    )}
                    {result.assumptions.length > 0 && (
                      <div className="rounded-3xl bg-white/60 border border-white/70 p-4">
                        <h3 className="font-display text-xl text-dusk-500 flex items-center gap-2"><ClipboardList className="w-5 h-5" /> {tr('Premissas')}</h3>
                        <MiniList items={result.assumptions} />
                      </div>
                    )}
                  </section>
                )}
              </GlassCard>
            </details>
          )}

          {hasTechnicalDiagnostics && (
            <details className="group">
              <summary className="cursor-pointer list-none flex items-center gap-2 rounded-3xl bg-white/40 border border-white/60 px-4 py-3 text-sm text-dusk-400 hover:bg-white/65 transition-colors">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>{tr('Diagnóstico técnico')}</span>
                <ChevronDown className="w-4 h-4 ml-auto shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <GlassCard className="mt-3 p-5 space-y-5">
                {aiUsage && (
                  <section>
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <Badge tone={aiUsage.ai_available === false ? 'warning' : 'sage'}>
                        {aiUsage.ai_available === false ? tr('IA indisponível') : tr('IA disponível')}
                      </Badge>
                      <span className="text-xs uppercase tracking-[0.18em] text-dusk-300">{tr('Uso dos últimos 7 dias')}</span>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-2">
                      <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-dusk-300">{tr('Chamadas')}</p>
                        <p className="font-display text-xl text-dusk-500 mt-1">{aiUsage.total_calls}</p>
                      </div>
                      <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-dusk-300">{tr('Tokens')}</p>
                        <p className="font-display text-xl text-dusk-500 mt-1">{formatCompactNumber(aiUsage.total_tokens, locale)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/70 bg-white/60 p-3">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-dusk-300">{tr('Custo est.')}</p>
                        <p className="font-display text-xl text-dusk-500 mt-1">{formatUsd(aiUsage.est_cost_usd, locale)}</p>
                      </div>
                    </div>
                    {aiUsage.ai_available === false && aiUsage.breaker_open_until && (
                      <p className="text-xs text-peach-700 mt-2">
                        {tr('Circuito de créditos aberto até')} {new Date(aiUsage.breaker_open_until).toLocaleString(locale)}
                      </p>
                    )}
                  </section>
                )}

                {debugView?.confidence && (
                  <section>
                    <h3 className="text-xs uppercase tracking-[0.16em] text-dusk-300 mb-2">{tr('Confiança técnica')}</h3>
                    <ConfidenceChip confidence={debugView.confidence} tr={tr} />
                  </section>
                )}
                {debugView?.agent_trace && debugView.agent_trace.length > 0 && (
                  <section>
                    <h3 className="text-xs uppercase tracking-[0.16em] text-dusk-300 mb-2">{tr('Como o agente pesquisou')}</h3>
                    <ol className="space-y-1.5 text-xs text-dusk-400">
                      {debugView.agent_trace.map((step, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="font-semibold text-sage-700 shrink-0">{idx + 1}.</span>
                          <div className="min-w-0">
                            <div className="font-medium text-dusk-500">{tr(step.tool)}</div>
                            {step.output_summary && <div className="text-dusk-300 mt-0.5">{step.output_summary}</div>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                {debugView?.evidence_sources && debugView.evidence_sources.length > 0 && (
                  <EvidenceSourcesSection sources={debugView.evidence_sources} tr={tr} />
                )}
                {debugView?.building_memory && <BuildingMemorySection memory={debugView.building_memory} locale={locale} tr={tr} />}
                {debugView?.attachment_analysis && debugView.attachment_analysis.length > 0 && (
                  <VisualEvidenceSection items={debugView.attachment_analysis} tr={tr} />
                )}
                {!debugView && result.diagnostics_available && (
                  <p className="text-xs text-dusk-300">{tr('Detalhes de auditoria disponíveis apenas quando o modo debug é solicitado pela API.')}</p>
                )}
              </GlassCard>
            </details>
          )}

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
