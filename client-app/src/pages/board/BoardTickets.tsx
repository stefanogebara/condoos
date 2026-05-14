// Incident Loop — admin dashboard.
// Lists every ticket in the condo, surfaces verification progress, and lets
// the admin manually fire the AI operations agent against a verified report.
// Phase 2 will auto-fire on threshold; Phase 1 keeps the human in the loop.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CalendarClock, CheckCircle2, Check, ClipboardCheck, Edit3, FileText, Image as ImageIcon, Loader2, Mail, MessageCircle, Phone, Send, ShieldAlert, ThumbsUp, Wrench, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { formatCurrency, formatDateTime, formatRelativeTime, t as translate, useLocale } from '../../lib/i18n';

type WorkOrderStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

interface Ticket {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: string;
  remediation_status: string;
  reporter_first: string | null;
  reporter_last: string | null;
  unit_number: string | null;
  reporter_unit_number: string | null;
  verification_threshold: number;
  verification_count: number;
  denial_count: number;
  verified_at: string | null;
  agent_run_at: string | null;
  // Surfaced by GET /api/tickets via SELECT t.* — the admin-inbox banner +
  // inline reason chip read this on the list response without needing to
  // load the full TicketDetail. nullable on every ticket not currently
  // in remediation_status='blocked_needs_admin'.
  blocked_reason: string | null;
  work_order_id: number | null;
  work_order_status: WorkOrderStatus | null;
  work_order_scheduled_for: string | null;
  work_order_estimated_amount_cents: number | null;
  work_order_vendor_name: string | null;
  created_at: string;
}

interface Dispatch {
  id: number;
  channel: 'whatsapp' | 'email' | 'manual';
  status: 'queued' | 'sent' | 'failed' | 'responded' | 'cancelled';
  message_body: string;
  created_at: string;
  responded_at: string | null;
  response_summary: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  vendor_category: string | null;
  outbox_status: string | null;
  outbox_sent_at: string | null;
  outbox_error: string | null;
  // Veto window — set when the agent auto-dispatched on a verified ticket.
  // Until this timestamp passes, the dispatch can be cancelled. After,
  // the worker picks it up.
  scheduled_send_after: string | null;
  cancellation_reason?: string | null;
}

interface ResponseTarget {
  ticketId: number;
  dispatchId: number;
  vendorName: string | null;
}

interface TicketDetail extends Ticket {
  description: string;
  agent_plan: AgentPlan | null;
  verifications: Array<{ id: number; vote: string; comment: string | null; first_name: string; last_name: string; unit_number: string | null }>;
  dispatches: Dispatch[];
  work_order: WorkOrder | null;
}

interface ServiceContact {
  id: number;
  category: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  emergency_available: number;
  preferred: number;
  service_scope: string | null;
  // Reputation — computed by the server from ticket_dispatches history.
  // Used in the picker to surface track record and to outrank silent vendors.
  dispatches_total?: number;
  dispatches_responded?: number;
  avg_response_seconds?: number | null;
}

interface AgentPlan {
  summary?: string;
  recommended_next_step?: string;
  existing_network_fit?: Array<{ company_name: string; category: string; reason: string; contact_method: string }>;
  options?: Array<{ title: string; fit: string; estimated_cost_range: string; timeline: string }>;
  vendor_search_plan?: { outreach_message?: string; search_queries?: string[] };
}

interface WorkOrder {
  id: number;
  ticket_id: number;
  service_contact_id: number | null;
  title: string;
  scope: string | null;
  status: WorkOrderStatus;
  estimated_amount_cents: number | null;
  approved_amount_cents: number | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  invoice_url: string | null;
  photo_url: string | null;
  completion_note: string | null;
  vendor_name: string | null;
  vendor_category: string | null;
  vendor_contact: string | null;
  created_at: string;
  updated_at: string;
}

type WorkOrderPayload = {
  service_contact_id?: number | null;
  title?: string;
  scope?: string | null;
  status?: WorkOrderStatus;
  estimated_amount_cents?: number | null;
  approved_amount_cents?: number | null;
  scheduled_for?: string | null;
  invoice_url?: string | null;
  photo_url?: string | null;
  completion_note?: string | null;
};

const PRIORITY_TONE: Record<Ticket['priority'], 'sage' | 'peach' | 'neutral' | 'dark'> = {
  low: 'neutral', normal: 'sage', high: 'peach', urgent: 'dark',
};

// Audit UX-H2 — dispatch enums + channel labels + priority labels render
// verbatim if not piped through the translator. PT-canonical strings here;
// matching tuples sit in i18n.tsx phrases so the runtime swaps per locale.
const DISPATCH_STATUS_LABEL: Record<string, string> = {
  queued:     'na fila',
  sent:       'enviado',
  failed:     'falhou',
  responded:  'respondeu',
  cancelled:  'cancelado',
};
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email:    'email',
  manual:   'manual',
};
const PRIORITY_PT_LABEL: Record<Ticket['priority'], string> = {
  low: 'baixa', normal: 'normal', high: 'alta', urgent: 'urgente',
};

const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  draft: 'rascunho',
  scheduled: 'agendada',
  in_progress: 'em execução',
  completed: 'concluída',
  cancelled: 'cancelada',
};

// UX-H-NEW-2 — historical drift: the ticket form uses `maintenance` while
// service_contacts seeds use `general_maintenance` (and similar variants for
// HVAC / safety / etc.). Without aliasing, the picker's same-category
// filter is empty and it falls through to the ★ preferred vendor, which is
// often the wrong specialty. The map is bidirectional — list each ticket
// category with the vendor categories that should match it.
const CATEGORY_ALIASES: Record<string, string[]> = {
  maintenance:    ['maintenance', 'general_maintenance'],
  hvac:           ['hvac', 'climatization'],
  plumbing:       ['plumbing'],
  electrical:     ['electrical'],
  elevator:       ['elevator'],
  security:       ['security', 'security_access'],
  amenity:        ['amenity', 'amenities'],
  cleaning:       ['cleaning'],
  fire_safety:    ['fire_safety', 'safety'],
  gas:            ['gas', 'gas_leak'],
  water:          ['water', 'water_damage'],
};

function categoryMatches(ticketCat: string, vendorCat: string): boolean {
  if (ticketCat === vendorCat) return true;
  const aliases = CATEGORY_ALIASES[ticketCat];
  return !!aliases && aliases.includes(vendorCat);
}

// Vendor category labels in PT (translated via i18n tuples). Replaces the
// raw enum render (`general_maintenance`) seen in the picker + dispatch
// history. Falls back to the raw value if not mapped.
const VENDOR_CATEGORY_LABEL: Record<string, string> = {
  general_maintenance: 'Manutenção geral',
  maintenance:         'Manutenção',
  electrical:          'Elétrica',
  plumbing:            'Hidráulica',
  hvac:                'Climatização',
  climatization:       'Climatização',
  elevator:            'Elevador',
  cleaning:            'Limpeza',
  security:            'Segurança',
  security_access:     'Segurança / acesso',
  amenity:             'Áreas comuns',
  amenities:           'Áreas comuns',
  fire_safety:         'Segurança contra incêndio',
  safety:              'Segurança',
  gas:                 'Gás',
  gas_leak:            'Gás (vazamento)',
  water:               'Hidráulica',
  water_damage:        'Hidráulica (vazamento)',
  landscaping:         'Jardinagem',
  internet_cctv:       'Internet / CCTV',
  pest_control:        'Controle de pragas',
  legal_admin:         'Administrativo / jurídico',
  other:               'Outros',
};

function vendorCategoryLabel(category: string): string {
  return VENDOR_CATEGORY_LABEL[category] || category;
}

const BLOCKED_REASON_LABEL: Record<string, string> = {
  no_vendor_in_category: 'Nenhum fornecedor cadastrado para essa categoria. Adicione um em Operação para a IA acionar.',
  vendor_no_response: 'O fornecedor acionado não respondeu dentro do prazo. Considere acionar outro ou contactar manualmente.',
  // Set by the vendor portal when the vendor opens the magic link and
  // explicitly declines. Distinct from vendor_no_response (silence) —
  // here we got a clear "no", so the admin should re-dispatch.
  vendor_declined: 'O fornecedor recusou o chamado pelo link. Acione outro fornecedor.',
  physical_action_required: 'O agente identificou que é necessária inspeção presencial antes do conserto.',
  ambiguous_reports: 'Os relatos da comunidade estão divididos. Verifique pessoalmente antes de acionar.',
  agent_failed: 'A IA falhou ao montar o plano automaticamente. Gere novamente ou resolva manualmente.',
};

function useTicketTranslator() {
  const { locale } = useLocale();
  return useCallback((key: string) => translate(key, locale), [locale]);
}

export default function BoardTickets() {
  const { locale } = useLocale();
  const tr = useCallback((key: string) => translate(key, locale), [locale]);
  const [rows, setRows] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [dispatchingId, setDispatchingId] = useState<number | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [pickerTicketId, setPickerTicketId] = useState<number | null>(null);
  const [resolveTicketId, setResolveTicketId] = useState<number | null>(null);
  const [workOrderTicketId, setWorkOrderTicketId] = useState<number | null>(null);
  const [responseTarget, setResponseTarget] = useState<ResponseTarget | null>(null);
  const [vendors, setVendors] = useState<ServiceContact[]>([]);
  const [workOrderSavingId, setWorkOrderSavingId] = useState<number | null>(null);
  const seenTicketIds = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (pickerTicketId == null && workOrderTicketId == null) return;
    apiGet<ServiceContact[]>('/service-contacts').then(setVendors).catch(() => setVendors([]));
  }, [pickerTicketId, workOrderTicketId]);

  const load = useCallback((notify = false) => {
    apiGet<Ticket[]>('/tickets').then((next) => {
      if (notify && seenTicketIds.current) {
        const fresh = next.filter((ticket) => !seenTicketIds.current!.has(ticket.id));
        if (fresh.length > 0) toast.success(tr('Novo problema recebido'));
      }
      seenTicketIds.current = new Set(next.map((ticket) => ticket.id));
      setRows(next);
    }).catch(() => {});
  }, [tr]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (openId == null) { setDetail(null); return; }
    apiGet<TicketDetail>(`/tickets/${openId}`).then(setDetail).catch(() => setDetail(null));
  }, [openId]);

  async function runAgent(id: number) {
    setRunningId(id);
    try {
      const result = await apiPost<{ id: number; plan: AgentPlan; fallback: boolean }>(
        `/tickets/${id}/run-agent`, { locale }
      );
      toast.success(tr(result.fallback ? 'Plano gerado (modo offline)' : 'Plano gerado pela IA'));
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao acionar agente'));
    } finally { setRunningId(null); }
  }

  async function verify(id: number) {
    setVerifyingId(id);
    try {
      await apiPost(`/tickets/${id}/verify`, { vote: 'confirm', locale });
      toast.success(tr('Verificado — IA será acionada em segundos'));
      // Poll once after a short delay so the agent_plan from the background
      // run shows up in the UI without a manual refresh.
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
      setTimeout(() => {
        if (id === openId) apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
        load();
      }, 6_000);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao verificar'));
    } finally { setVerifyingId(null); }
  }

  async function dispatch(id: number, opts?: { service_contact_id?: number; channel?: 'whatsapp' | 'email' | 'manual'; message?: string }) {
    setDispatchingId(id);
    try {
      const result = await apiPost<{ vendor: { id: number; company_name: string }; channel: string }>(
        `/tickets/${id}/dispatch`, opts || {}
      );
      toast.success(`${tr('Acionado:')} ${result.vendor.company_name} (${result.channel})`);
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
      setPickerTicketId(null);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === 'no_vendor_available') {
        toast.error(tr('Nenhum fornecedor disponível para essa categoria'));
      } else {
        toast.error(code || tr('Falha ao acionar fornecedor'));
      }
    } finally { setDispatchingId(null); }
  }

  async function resolve(id: number, resolution: string, announce: boolean) {
    setResolvingId(id);
    try {
      const result = await apiPost<{ id: number; announcement_id: number | null }>(
        `/tickets/${id}/resolve`, { resolution, announce }
      );
      toast.success(result.announcement_id ? tr('Resolvido — comunicado publicado') : tr('Resolvido'));
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
      setResolveTicketId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao resolver'));
    } finally { setResolvingId(null); }
  }

  function openVendorResponse(ticketId: number, dispatchRow: Dispatch) {
    setResponseTarget({
      ticketId,
      dispatchId: dispatchRow.id,
      vendorName: dispatchRow.vendor_name,
    });
  }

  async function submitVendorResponse(target: ResponseTarget, summary: string) {
    const cleanSummary = summary.trim();
    if (!cleanSummary) return;
    setRespondingId(target.dispatchId);
    try {
      await apiPost(`/tickets/${target.ticketId}/dispatches/${target.dispatchId}/responded`, { response_summary: cleanSummary });
      toast.success(tr('Resposta registrada'));
      apiGet<TicketDetail>(`/tickets/${target.ticketId}`).then(setDetail).catch(() => {});
      load();
      setResponseTarget(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao registrar resposta'));
    } finally {
      setRespondingId(null);
    }
  }

  async function saveWorkOrder(ticketId: number, payload: WorkOrderPayload) {
    setWorkOrderSavingId(ticketId);
    try {
      await apiPost<WorkOrder>(`/tickets/${ticketId}/work-order`, payload);
      toast.success(tr('Ordem de serviço salva'));
      apiGet<TicketDetail>(`/tickets/${ticketId}`).then(setDetail).catch(() => {});
      load();
      setWorkOrderTicketId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao salvar ordem de serviço'));
    } finally {
      setWorkOrderSavingId(null);
    }
  }

  const needsAttention = rows.filter((r) => r.verification_threshold > 0 && r.remediation_status === 'open');
  const verified = rows.filter((r) => r.remediation_status === 'verified' || r.remediation_status === 'agent_dispatched');
  const inProgress = rows.filter((r) => (
    r.remediation_status === 'awaiting_vendor'
    || r.remediation_status === 'vendor_engaged'
    || r.remediation_status === 'work_ordered'
    || r.remediation_status === 'work_in_progress'
  ));
  const escalated = rows.filter((r) => r.remediation_status === 'blocked_needs_admin');
  // Inbox sort — within the "Precisa do síndico" section, prioritise by
  // urgency (priority weight) then by oldest-first within each tier. Urgent
  // gas leaks shouldn't sit below stale low-priority items.
  const PRIORITY_WEIGHT: Record<Ticket['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const escalatedSorted = [...escalated].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority] ?? 2;
    const pb = PRIORITY_WEIGHT[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.created_at.localeCompare(b.created_at);
  });
  const blockedNoVendor = escalated.filter((r) => r.blocked_reason === 'no_vendor_in_category').length;
  const blockedNoResponse = escalated.filter((r) => r.blocked_reason === 'vendor_no_response').length;
  // UX-M7 — split "outros" into open-privates + resolved so closed tickets
  // don't visually compete with active private reports.
  const privateOpen = rows.filter((r) => r.verification_threshold === 0 && r.remediation_status === 'open');
  const resolvedTickets = rows.filter((r) => r.remediation_status === 'resolved');

  return (
    <>
      <PageHeader title={tr('Chamados')} subtitle={tr('Problemas reportados pelos moradores, verificações da comunidade, e plano de manutenção sugerido pela IA.')} />

      {escalated.length > 0 && (
        <NeedsAttentionBanner
          total={escalated.length}
          noVendor={blockedNoVendor}
          noResponse={blockedNoResponse}
        />
      )}

      {/* UX-H4 — most-actionable section first. M1 — section counts in headers. */}
      <Section title={tr('Precisa do síndico')} tickets={escalatedSorted} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={openVendorResponse}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} onOpenWorkOrder={setWorkOrderTicketId} />

      <Section title={tr('Aguardando verificação')} tickets={needsAttention} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={openVendorResponse}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} onOpenWorkOrder={setWorkOrderTicketId} />

      <Section title={tr('Verificados — pronto para acionar a IA')} tickets={verified} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={openVendorResponse}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} onOpenWorkOrder={setWorkOrderTicketId} />

      <Section title={tr('Em andamento — fornecedor acionado')} tickets={inProgress} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={openVendorResponse}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} onOpenWorkOrder={setWorkOrderTicketId} />

      <Section title={tr('Chamados privados')} tickets={privateOpen} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={openVendorResponse}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} onOpenWorkOrder={setWorkOrderTicketId} />

      <Section title={tr('Resolvidos')} tickets={resolvedTickets} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={openVendorResponse}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} onOpenWorkOrder={setWorkOrderTicketId} />

      {pickerTicketId != null && detail && (
        <VendorPickerModal
          ticket={detail}
          vendors={vendors}
          dispatching={dispatchingId === pickerTicketId}
          onClose={() => setPickerTicketId(null)}
          onSubmit={(opts) => dispatch(pickerTicketId, opts)} />
      )}

      {resolveTicketId != null && detail && (
        <ResolveModal
          ticket={detail}
          resolving={resolvingId === resolveTicketId}
          onClose={() => setResolveTicketId(null)}
          onSubmit={(resolution, announce) => resolve(resolveTicketId, resolution, announce)} />
      )}

      {workOrderTicketId != null && detail && detail.id === workOrderTicketId && (
        <WorkOrderModal
          ticket={detail}
          vendors={vendors}
          saving={workOrderSavingId === workOrderTicketId}
          onClose={() => setWorkOrderTicketId(null)}
          onSubmit={(payload) => saveWorkOrder(workOrderTicketId, payload)} />
      )}

      {responseTarget && (
        <VendorResponseModal
          vendorName={responseTarget.vendorName}
          responding={respondingId === responseTarget.dispatchId}
          onClose={() => setResponseTarget(null)}
          onSubmit={(summary) => submitVendorResponse(responseTarget, summary)} />
      )}

      {rows.length === 0 && (
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">{tr('Nenhum chamado aberto')}</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            {tr('Quando um morador reportar um problema, ele aparece aqui com a verificação dos vizinhos e um plano da IA.')}
          </p>
        </GlassCard>
      )}
    </>
  );
}

// Inbox banner — page-top affordance that pulls focus when the admin has
// real work waiting. Only renders when escalated.length > 0; otherwise the
// page stays clean. Breakdown chips give the admin a 1-second read on what
// kind of unblock each ticket needs: add a vendor vs chase the silent one.
function NeedsAttentionBanner({ total, noVendor, noResponse }: { total: number; noVendor: number; noResponse: number }) {
  const tr = useTicketTranslator();
  return (
    <GlassCard variant="clay" className="p-4 mb-4 border border-peach-300/60 bg-peach-100/40 animate-fade-up">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-peach-200/70 p-2 flex-shrink-0">
          <ShieldAlert className="w-4 h-4 text-peach-700" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-dusk-500">
            {total === 1
              ? tr('1 chamado esperando você')
              : `${total} ${tr('chamados esperando você')}`}
          </div>
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            {noVendor > 0 && (
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-dusk-400">
                <span className="font-semibold text-dusk-500">{noVendor}</span>{' '}
                {noVendor === 1 ? tr('sem fornecedor') : tr('sem fornecedor (n)')}
              </span>
            )}
            {noResponse > 0 && (
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-dusk-400">
                <span className="font-semibold text-dusk-500">{noResponse}</span>{' '}
                {noResponse === 1 ? tr('sem resposta do fornecedor') : tr('sem resposta do fornecedor (n)')}
              </span>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function Section({
  title, tickets, openId, setOpenId, detail, runningId, verifyingId, dispatchingId,
  onRunAgent, onVerify, onDispatch, onMarkResponded, onOpenPicker, onOpenResolve, onOpenWorkOrder,
}: {
  title: string;
  tickets: Ticket[];
  openId: number | null;
  setOpenId: (id: number | null) => void;
  detail: TicketDetail | null;
  runningId: number | null;
  verifyingId: number | null;
  dispatchingId: number | null;
  onRunAgent: (id: number) => void;
  onVerify: (id: number) => void;
  onDispatch: (id: number, opts?: { service_contact_id?: number; channel?: 'whatsapp' | 'email' | 'manual'; message?: string }) => void;
  onMarkResponded: (ticketId: number, dispatchRow: Dispatch) => void;
  onOpenPicker: (id: number) => void;
  onOpenResolve: (id: number) => void;
  onOpenWorkOrder: (id: number) => void;
}) {
  if (tickets.length === 0) return null;
  return (
    <>
      {/* UX-M1 — surface count in header so admin can scan workloads. */}
      <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3 flex items-baseline gap-2">
        <span>{title}</span>
        <span className="text-sm font-normal text-dusk-200">({tickets.length})</span>
      </h2>
      <div className="space-y-3">
        {tickets.map((tk) => (
          <AdminCard key={tk.id} ticket={tk}
                     expanded={openId === tk.id}
                     detail={openId === tk.id ? detail : null}
                     onToggle={() => setOpenId(openId === tk.id ? null : tk.id)}
                     running={runningId === tk.id}
                     verifying={verifyingId === tk.id}
                     dispatching={dispatchingId === tk.id}
                     onRunAgent={() => onRunAgent(tk.id)}
                     onVerify={() => onVerify(tk.id)}
                     onDispatch={(opts) => onDispatch(tk.id, opts)}
                     onMarkResponded={(dispatchRow) => onMarkResponded(tk.id, dispatchRow)}
                     onOpenPicker={() => onOpenPicker(tk.id)}
                     onOpenResolve={() => onOpenResolve(tk.id)}
                     onOpenWorkOrder={() => onOpenWorkOrder(tk.id)} />
        ))}
      </div>
    </>
  );
}

function AdminCard({
  ticket, expanded, detail, onToggle, running, verifying, dispatching,
  onRunAgent, onVerify, onDispatch, onMarkResponded, onOpenPicker, onOpenResolve, onOpenWorkOrder,
}: {
  ticket: Ticket;
  expanded: boolean;
  detail: TicketDetail | null;
  onToggle: () => void;
  running: boolean;
  verifying: boolean;
  dispatching: boolean;
  onRunAgent: () => void;
  onVerify: () => void;
  onDispatch: (opts?: { service_contact_id?: number; channel?: 'whatsapp' | 'email' | 'manual'; message?: string }) => void;
  onMarkResponded: (dispatchRow: Dispatch) => void;
  onOpenPicker: () => void;
  onOpenResolve: () => void;
  onOpenWorkOrder: () => void;
}) {
  const tr = useTicketTranslator();
  const isCommunity = ticket.verification_threshold > 0;
  const isVerified = !!ticket.verified_at;
  const hasPlan = !!ticket.agent_run_at;
  const isBlocked = ticket.remediation_status === 'blocked_needs_admin';
  const isAwaitingVendor = ticket.remediation_status === 'awaiting_vendor';
  const vendorEngaged = ticket.remediation_status === 'vendor_engaged';
  const hasWorkOrder = !!ticket.work_order_id || !!detail?.work_order;
  const workOrderStatus = detail?.work_order?.status || ticket.work_order_status;
  // UX-H-NEW-1 — `hasPlan` stays true after resolve (the agent_plan column
  // never gets cleared), so the action buttons used to keep rendering on
  // closed tickets and no `resolvido` badge ever appeared. Treat resolved as
  // a hard terminal state — no dispatch / re-plan actions, dedicated badge.
  const isResolved = ticket.remediation_status === 'resolved';
  const progress = Math.min(100, Math.round((ticket.verification_count / Math.max(1, ticket.verification_threshold)) * 100));

  return (
    <GlassCard variant="clay" className="p-5">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-lg text-dusk-500">{ticket.title}</span>
              <Badge tone={PRIORITY_TONE[ticket.priority]}>{tr(PRIORITY_PT_LABEL[ticket.priority])}</Badge>
              {isCommunity && <Badge tone="neutral">{tr('comunidade')}</Badge>}
              {isVerified && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> {tr('verificado')}</Badge>}
              {hasPlan && <Badge tone="peach"><Bot className="w-3 h-3" /> {tr('plano da IA')}</Badge>}
              {isAwaitingVendor && <Badge tone="peach"><Send className="w-3 h-3" /> {tr('aguardando fornecedor')}</Badge>}
              {vendorEngaged && <Badge tone="sage"><MessageCircle className="w-3 h-3" /> {tr('fornecedor respondeu')}</Badge>}
              {workOrderStatus && (
                <Badge tone={workOrderStatus === 'completed' ? 'sage' : workOrderStatus === 'cancelled' ? 'dark' : 'peach'}>
                  <ClipboardCheck className="w-3 h-3" /> {tr(WORK_ORDER_STATUS_LABEL[workOrderStatus])}
                </Badge>
              )}
              {isBlocked && <Badge tone="dark"><ShieldAlert className="w-3 h-3" /> {tr('precisa do síndico')}</Badge>}
              {/* Inline reason chip — admin gets the "why blocked" before
                  expanding. The full label is rendered in the expanded
                  banner; here we keep it terse so the badge row stays
                  scannable. */}
              {isBlocked && ticket.blocked_reason === 'no_vendor_in_category' && (
                <Badge tone="peach">{tr('sem fornecedor')}</Badge>
              )}
              {isBlocked && ticket.blocked_reason === 'vendor_no_response' && (
                <Badge tone="peach">{tr('sem resposta do fornecedor')}</Badge>
              )}
              {isBlocked && ticket.blocked_reason === 'vendor_declined' && (
                <Badge tone="peach">{tr('fornecedor recusou')}</Badge>
              )}
              {isResolved && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> {tr('resolvido')}</Badge>}
            </div>
            <div className="text-xs text-dusk-300 mt-1">
              {[
                `${ticket.reporter_first || ''} ${ticket.reporter_last || ''}`.trim(),
                ticket.reporter_unit_number || ticket.unit_number || null,
                formatRelativeTime(ticket.created_at),
              ].filter(Boolean).join(' · ')}
            </div>
            {isCommunity && (
              <>
                <div className="mt-2 text-xs flex items-center gap-2">
                  <span className="text-sage-700 font-semibold">{ticket.verification_count}</span>
                  <span className="text-dusk-200">{tr('de')}</span>
                  <span className="text-dusk-400">{ticket.verification_threshold}</span>
                  <span className="text-dusk-200">·</span>
                  <span className="text-peach-500 font-semibold">{ticket.denial_count}</span>
                  <span className="text-dusk-200">{tr('negaram')}</span>
                </div>
                {/* UX-M8 — faint striped track at 0/threshold so the bar
                    reads as "awaiting votes" instead of "missing UI". */}
                <div className="mt-1.5 h-1.5 rounded-full bg-white/40 overflow-hidden">
                  {ticket.verification_count === 0 ? (
                    <div className="h-full" style={{
                      backgroundImage: 'repeating-linear-gradient(135deg, rgba(102,80,74,0.18) 0 4px, transparent 4px 8px)',
                    }} />
                  ) : (
                    <div className={`h-full ${isVerified ? 'bg-sage-500' : 'bg-sage-400'}`} style={{ width: `${progress}%` }} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/50 space-y-3">
          <p className="text-sm text-dusk-400 whitespace-pre-line">{ticket.description}</p>

          {isBlocked && detail?.blocked_reason && (
            <GlassCard variant="clay" className="p-3 border border-peach-300/50 bg-peach-100/40">
              <div className="text-xs uppercase tracking-wider text-peach-700 mb-1 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> {tr('Atenção do síndico')}
              </div>
              <p className="text-sm text-dusk-500">
                {tr(BLOCKED_REASON_LABEL[detail.blocked_reason] || detail.blocked_reason)}
              </p>
            </GlassCard>
          )}

          {/* UX-H-NEW-1 — hide all action buttons on resolved tickets. The
              card stays expandable so the admin can review the dispatch
              history + plan, but the actions belong to live tickets only. */}
          {!isResolved && (
            <div className="flex gap-2 flex-wrap">
              {!isVerified && (
                <Button size="sm" variant="ghost"
                        leftIcon={verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                        onClick={onVerify} disabled={verifying}>
                  {tr('Verificar como síndico')}
                </Button>
              )}
              <Button size="sm" variant={hasPlan ? 'ghost' : 'primary'}
                      leftIcon={running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                      onClick={onRunAgent} disabled={running}>
                {hasPlan ? tr('Refazer plano IA') : tr('Gerar plano IA')}
              </Button>
              {hasPlan && !isBlocked && (
                <>
                  <Button size="sm" variant="primary"
                          leftIcon={dispatching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          onClick={() => onDispatch()} disabled={dispatching}>
                    {tr('Acionar (auto)')}
                  </Button>
                  <Button size="sm" variant="ghost"
                          leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                          onClick={onOpenPicker} disabled={dispatching}>
                    {tr('Escolher fornecedor')}
                  </Button>
                </>
              )}
              {(hasPlan || isAwaitingVendor || vendorEngaged || hasWorkOrder || isBlocked) && (
                <Button size="sm" variant={hasWorkOrder ? 'ghost' : 'primary'}
                        leftIcon={<ClipboardCheck className="w-3.5 h-3.5" />}
                        onClick={onOpenWorkOrder}>
                  {hasWorkOrder ? tr('Atualizar ordem') : tr('Criar ordem de serviço')}
                </Button>
              )}
              {(ticket.remediation_status === 'awaiting_vendor'
                || ticket.remediation_status === 'vendor_engaged'
                || ticket.remediation_status === 'work_ordered'
                || ticket.remediation_status === 'work_in_progress'
                || ticket.remediation_status === 'agent_dispatched'
                || ticket.remediation_status === 'blocked_needs_admin') && (
                <Button size="sm" variant="ghost"
                        leftIcon={<Check className="w-3.5 h-3.5" />}
                        onClick={onOpenResolve}>
                  {tr('Marcar resolvido')}
                </Button>
              )}
            </div>
          )}

          {detail?.agent_plan && (
            <GlassCard variant="clay-sage" className="p-4">
              <div className="text-xs uppercase tracking-wider text-sage-900 mb-2 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" /> {tr('Plano sugerido')}
              </div>
              {detail.agent_plan.summary && (
                <p className="text-sm text-dusk-500 mb-2">{detail.agent_plan.summary}</p>
              )}
              {detail.agent_plan.recommended_next_step && (
                <p className="text-xs text-dusk-400 mb-3">
                  <strong className="text-dusk-500">{tr('Próximo passo:')}</strong> {detail.agent_plan.recommended_next_step}
                </p>
              )}
              {detail.agent_plan.existing_network_fit && detail.agent_plan.existing_network_fit.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">{tr('Da rede já cadastrada')}</div>
                  <ul className="space-y-1">
                    {detail.agent_plan.existing_network_fit.slice(0, 3).map((fit, i) => (
                      <li key={i} className="text-xs text-dusk-400">
                        <strong className="text-dusk-500">{fit.company_name}</strong> ({tr(vendorCategoryLabel(fit.category))}) — {fit.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.agent_plan.options && detail.agent_plan.options.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">{tr('Opções avaliadas')}</div>
                  <ul className="space-y-1.5">
                    {detail.agent_plan.options.slice(0, 3).map((opt, i) => (
                      <li key={i} className="text-xs text-dusk-400">
                        <strong className="text-dusk-500">{opt.title}</strong>
                        <span className="block text-dusk-300">{opt.fit} · {opt.estimated_cost_range} · {opt.timeline}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.agent_plan.vendor_search_plan?.outreach_message && (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">{tr('Mensagem de contato')}</div>
                  <pre className="text-xs text-dusk-400 whitespace-pre-wrap font-sans bg-white/40 rounded-xl p-2 border border-white/60">
                    {detail.agent_plan.vendor_search_plan.outreach_message}
                  </pre>
                </div>
              )}
            </GlassCard>
          )}

          {detail?.work_order && (
            <WorkOrderPanel workOrder={detail.work_order} />
          )}

          {detail?.dispatches && detail.dispatches.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-dusk-200 mb-2">{tr('Histórico de acionamentos')}</div>
              <ul className="space-y-2">
                {detail.dispatches.map((d) => (
                  <li key={d.id} className="rounded-2xl border border-white/60 bg-white/45 p-3 text-xs text-dusk-400">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-dusk-500">{d.vendor_name || '—'}</span>
                      {d.vendor_category && <Badge tone="neutral">{tr(vendorCategoryLabel(d.vendor_category))}</Badge>}
                      <Badge tone={d.status === 'responded' ? 'sage' : d.status === 'failed' ? 'dark' : 'peach'}>
                        {d.channel === 'whatsapp' && <MessageCircle className="w-3 h-3" />}
                        {d.channel === 'email' && <Mail className="w-3 h-3" />}
                        {d.channel === 'manual' && <Phone className="w-3 h-3" />}
                        {' '}
                        {tr(CHANNEL_LABEL[d.channel] || d.channel)} · {tr(DISPATCH_STATUS_LABEL[d.status] || d.status)}
                      </Badge>
                      {d.outbox_status && d.outbox_status !== d.status && (
                        <span className="text-[10px] text-dusk-300">{tr('entrega:')} {tr(DISPATCH_STATUS_LABEL[d.outbox_status] || d.outbox_status)}</span>
                      )}
                      <span className="text-dusk-300 ml-auto">{formatDateTime(d.created_at)}</span>
                    </div>
                    <div className="mt-1 text-dusk-300 whitespace-pre-line">{d.message_body}</div>
                    {d.response_summary && (
                      <div className="mt-2 pt-2 border-t border-white/50 text-dusk-400">
                        <strong className="text-dusk-500">{tr('Resposta:')}</strong> {d.response_summary}
                      </div>
                    )}
                    {/* Veto window: when the dispatch is scheduled and
                        send_after is still in the future, show the
                        countdown + cancel. Cancellable only during this
                        window. */}
                    {d.status === 'queued' && d.scheduled_send_after && (
                      <ScheduledDispatchVeto
                        dispatch={d}
                        ticketId={ticket.id}
                        tr={tr}
                      />
                    )}
                    {d.status === 'queued' || d.status === 'sent' ? (
                      <div className="mt-2">
                        <Button size="sm" variant="ghost"
                                leftIcon={<MessageCircle className="w-3 h-3" />}
                                onClick={() => onMarkResponded(d)}>
                          {tr('Registrar resposta')}
                        </Button>
                      </div>
                    ) : null}
                    {d.status === 'cancelled' && d.cancellation_reason && (
                      <div className="mt-2 text-[11px] text-dusk-300 italic">
                        {tr('Cancelado:')} {tr(d.cancellation_reason)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

function amountInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const value = cents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function amountToCents(value: string): number | null {
  const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function toDateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 16).replace(' ', 'T');
}

function fromDateTimeInput(value: string): string | null {
  return value ? value.replace('T', ' ') : null;
}

function WorkOrderPanel({ workOrder }: { workOrder: WorkOrder }) {
  const tr = useTicketTranslator();
  const amount = workOrder.approved_amount_cents ?? workOrder.estimated_amount_cents;
  return (
    <GlassCard variant="clay" className="p-4 border border-sage-300/40 bg-sage-100/35">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-sage-900 mb-1 flex items-center gap-1.5">
            <ClipboardCheck className="w-3.5 h-3.5" /> {tr('Ordem de serviço')}
          </div>
          <div className="font-semibold text-dusk-500">{workOrder.title}</div>
          <div className="flex flex-wrap gap-2 mt-2 text-xs text-dusk-300">
            <Badge tone={workOrder.status === 'completed' ? 'sage' : workOrder.status === 'cancelled' ? 'dark' : 'peach'}>
              {tr(WORK_ORDER_STATUS_LABEL[workOrder.status])}
            </Badge>
            {workOrder.vendor_name && <span>{workOrder.vendor_name}</span>}
            {workOrder.scheduled_for && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" /> {formatDateTime(workOrder.scheduled_for)}
              </span>
            )}
            {amount != null && <span>{formatCurrency(amount / 100)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {workOrder.invoice_url && (
            <a href={workOrder.invoice_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 rounded-2xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-medium text-dusk-400 hover:bg-white/80">
              <FileText className="w-3.5 h-3.5" /> {tr('Nota fiscal')}
            </a>
          )}
          {workOrder.photo_url && (
            <a href={workOrder.photo_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 rounded-2xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-medium text-dusk-400 hover:bg-white/80">
              <ImageIcon className="w-3.5 h-3.5" /> {tr('Foto')}
            </a>
          )}
        </div>
      </div>
      {workOrder.scope && <p className="text-sm text-dusk-400 mt-3 whitespace-pre-line">{workOrder.scope}</p>}
      {workOrder.completion_note && (
        <div className="mt-3 pt-3 border-t border-white/50 text-sm text-dusk-400">
          <strong className="text-dusk-500">{tr('Conclusão:')}</strong> {workOrder.completion_note}
        </div>
      )}
    </GlassCard>
  );
}

function WorkOrderModal({
  ticket, vendors, saving, onClose, onSubmit,
}: {
  ticket: TicketDetail;
  vendors: ServiceContact[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: WorkOrderPayload) => void;
}) {
  useEscape(onClose);
  const tr = useTicketTranslator();
  const workOrder = ticket.work_order;
  const suggestedVendor = workOrder?.service_contact_id
    || vendors.find((v) => categoryMatches(ticket.category, v.category))?.id
    || vendors.find((v) => v.preferred === 1)?.id
    || null;
  const [vendorId, setVendorId] = useState<string>(suggestedVendor ? String(suggestedVendor) : '');
  const [title, setTitle] = useState(workOrder?.title || tr('Ordem de serviço: {title}').replace('{title}', ticket.title));
  const [scope, setScope] = useState(workOrder?.scope || ticket.description || '');
  const [status, setStatus] = useState<WorkOrderStatus>(workOrder?.status || 'scheduled');
  const [scheduledFor, setScheduledFor] = useState(toDateTimeInput(workOrder?.scheduled_for));
  const [estimated, setEstimated] = useState(amountInput(workOrder?.estimated_amount_cents));
  const [approved, setApproved] = useState(amountInput(workOrder?.approved_amount_cents));
  const [invoiceUrl, setInvoiceUrl] = useState(workOrder?.invoice_url || '');
  const [photoUrl, setPhotoUrl] = useState(workOrder?.photo_url || '');
  const [completionNote, setCompletionNote] = useState(workOrder?.completion_note || '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      service_contact_id: vendorId ? Number(vendorId) : null,
      title: title.trim(),
      scope: scope.trim() || null,
      status,
      estimated_amount_cents: amountToCents(estimated),
      approved_amount_cents: amountToCents(approved),
      scheduled_for: fromDateTimeInput(scheduledFor),
      invoice_url: invoiceUrl.trim() || null,
      photo_url: photoUrl.trim() || null,
      completion_note: completionNote.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dusk-500/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display text-xl text-dusk-500">{tr('Ordem de serviço')}</h3>
            <p className="text-xs text-dusk-300 mt-1">{ticket.title}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/50 hover:bg-white/80 flex items-center justify-center text-dusk-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('Status')}
              <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}>
                {(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'] as WorkOrderStatus[]).map((s) => (
                  <option key={s} value={s}>{tr(WORK_ORDER_STATUS_LABEL[s])}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('Fornecedor')}
              <select className="input mt-1" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">{tr('Sem fornecedor vinculado')}</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.company_name} ({tr(vendorCategoryLabel(v.category))})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Título da ordem')}
            <input className="input mt-1" value={title} maxLength={160}
                   onChange={(e) => setTitle(e.target.value)} required />
          </label>

          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Escopo do trabalho')}
            <textarea className="input mt-1 min-h-[110px]" value={scope} maxLength={4000}
                      onChange={(e) => setScope(e.target.value)} />
          </label>

          <div className="grid md:grid-cols-3 gap-3">
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('Agendado para')}
              <input className="input mt-1" type="datetime-local" value={scheduledFor}
                     onChange={(e) => setScheduledFor(e.target.value)} />
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('Estimativa')}
              <input className="input mt-1" inputMode="decimal" value={estimated}
                     placeholder="1200"
                     onChange={(e) => setEstimated(e.target.value)} />
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('Valor aprovado')}
              <input className="input mt-1" inputMode="decimal" value={approved}
                     placeholder="1200"
                     onChange={(e) => setApproved(e.target.value)} />
            </label>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('URL da nota fiscal')}
              <input className="input mt-1" type="url" value={invoiceUrl}
                     placeholder="https://..."
                     onChange={(e) => setInvoiceUrl(e.target.value)} />
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {tr('URL da foto')}
              <input className="input mt-1" type="url" value={photoUrl}
                     placeholder="https://..."
                     onChange={(e) => setPhotoUrl(e.target.value)} />
            </label>
          </div>

          <label className="block text-xs text-dusk-300 font-medium">
            {tr('Nota de conclusão')}
            <textarea className="input mt-1 min-h-[90px]" value={completionNote} maxLength={2000}
                      placeholder={tr('Ex: Reparo concluído, testado com o zelador e funcionando normalmente.')}
                      onChange={(e) => setCompletionNote(e.target.value)} />
          </label>

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>{tr('Cancelar')}</Button>
            <Button type="submit" variant="primary" loading={saving}
                    disabled={!title.trim()}
                    leftIcon={<ClipboardCheck className="w-4 h-4" />}>
              {tr('Salvar ordem')}
            </Button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}

function VendorPickerModal({
  ticket, vendors, dispatching, onClose, onSubmit,
}: {
  ticket: TicketDetail;
  vendors: ServiceContact[];
  dispatching: boolean;
  onClose: () => void;
  onSubmit: (opts: { service_contact_id?: number; channel?: 'whatsapp' | 'email' | 'manual'; message?: string }) => void;
}) {
  useEscape(onClose);
  const tr = useTicketTranslator();
  const networkFit = ticket.agent_plan?.existing_network_fit || [];
  const preferred = networkFit[0]?.company_name;
  // UX-H-NEW-2 — categoryMatches handles the maintenance ↔ general_maintenance
  // alias (and other historical drift between ticket and vendor enums) so a
  // `maintenance` ticket actually finds a `general_maintenance` vendor here
  // instead of falling through to a wrong-specialty ★ preferred.
  const sameCategory = vendors.filter((v) => categoryMatches(ticket.category, v.category));
  const otherCategory = vendors.filter((v) => !categoryMatches(ticket.category, v.category));
  // Within same-category, rank by reputation: vendors that responded to
  // past dispatches outrank silent ones. response_rate breaks ties; recent
  // activity (last_used_at) breaks deeper ties via the server's ORDER BY.
  function reputationScore(v: ServiceContact): number {
    const total = v.dispatches_total || 0;
    if (total === 0) return 0;
    const responded = v.dispatches_responded || 0;
    // Wilson-style smoothing — vendors with 1/1 don't beat vendors with 10/11.
    return (responded + 1) / (total + 2);
  }
  const sameCategorySorted = [...sameCategory].sort((a, b) => {
    const diff = reputationScore(b) - reputationScore(a);
    if (Math.abs(diff) > 0.001) return diff;
    if ((b.preferred || 0) !== (a.preferred || 0)) return (b.preferred || 0) - (a.preferred || 0);
    return 0;
  });
  const sorted = [...sameCategorySorted, ...otherCategory];

  // Pre-select priority: exact name match against the AI's top suggestion >
  // top same-category by reputation > any preferred vendor > first row.
  const initialVendor = sorted.find((v) => v.company_name === preferred)
    || sameCategorySorted[0]
    || sorted.find((v) => v.preferred === 1)
    || sorted[0];

  const [vendorId, setVendorId] = useState<number | null>(initialVendor?.id ?? null);
  const [channel, setChannel] = useState<'whatsapp' | 'email' | 'manual'>(
    initialVendor?.whatsapp ? 'whatsapp' : initialVendor?.email ? 'email' : 'manual',
  );
  const [message, setMessage] = useState<string>(
    ticket.agent_plan?.vendor_search_plan?.outreach_message
      || tr('Olá, somos do condomínio. Precisamos de ajuda com: {title}. Pode nos atender?').replace('{title}', ticket.title),
  );

  useEffect(() => {
    const v = sorted.find((x) => x.id === vendorId);
    if (!v) return;
    if (v.whatsapp) setChannel('whatsapp');
    else if (v.email) setChannel('email');
    else setChannel('manual');
  }, [vendorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = sorted.find((x) => x.id === vendorId) || null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dusk-500/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display text-xl text-dusk-500">{tr('Acionar fornecedor')}</h3>
            <p className="text-xs text-dusk-300 mt-1">{ticket.title}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/50 hover:bg-white/80 flex items-center justify-center text-dusk-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block text-xs text-dusk-300 font-medium mb-3">
          <div className="flex items-center justify-between">
            <span>{tr('Fornecedor')}</span>
            {/* UX-M3 — admin used to have to close the modal + navigate to
                /board/services + add + come back. A direct link keeps the
                workflow in one tab; target=_blank so the modal context
                survives. */}
            <a href="/board/services" target="_blank" rel="noopener noreferrer"
               className="text-[11px] font-normal text-sage-700 hover:text-sage-900 underline decoration-dotted underline-offset-4">
              + {tr('Adicionar novo fornecedor')}
            </a>
          </div>
          <select className="input mt-1" value={vendorId ?? ''} onChange={(e) => setVendorId(Number(e.target.value))}>
            {sorted.length === 0 && <option value="">{tr('Nenhum cadastrado')}</option>}
            {sorted.map((vv) => {
              const noChannel = !vv.whatsapp && !vv.email;
              // Reputation suffix — only render when the vendor has been
              // dispatched at least once, so brand-new vendors aren't
              // labeled "0/0 respondidos". avg_response_seconds → hours
              // is the most-useful unit for vendor SLA at this scale.
              const total = vv.dispatches_total || 0;
              const responded = vv.dispatches_responded || 0;
              const avgSec = vv.avg_response_seconds || null;
              const repPart = total > 0
                ? ` · ${responded}/${total} ${tr('respondidos')}${avgSec ? ` · ~${Math.max(1, Math.round(avgSec / 3600))}h` : ''}`
                : '';
              return (
                <option key={vv.id} value={vv.id}>
                  {vv.preferred === 1 ? '★ ' : ''}{vv.company_name} ({tr(vendorCategoryLabel(vv.category))})
                  {vv.emergency_available === 1 ? ' · 24h' : ''}
                  {noChannel ? ` · ${tr('somente telefone')}` : ''}
                  {repPart}
                </option>
              );
            })}
          </select>
        </label>

        {v && (
          <div className="text-xs text-dusk-300 mb-3 bg-white/45 border border-white/60 rounded-2xl p-3 space-y-0.5">
            {v.contact_name && <div><strong className="text-dusk-500">{v.contact_name}</strong></div>}
            {v.phone && <div>📞 {v.phone}</div>}
            {v.whatsapp && <div>💬 {v.whatsapp}</div>}
            {v.email && <div>✉️ {v.email}</div>}
            {v.service_scope && <div className="text-dusk-400 mt-1">{v.service_scope}</div>}
          </div>
        )}

        <fieldset className="mb-3">
          <legend className="text-xs text-dusk-300 font-medium mb-2">{tr('Canal')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['whatsapp', 'email', 'manual'] as const).map((ch) => {
              const available = ch === 'whatsapp' ? !!v?.whatsapp : ch === 'email' ? !!v?.email : true;
              return (
                <label key={ch} className={`px-3 py-2 rounded-2xl border text-xs cursor-pointer ${
                  channel === ch ? 'bg-sage-200/80 border-sage-300 text-sage-900' : 'bg-white/50 border-white/70 text-dusk-400'
                } ${!available && ch !== 'manual' ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input type="radio" className="hidden" checked={channel === ch}
                         disabled={!available && ch !== 'manual'}
                         onChange={() => setChannel(ch)} />
                  {ch === 'whatsapp' && <><MessageCircle className="inline w-3 h-3 mr-1" />WhatsApp</>}
                  {ch === 'email' && <><Mail className="inline w-3 h-3 mr-1" />Email</>}
                  {ch === 'manual' && <><Phone className="inline w-3 h-3 mr-1" />{tr('Manual (telefone)')}</>}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="block text-xs text-dusk-300 font-medium mb-3">
          {tr('Mensagem')}
          <textarea className="input mt-1 min-h-[140px]" value={message}
                    onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
        </label>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>{tr('Cancelar')}</Button>
          <Button variant="primary" loading={dispatching}
                  disabled={!vendorId || !message.trim()}
                  leftIcon={<Send className="w-4 h-4" />}
                  onClick={() => onSubmit({ service_contact_id: vendorId ?? undefined, channel, message })}>
            {tr('Enviar')}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}

// UX-M4 — Escape closes any modal. Bind once on mount.
function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// Veto window UI for auto-dispatched scheduled sends. Live countdown so
// the admin sees exactly how much time they have, big cancel button that
// hits the cancel endpoint. After the window elapses (or the worker fires
// first), the row falls back to the normal "sent" rendering.
function ScheduledDispatchVeto({ dispatch, ticketId, tr }: {
  dispatch: Dispatch;
  ticketId: number;
  tr: (k: string) => string;
}) {
  const [now, setNow] = useState<number>(Date.now());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // scheduled_send_after is stored as 'YYYY-MM-DD HH:MM:SS' in UTC (SQLite
  // CURRENT_TIMESTAMP convention). Parse with the Z suffix so JS treats
  // it as UTC, not local time.
  const sendAfterMs = Date.parse((dispatch.scheduled_send_after || '').replace(' ', 'T') + 'Z');
  const remainingSec = Math.max(0, Math.floor((sendAfterMs - now) / 1000));
  if (!Number.isFinite(sendAfterMs) || remainingSec === 0) return null;

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await apiPost(`/tickets/${ticketId}/dispatches/${dispatch.id}/cancel`, {});
      toast.success(tr('Envio cancelado'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao cancelar'));
    } finally {
      setCancelling(false);
    }
  }

  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  return (
    <div className="mt-2 rounded-2xl bg-peach-100/50 border border-peach-300/50 p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-dusk-500">
          <span className="font-semibold">{tr('Envio agendado pela IA em')}{' '}
            <span className="tabular-nums">{minutes}:{String(seconds).padStart(2, '0')}</span>
          </span>
          <span className="text-dusk-300 ml-2">{tr('— você pode cancelar antes.')}</span>
        </div>
        <Button size="sm" variant="ghost" disabled={cancelling} onClick={cancel}
                leftIcon={<X className="w-3 h-3" />}>
          {cancelling ? tr('Cancelando…') : tr('Cancelar envio')}
        </Button>
      </div>
    </div>
  );
}

function VendorResponseModal({
  vendorName, responding, onClose, onSubmit,
}: {
  vendorName: string | null;
  responding: boolean;
  onClose: () => void;
  onSubmit: (summary: string) => void;
}) {
  useEscape(onClose);
  const tr = useTicketTranslator();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, []);
  const [summary, setSummary] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dusk-500/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display text-xl text-dusk-500">{tr('Registrar resposta do fornecedor')}</h3>
            <p className="text-xs text-dusk-300 mt-1">{vendorName || tr('Fornecedor')}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/50 hover:bg-white/80 flex items-center justify-center text-dusk-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block text-xs text-dusk-300 font-medium mb-4">
          {tr('Resumo da resposta')}
          <textarea
            ref={textareaRef}
            className="input mt-1 min-h-[120px]"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
            placeholder={tr('Ex: Confirmou visita amanhã às 9h e pediu foto do problema antes da chegada.')}
          />
        </label>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>{tr('Cancelar')}</Button>
          <Button
            variant="primary"
            loading={responding}
            disabled={!summary.trim()}
            leftIcon={<MessageCircle className="w-4 h-4" />}
            onClick={() => onSubmit(summary.trim())}
          >
            {tr('Salvar resposta')}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}

function ResolveModal({
  ticket, resolving, onClose, onSubmit,
}: {
  ticket: TicketDetail;
  resolving: boolean;
  onClose: () => void;
  onSubmit: (resolution: string, announce: boolean) => void;
}) {
  useEscape(onClose);
  const tr = useTicketTranslator();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // UX-M5 — auto-focus the textarea so keyboard users land in the input.
  useEffect(() => { textareaRef.current?.focus(); }, []);
  const [resolution, setResolution] = useState('');
  const [announce, setAnnounce] = useState(ticket.verification_threshold > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dusk-500/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display text-xl text-dusk-500">{tr('Marcar como resolvido')}</h3>
            <p className="text-xs text-dusk-300 mt-1">{ticket.title}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/50 hover:bg-white/80 flex items-center justify-center text-dusk-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block text-xs text-dusk-300 font-medium mb-3">
          {tr('O que foi feito?')}
          <textarea ref={textareaRef} className="input mt-1 min-h-[120px]" value={resolution}
                    onChange={(e) => setResolution(e.target.value)} maxLength={2000}
                    placeholder={tr('Ex: Técnico da Otis trocou a roldana do cabo principal. Funcionando normalmente.')} />
        </label>

        <label className="flex items-start gap-3 rounded-2xl bg-white/45 border border-white/60 p-3 text-sm text-dusk-400 mb-4">
          <input type="checkbox" className="mt-1" checked={announce}
                 onChange={(e) => setAnnounce(e.target.checked)} />
          <span>
            {tr('Publicar comunicado para todos os moradores.')}
            <span className="block text-xs text-dusk-300 mt-0.5">
              {tr('Posta em /app/comunicados e dispara WhatsApp para quem aceitou notificações.')}
            </span>
          </span>
        </label>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>{tr('Cancelar')}</Button>
          <Button variant="primary" loading={resolving}
                  disabled={!resolution.trim()}
                  leftIcon={<Check className="w-4 h-4" />}
                  onClick={() => onSubmit(resolution.trim(), announce)}>
            {tr('Resolver')}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
