// Incident Loop — admin dashboard.
// Lists every ticket in the condo, surfaces verification progress, and lets
// the admin manually fire the AI operations agent against a verified report.
// Phase 2 will auto-fire on threshold; Phase 1 keeps the human in the loop.
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, CheckCircle2, Loader2, ThumbsUp, Wrench } from 'lucide-react';
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

interface TicketDetail extends Ticket {
  agent_plan: AgentPlan | null;
  verifications: Array<{ id: number; vote: string; comment: string | null; first_name: string; last_name: string; unit_number: string | null }>;
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

export default function BoardTickets() {
  const { locale } = useLocale();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  const load = useCallback(() => {
    apiGet<Ticket[]>('/tickets').then(setRows).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

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
      await apiPost(`/tickets/${id}/verify`, { vote: 'confirm' });
      toast.success(t('Verificado'));
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao verificar'));
    } finally { setVerifyingId(null); }
  }

  const needsAttention = rows.filter((r) => r.verification_threshold > 0 && r.remediation_status === 'open');
  const verified = rows.filter((r) => r.remediation_status === 'verified' || r.remediation_status === 'agent_dispatched');
  const others = rows.filter((r) => r.verification_threshold === 0 || ['resolved', 'blocked_needs_admin'].includes(r.remediation_status));

  return (
    <>
      <PageHeader title="Chamados" subtitle="Problemas reportados pelos moradores, verificações da comunidade, e plano de manutenção sugerido pela IA." />

      <Section title="Aguardando verificação" tickets={needsAttention} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId}
               onRunAgent={runAgent} onVerify={verify} />

      <Section title="Verificados — pronto para acionar a IA" tickets={verified} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId}
               onRunAgent={runAgent} onVerify={verify} />

      <Section title="Outros chamados" tickets={others} openId={openId} setOpenId={setOpenId}
               detail={detail} runningId={runningId} verifyingId={verifyingId}
               onRunAgent={runAgent} onVerify={verify} />

      {rows.length === 0 && (
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">Nenhum chamado aberto</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            Quando um morador reportar um problema, ele aparece aqui com a verificação dos vizinhos e um plano da IA.
          </p>
        </GlassCard>
      )}
    </>
  );
}

function Section({
  title, tickets, openId, setOpenId, detail, runningId, verifyingId, onRunAgent, onVerify,
}: {
  title: string;
  tickets: Ticket[];
  openId: number | null;
  setOpenId: (id: number | null) => void;
  detail: TicketDetail | null;
  runningId: number | null;
  verifyingId: number | null;
  onRunAgent: (id: number) => void;
  onVerify: (id: number) => void;
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
                     onRunAgent={() => onRunAgent(tk.id)}
                     onVerify={() => onVerify(tk.id)} />
        ))}
      </div>
    </>
  );
}

function AdminCard({
  ticket, expanded, detail, onToggle, running, verifying, onRunAgent, onVerify,
}: {
  ticket: Ticket;
  expanded: boolean;
  detail: TicketDetail | null;
  onToggle: () => void;
  running: boolean;
  verifying: boolean;
  onRunAgent: () => void;
  onVerify: () => void;
}) {
  const isCommunity = ticket.verification_threshold > 0;
  const isVerified = !!ticket.verified_at;
  const hasPlan = !!ticket.agent_run_at;
  const progress = Math.min(100, Math.round((ticket.verification_count / Math.max(1, ticket.verification_threshold)) * 100));

  return (
    <GlassCard variant="clay" className="p-5">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-lg text-dusk-500">{ticket.title}</span>
              <Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge>
              {isCommunity && <Badge tone="neutral">comunidade</Badge>}
              {isVerified && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> verificado</Badge>}
              {hasPlan && <Badge tone="peach"><Bot className="w-3 h-3" /> plano da IA</Badge>}
            </div>
            <div className="text-xs text-dusk-300 mt-1">
              {ticket.reporter_first} {ticket.reporter_last}{ticket.unit_number ? ` · ${ticket.unit_number}` : ''} · {formatDateTime(ticket.created_at)}
            </div>
            {isCommunity && (
              <>
                <div className="mt-2 text-xs flex items-center gap-2">
                  <span className="text-sage-700 font-semibold">{ticket.verification_count}</span>
                  <span className="text-dusk-200">de</span>
                  <span className="text-dusk-400">{ticket.verification_threshold}</span>
                  <span className="text-dusk-200">·</span>
                  <span className="text-peach-500 font-semibold">{ticket.denial_count}</span>
                  <span className="text-dusk-200">negaram</span>
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

          <div className="flex gap-2 flex-wrap">
            {!isVerified && (
              <Button size="sm" variant="ghost"
                      leftIcon={verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                      onClick={onVerify} disabled={verifying}>
                Verificar como síndico
              </Button>
            )}
            <Button size="sm" variant="primary"
                    leftIcon={running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                    onClick={onRunAgent} disabled={running}>
              {hasPlan ? 'Refazer plano IA' : 'Gerar plano IA'}
            </Button>
          </div>

          {detail?.agent_plan && (
            <GlassCard variant="clay-sage" className="p-4">
              <div className="text-xs uppercase tracking-wider text-sage-900 mb-2 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" /> Plano sugerido
              </div>
              {detail.agent_plan.summary && (
                <p className="text-sm text-dusk-500 mb-2">{detail.agent_plan.summary}</p>
              )}
              {detail.agent_plan.recommended_next_step && (
                <p className="text-xs text-dusk-400 mb-3">
                  <strong className="text-dusk-500">Próximo passo:</strong> {detail.agent_plan.recommended_next_step}
                </p>
              )}
              {detail.agent_plan.existing_network_fit && detail.agent_plan.existing_network_fit.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">Da rede já cadastrada</div>
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
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">Opções avaliadas</div>
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
                  <div className="text-[11px] uppercase tracking-wider text-dusk-300 mb-1">Mensagem de contato</div>
                  <pre className="text-xs text-dusk-400 whitespace-pre-wrap font-sans bg-white/40 rounded-xl p-2 border border-white/60">
                    {detail.agent_plan.vendor_search_plan.outreach_message}
                  </pre>
                </div>
              )}
            </GlassCard>
          )}
        </div>
      )}
    </GlassCard>
  );
}
