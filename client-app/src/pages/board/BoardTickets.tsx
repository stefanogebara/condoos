// Incident Loop — admin dashboard.
// Lists every ticket in the condo, surfaces verification progress, and lets
// the admin manually fire the AI operations agent against a verified report.
// Phase 2 will auto-fire on threshold; Phase 1 keeps the human in the loop.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CheckCircle2, Check, Edit3, Loader2, Mail, MessageCircle, Phone, Send, ShieldAlert, ThumbsUp, Wrench, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { formatDateTime, t, useLocale } from '../../lib/i18n';

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
  verification_threshold: number;
  verification_count: number;
  denial_count: number;
  verified_at: string | null;
  agent_run_at: string | null;
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
}

interface TicketDetail extends Ticket {
  description: string;
  blocked_reason: string | null;
  agent_plan: AgentPlan | null;
  verifications: Array<{ id: number; vote: string; comment: string | null; first_name: string; last_name: string; unit_number: string | null }>;
  dispatches: Dispatch[];
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
}

interface AgentPlan {
  summary?: string;
  recommended_next_step?: string;
  existing_network_fit?: Array<{ company_name: string; category: string; reason: string; contact_method: string }>;
  options?: Array<{ title: string; fit: string; estimated_cost_range: string; timeline: string }>;
  vendor_search_plan?: { outreach_message?: string; search_queries?: string[] };
}

const PRIORITY_TONE: Record<Ticket['priority'], 'sage' | 'peach' | 'neutral' | 'dark'> = {
  low: 'neutral', normal: 'sage', high: 'peach', urgent: 'dark',
};

const BLOCKED_REASON_LABEL: Record<string, string> = {
  no_vendor_in_category: 'Nenhum fornecedor cadastrado para essa categoria. Adicione um em Operação para a IA acionar.',
  vendor_no_response: 'O fornecedor acionado não respondeu dentro do prazo. Considere acionar outro ou contactar manualmente.',
  physical_action_required: 'O agente identificou que é necessária inspeção presencial antes do conserto.',
  ambiguous_reports: 'Os relatos da comunidade estão divididos. Verifique pessoalmente antes de acionar.',
};

export default function BoardTickets() {
  const { locale } = useLocale();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [dispatchingId, setDispatchingId] = useState<number | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [pickerTicketId, setPickerTicketId] = useState<number | null>(null);
  const [resolveTicketId, setResolveTicketId] = useState<number | null>(null);
  const [vendors, setVendors] = useState<ServiceContact[]>([]);
  const seenTicketIds = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (pickerTicketId == null) return;
    apiGet<ServiceContact[]>('/service-contacts').then(setVendors).catch(() => setVendors([]));
  }, [pickerTicketId]);

  const load = useCallback((notify = false) => {
    apiGet<Ticket[]>('/tickets').then((next) => {
      if (notify && seenTicketIds.current) {
        const fresh = next.filter((ticket) => !seenTicketIds.current!.has(ticket.id));
        if (fresh.length > 0) toast.success(t('Novo problema recebido'));
      }
      seenTicketIds.current = new Set(next.map((ticket) => ticket.id));
      setRows(next);
    }).catch(() => {});
  }, []);
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
      toast.success(t(result.fallback ? 'Plano gerado (modo offline)' : 'Plano gerado pela IA'));
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao acionar agente'));
    } finally { setRunningId(null); }
  }

  async function verify(id: number) {
    setVerifyingId(id);
    try {
      await apiPost(`/tickets/${id}/verify`, { vote: 'confirm', locale });
      toast.success(t('Verificado — IA será acionada em segundos'));
      // Poll once after a short delay so the agent_plan from the background
      // run shows up in the UI without a manual refresh.
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
      setTimeout(() => {
        if (id === openId) apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
        load();
      }, 6_000);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao verificar'));
    } finally { setVerifyingId(null); }
  }

  async function dispatch(id: number, opts?: { service_contact_id?: number; channel?: 'whatsapp' | 'email' | 'manual'; message?: string }) {
    setDispatchingId(id);
    try {
      const result = await apiPost<{ vendor: { id: number; company_name: string }; channel: string }>(
        `/tickets/${id}/dispatch`, opts || {}
      );
      toast.success(`${t('Acionado:')} ${result.vendor.company_name} (${result.channel})`);
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
      setPickerTicketId(null);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === 'no_vendor_available') {
        toast.error(t('Nenhum fornecedor disponível para essa categoria'));
      } else {
        toast.error(code || t('Falha ao acionar fornecedor'));
      }
    } finally { setDispatchingId(null); }
  }

  async function resolve(id: number, resolution: string, announce: boolean) {
    setResolvingId(id);
    try {
      const result = await apiPost<{ id: number; announcement_id: number | null }>(
        `/tickets/${id}/resolve`, { resolution, announce }
      );
      toast.success(result.announcement_id ? t('Resolvido — comunicado publicado') : t('Resolvido'));
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
      setResolveTicketId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao resolver'));
    } finally { setResolvingId(null); }
  }

  async function markResponded(ticketId: number, dispatchId: number) {
    const summary = window.prompt(t('O que o fornecedor respondeu?')) || '';
    if (!summary.trim()) return;
    try {
      await apiPost(`/tickets/${ticketId}/dispatches/${dispatchId}/responded`, { response_summary: summary.trim() });
      toast.success(t('Resposta registrada'));
      apiGet<TicketDetail>(`/tickets/${ticketId}`).then(setDetail).catch(() => {});
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao registrar resposta'));
    }
  }

  const needsAttention = rows.filter((r) => r.verification_threshold > 0 && r.remediation_status === 'open');
  const verified = rows.filter((r) => r.remediation_status === 'verified' || r.remediation_status === 'agent_dispatched');
  // Phase 3 — the previous build forgot to render tickets in awaiting_vendor /
  // vendor_engaged anywhere, so once an admin dispatched a vendor the ticket
  // vanished from /board/tickets entirely. Give the in-flight states their
  // own section so the admin can record the vendor response and resolve.
  const inProgress = rows.filter((r) => r.remediation_status === 'awaiting_vendor' || r.remediation_status === 'vendor_engaged');
  const escalated = rows.filter((r) => r.remediation_status === 'blocked_needs_admin');
  const others = rows.filter((r) => (r.verification_threshold === 0 && r.remediation_status === 'open') || r.remediation_status === 'resolved');

  return (
    <>
      <PageHeader title={t('Chamados')} subtitle={t('Problemas reportados pelos moradores, verificações da comunidade, e plano de manutenção sugerido pela IA.')} />

      <Section title={t('Aguardando verificação')} tickets={needsAttention} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={markResponded}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} />

      <Section title={t('Verificados — pronto para acionar a IA')} tickets={verified} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={markResponded}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} />

      <Section title={t('Em andamento — fornecedor acionado')} tickets={inProgress} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={markResponded}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} />

      <Section title={t('Precisa do síndico')} tickets={escalated} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={markResponded}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} />

      <Section title={t('Outros chamados')} tickets={others} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId} dispatchingId={dispatchingId}
               onRunAgent={runAgent} onVerify={verify} onDispatch={dispatch} onMarkResponded={markResponded}
               onOpenPicker={setPickerTicketId} onOpenResolve={setResolveTicketId} />

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

      {rows.length === 0 && (
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">{t('Nenhum chamado aberto')}</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            {t('Quando um morador reportar um problema, ele aparece aqui com a verificação dos vizinhos e um plano da IA.')}
          </p>
        </GlassCard>
      )}
    </>
  );
}

function Section({
  title, tickets, openId, setOpenId, detail, runningId, verifyingId, dispatchingId,
  onRunAgent, onVerify, onDispatch, onMarkResponded, onOpenPicker, onOpenResolve,
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
  onMarkResponded: (ticketId: number, dispatchId: number) => void;
  onOpenPicker: (id: number) => void;
  onOpenResolve: (id: number) => void;
}) {
  if (tickets.length === 0) return null;
  return (
    <>
      <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3">{title}</h2>
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
                     onMarkResponded={(dispatchId) => onMarkResponded(tk.id, dispatchId)}
                     onOpenPicker={() => onOpenPicker(tk.id)}
                     onOpenResolve={() => onOpenResolve(tk.id)} />
        ))}
      </div>
    </>
  );
}

function AdminCard({
  ticket, expanded, detail, onToggle, running, verifying, dispatching,
  onRunAgent, onVerify, onDispatch, onMarkResponded, onOpenPicker, onOpenResolve,
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
  onMarkResponded: (dispatchId: number) => void;
  onOpenPicker: () => void;
  onOpenResolve: () => void;
}) {
  const isCommunity = ticket.verification_threshold > 0;
  const isVerified = !!ticket.verified_at;
  const hasPlan = !!ticket.agent_run_at;
  const isBlocked = ticket.remediation_status === 'blocked_needs_admin';
  const isAwaitingVendor = ticket.remediation_status === 'awaiting_vendor';
  const vendorEngaged = ticket.remediation_status === 'vendor_engaged';
  const progress = Math.min(100, Math.round((ticket.verification_count / Math.max(1, ticket.verification_threshold)) * 100));

  return (
    <GlassCard variant="clay" className="p-5">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-lg text-dusk-500">{ticket.title}</span>
              <Badge tone={PRIORITY_TONE[ticket.priority]}>{t(ticket.priority)}</Badge>
              {isCommunity && <Badge tone="neutral">{t('comunidade')}</Badge>}
              {isVerified && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> {t('verificado')}</Badge>}
              {hasPlan && <Badge tone="peach"><Bot className="w-3 h-3" /> {t('plano da IA')}</Badge>}
              {isAwaitingVendor && <Badge tone="peach"><Send className="w-3 h-3" /> {t('aguardando fornecedor')}</Badge>}
              {vendorEngaged && <Badge tone="sage"><MessageCircle className="w-3 h-3" /> {t('fornecedor respondeu')}</Badge>}
              {isBlocked && <Badge tone="dark"><ShieldAlert className="w-3 h-3" /> {t('precisa do síndico')}</Badge>}
            </div>
            <div className="text-xs text-dusk-300 mt-1">
              {ticket.reporter_first} {ticket.reporter_last}{ticket.unit_number ? ` · ${ticket.unit_number}` : ''} · {formatDateTime(ticket.created_at)}
            </div>
            {isCommunity && (
              <>
                <div className="mt-2 text-xs flex items-center gap-2">
                  <span className="text-sage-700 font-semibold">{ticket.verification_count}</span>
                  <span className="text-dusk-200">{t('de')}</span>
                  <span className="text-dusk-400">{ticket.verification_threshold}</span>
                  <span className="text-dusk-200">·</span>
                  <span className="text-peach-500 font-semibold">{ticket.denial_count}</span>
                  <span className="text-dusk-200">{t('negaram')}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/40 overflow-hidden">
                  <div className={`h-full ${isVerified ? 'bg-sage-500' : 'bg-sage-400'}`} style={{ width: `${progress}%` }} />
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
                <ShieldAlert className="w-3.5 h-3.5" /> {t('Atenção do síndico')}
              </div>
              <p className="text-sm text-dusk-500">
                {BLOCKED_REASON_LABEL[detail.blocked_reason] || detail.blocked_reason}
              </p>
            </GlassCard>
          )}

          <div className="flex gap-2 flex-wrap">
            {!isVerified && (
              <Button size="sm" variant="ghost"
                      leftIcon={verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                      onClick={onVerify} disabled={verifying}>
                {t('Verificar como síndico')}
              </Button>
            )}
            <Button size="sm" variant={hasPlan ? 'ghost' : 'primary'}
                    leftIcon={running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                    onClick={onRunAgent} disabled={running}>
              {hasPlan ? t('Refazer plano IA') : t('Gerar plano IA')}
            </Button>
            {hasPlan && !isBlocked && (
              <>
                <Button size="sm" variant="primary"
                        leftIcon={dispatching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        onClick={() => onDispatch()} disabled={dispatching}>
                  {t('Acionar (auto)')}
                </Button>
                <Button size="sm" variant="ghost"
                        leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                        onClick={onOpenPicker} disabled={dispatching}>
                  {t('Escolher fornecedor')}
                </Button>
              </>
            )}
            {(ticket.remediation_status === 'awaiting_vendor'
              || ticket.remediation_status === 'vendor_engaged'
              || ticket.remediation_status === 'agent_dispatched'
              || ticket.remediation_status === 'blocked_needs_admin') && (
              <Button size="sm" variant="ghost"
                      leftIcon={<Check className="w-3.5 h-3.5" />}
                      onClick={onOpenResolve}>
                {t('Marcar resolvido')}
              </Button>
            )}
          </div>

          {detail?.agent_plan && (
            <GlassCard variant="clay-sage" className="p-4">
              <div className="text-xs uppercase tracking-wider text-sage-900 mb-2 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" /> {t('Plano sugerido')}
              </div>
              {detail.agent_plan.summary && (
                <p className="text-sm text-dusk-500 mb-2">{detail.agent_plan.summary}</p>
              )}
              {detail.agent_plan.recommended_next_step && (
                <p className="text-xs text-dusk-400 mb-3">
                  <strong className="text-dusk-500">{t('Próximo passo:')}</strong> {detail.agent_plan.recommended_next_step}
                </p>
              )}
              {detail.agent_plan.existing_network_fit && detail.agent_plan.existing_network_fit.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">{t('Da rede já cadastrada')}</div>
                  <ul className="space-y-1">
                    {detail.agent_plan.existing_network_fit.slice(0, 3).map((fit, i) => (
                      <li key={i} className="text-xs text-dusk-400">
                        <strong className="text-dusk-500">{fit.company_name}</strong> ({fit.category}) — {fit.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.agent_plan.options && detail.agent_plan.options.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">{t('Opções avaliadas')}</div>
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
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">{t('Mensagem de contato')}</div>
                  <pre className="text-xs text-dusk-400 whitespace-pre-wrap font-sans bg-white/40 rounded-xl p-2 border border-white/60">
                    {detail.agent_plan.vendor_search_plan.outreach_message}
                  </pre>
                </div>
              )}
            </GlassCard>
          )}

          {detail?.dispatches && detail.dispatches.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-dusk-200 mb-2">{t('Histórico de acionamentos')}</div>
              <ul className="space-y-2">
                {detail.dispatches.map((d) => (
                  <li key={d.id} className="rounded-2xl border border-white/60 bg-white/45 p-3 text-xs text-dusk-400">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-dusk-500">{d.vendor_name || '—'}</span>
                      {d.vendor_category && <Badge tone="neutral">{d.vendor_category}</Badge>}
                      <Badge tone={d.status === 'responded' ? 'sage' : d.status === 'failed' ? 'dark' : 'peach'}>
                        {d.channel === 'whatsapp' && <MessageCircle className="w-3 h-3" />}
                        {d.channel === 'email' && <Mail className="w-3 h-3" />}
                        {d.channel === 'manual' && <Phone className="w-3 h-3" />}
                        {' '}
                        {d.status}
                      </Badge>
                      {d.outbox_status && d.outbox_status !== d.status && (
                        <span className="text-[10px] text-dusk-300">{t('entrega:')} {d.outbox_status}</span>
                      )}
                      <span className="text-dusk-300 ml-auto">{formatDateTime(d.created_at)}</span>
                    </div>
                    <div className="mt-1 text-dusk-300 whitespace-pre-line">{d.message_body}</div>
                    {d.response_summary && (
                      <div className="mt-2 pt-2 border-t border-white/50 text-dusk-400">
                        <strong className="text-dusk-500">{t('Resposta:')}</strong> {d.response_summary}
                      </div>
                    )}
                    {d.status === 'queued' || d.status === 'sent' ? (
                      <div className="mt-2">
                        <Button size="sm" variant="ghost"
                                leftIcon={<MessageCircle className="w-3 h-3" />}
                                onClick={() => onMarkResponded(d.id)}>
                          {t('Registrar resposta')}
                        </Button>
                      </div>
                    ) : null}
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

function VendorPickerModal({
  ticket, vendors, dispatching, onClose, onSubmit,
}: {
  ticket: TicketDetail;
  vendors: ServiceContact[];
  dispatching: boolean;
  onClose: () => void;
  onSubmit: (opts: { service_contact_id?: number; channel?: 'whatsapp' | 'email' | 'manual'; message?: string }) => void;
}) {
  const networkFit = ticket.agent_plan?.existing_network_fit || [];
  const preferred = networkFit[0]?.company_name;
  const sameCategory = vendors.filter((v) => v.category === ticket.category);
  const otherCategory = vendors.filter((v) => v.category !== ticket.category);
  const sorted = [...sameCategory, ...otherCategory];

  // Pre-select priority: exact name match against the AI's top suggestion >
  // first same-category vendor > any preferred vendor > first row. Previously
  // the preferred fallback won over same-category, so a `maintenance` ticket
  // defaulted to the ★ Otis (elevator) instead of the actual matching vendor.
  const initialVendor = sorted.find((v) => v.company_name === preferred)
    || sameCategory[0]
    || sorted.find((v) => v.preferred === 1)
    || sorted[0];

  const [vendorId, setVendorId] = useState<number | null>(initialVendor?.id ?? null);
  const [channel, setChannel] = useState<'whatsapp' | 'email' | 'manual'>(
    initialVendor?.whatsapp ? 'whatsapp' : initialVendor?.email ? 'email' : 'manual',
  );
  const [message, setMessage] = useState<string>(
    ticket.agent_plan?.vendor_search_plan?.outreach_message
      || `Olá, somos do condomínio. Precisamos de ajuda com: ${ticket.title}. Pode nos atender?`,
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
            <h3 className="font-display text-xl text-dusk-500">{t('Acionar fornecedor')}</h3>
            <p className="text-xs text-dusk-300 mt-1">{ticket.title}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/50 hover:bg-white/80 flex items-center justify-center text-dusk-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block text-xs text-dusk-300 font-medium mb-3">
          {t('Fornecedor')}
          <select className="input mt-1" value={vendorId ?? ''} onChange={(e) => setVendorId(Number(e.target.value))}>
            {sorted.length === 0 && <option value="">{t('Nenhum cadastrado')}</option>}
            {sorted.map((vv) => (
              <option key={vv.id} value={vv.id}>
                {vv.preferred === 1 ? '★ ' : ''}{vv.company_name} ({vv.category})
                {vv.emergency_available === 1 ? ' · 24h' : ''}
              </option>
            ))}
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
          <legend className="text-xs text-dusk-300 font-medium mb-2">{t('Canal')}</legend>
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
                  {ch === 'manual' && <><Phone className="inline w-3 h-3 mr-1" />{t('Manual (telefone)')}</>}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="block text-xs text-dusk-300 font-medium mb-3">
          {t('Mensagem')}
          <textarea className="input mt-1 min-h-[140px]" value={message}
                    onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
        </label>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={dispatching}
                  disabled={!vendorId || !message.trim()}
                  leftIcon={<Send className="w-4 h-4" />}
                  onClick={() => onSubmit({ service_contact_id: vendorId ?? undefined, channel, message })}>
            {t('Enviar')}
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
  const [resolution, setResolution] = useState('');
  const [announce, setAnnounce] = useState(ticket.verification_threshold > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-dusk-500/40 backdrop-blur-sm">
      <GlassCard className="w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display text-xl text-dusk-500">{t('Marcar como resolvido')}</h3>
            <p className="text-xs text-dusk-300 mt-1">{ticket.title}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-2xl bg-white/50 hover:bg-white/80 flex items-center justify-center text-dusk-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block text-xs text-dusk-300 font-medium mb-3">
          {t('O que foi feito?')}
          <textarea className="input mt-1 min-h-[120px]" value={resolution}
                    onChange={(e) => setResolution(e.target.value)} maxLength={2000}
                    placeholder={t('Ex: Técnico da Otis trocou a roldana do cabo principal. Funcionando normalmente.')} />
        </label>

        <label className="flex items-start gap-3 rounded-2xl bg-white/45 border border-white/60 p-3 text-sm text-dusk-400 mb-4">
          <input type="checkbox" className="mt-1" checked={announce}
                 onChange={(e) => setAnnounce(e.target.checked)} />
          <span>
            {t('Publicar comunicado para todos os moradores.')}
            <span className="block text-xs text-dusk-300 mt-0.5">
              {t('Posta em /app/comunicados e dispara WhatsApp para quem aceitou notificações.')}
            </span>
          </span>
        </label>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={resolving}
                  disabled={!resolution.trim()}
                  leftIcon={<Check className="w-4 h-4" />}
                  onClick={() => onSubmit(resolution.trim(), announce)}>
            {t('Resolver')}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
