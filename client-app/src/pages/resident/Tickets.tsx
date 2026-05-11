// Incident Loop — resident view.
// Resident reports a broken thing → other residents verify → admin/majority
// confirms → admin dispatches AI agent (Phase 2 will auto-dispatch).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Bot, Check, CheckCircle2, Megaphone, MessageCircle, Plus, Send, ShieldAlert, Sparkles, ThumbsDown, ThumbsUp, Users, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatRelativeTime, t } from '../../lib/i18n';

interface Ticket {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: string;
  remediation_status: string;
  reporter_id: number;
  reporter_first: string | null;
  reporter_last: string | null;
  unit_number: string | null;
  reporter_unit_number: string | null;
  verification_threshold: number;
  verification_count: number;
  denial_count: number;
  verified_at: string | null;
  agent_run_at: string | null;
  resolved_at: string | null;
  blocked_reason: string | null;
  created_at: string;
}

interface Verification {
  id: number;
  vote: 'confirm' | 'deny';
  comment: string | null;
  created_at: string;
  first_name: string;
  last_name: string;
  unit_number: string | null;
}

interface ResidentDispatch {
  id: number;
  status: string;
  created_at: string;
  responded_at: string | null;
  vendor_name: string | null;
}

interface TicketDetail extends Ticket {
  verifications: Verification[];
  dispatches?: ResidentDispatch[];
  my_vote: 'confirm' | 'deny' | null;
}

const CATEGORIES = [
  { value: 'elevator',     label: 'Elevador' },
  { value: 'electrical',   label: 'Elétrica' },
  { value: 'plumbing',     label: 'Hidráulica' },
  { value: 'hvac',         label: 'Ar / climatização' },
  { value: 'cleaning',     label: 'Limpeza' },
  { value: 'security',     label: 'Segurança / acesso' },
  { value: 'amenity',      label: 'Áreas comuns' },
  { value: 'maintenance',  label: 'Manutenção geral' },
  { value: 'other',        label: 'Outros' },
];

const PRIORITY_TONE: Record<Ticket['priority'], 'sage' | 'peach' | 'neutral' | 'dark'> = {
  low: 'neutral', normal: 'sage', high: 'peach', urgent: 'dark',
};

const PRIORITY_LABEL: Record<Ticket['priority'], string> = {
  low: 'baixa', normal: 'normal', high: 'alta', urgent: 'urgente',
};

function priorityLabel(priority: Ticket['priority']) {
  return t(PRIORITY_LABEL[priority]);
}

export default function Tickets() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);

  const load = useCallback(() => {
    apiGet<Ticket[]>('/tickets').then(setRows).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  // UX-H3 — match the admin page's 15s polling cadence so residents see
  // fresh verification counts and status flips without a manual reload.
  useEffect(() => {
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (openId == null) { setDetail(null); return; }
    apiGet<TicketDetail>(`/tickets/${openId}`).then(setDetail).catch(() => setDetail(null));
  }, [openId]);

  async function vote(id: number, choice: 'confirm' | 'deny') {
    try {
      await apiPost(`/tickets/${id}/verify`, { vote: choice });
      toast.success(t(choice === 'confirm' ? 'Voto registrado: confirmo' : 'Voto registrado: não confirmo'));
      apiGet<TicketDetail>(`/tickets/${id}`).then(setDetail).catch(() => {});
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao registrar voto'));
    }
  }

  // UX-M2 — resolved community tickets used to sit under "Aguardando
  // verificação" with a `resolvido` badge, which read as contradictory.
  // Split open vs resolved into separate sections.
  const communityOpen = rows.filter((r) => r.verification_threshold > 0 && r.remediation_status !== 'resolved');
  const communityResolved = rows.filter((r) => r.verification_threshold > 0 && r.remediation_status === 'resolved');
  const mine = rows.filter((r) => r.reporter_id === user?.id && r.verification_threshold === 0);

  return (
    <>
      <PageHeader
        title={t('Problemas no prédio')}
        subtitle={t('Reporte uma falha, ajude a verificar relatos de vizinhos ou acompanhe o seu chamado.')}
        actions={
          <Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'}
                  leftIcon={showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}>
            {showForm ? t('Cancelar') : t('Reportar problema')}
          </Button>
        }
      />

      {showForm && <ReportForm onCreated={() => { setShowForm(false); load(); }} />}

      {communityOpen.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3 flex items-baseline gap-2">
            <span>{t('Aguardando verificação')}</span>
            <span className="text-sm font-normal text-dusk-200">({communityOpen.length})</span>
          </h2>
          <div className="space-y-3">
            {communityOpen.map((tk) => (
              <TicketCard
                key={tk.id}
                ticket={tk}
                expanded={openId === tk.id}
                detail={openId === tk.id ? detail : null}
                onToggle={() => setOpenId((cur) => (cur === tk.id ? null : tk.id))}
                onVote={(choice) => vote(tk.id, choice)}
                isOwn={tk.reporter_id === user?.id}
              />
            ))}
          </div>
        </>
      )}

      {communityResolved.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3 flex items-baseline gap-2">
            <span>{t('Resolvidos pela comunidade')}</span>
            <span className="text-sm font-normal text-dusk-200">({communityResolved.length})</span>
          </h2>
          <div className="space-y-3">
            {communityResolved.map((tk) => (
              <TicketCard
                key={tk.id}
                ticket={tk}
                expanded={openId === tk.id}
                detail={openId === tk.id ? detail : null}
                onToggle={() => setOpenId((cur) => (cur === tk.id ? null : tk.id))}
                onVote={(choice) => vote(tk.id, choice)}
                isOwn={tk.reporter_id === user?.id}
              />
            ))}
          </div>
        </>
      )}

      {mine.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3">{t('Meus chamados privados')}</h2>
          <div className="space-y-3">
            {mine.map((tk) => (
              <GlassCard key={tk.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-dusk-500">{tk.title}</div>
                    <div className="text-xs text-dusk-300 mt-1">{tk.category} · {formatDateTime(tk.created_at)}</div>
                  </div>
                  <Badge tone={PRIORITY_TONE[tk.priority]}>{priorityLabel(tk.priority)}</Badge>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {rows.length === 0 && !showForm && (
        <GlassCard className="p-8 text-center mt-6">
          <AlertTriangle className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">{t('Nenhum problema reportado')}</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            {t('Se algo no prédio quebrar, reporte aqui. Os vizinhos confirmam e o síndico aciona a manutenção certa.')}
          </p>
        </GlassCard>
      )}
    </>
  );
}

function TicketCard({
  ticket, expanded, detail, onToggle, onVote, isOwn,
}: {
  ticket: Ticket;
  expanded: boolean;
  detail: TicketDetail | null;
  onToggle: () => void;
  onVote: (choice: 'confirm' | 'deny') => void;
  isOwn: boolean;
}) {
  const verified = !!ticket.verified_at;
  const progress = Math.min(100, Math.round((ticket.verification_count / Math.max(1, ticket.verification_threshold)) * 100));
  const myVote = detail?.my_vote;

  return (
    <GlassCard variant="clay" className="p-4">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-dusk-500">{ticket.title}</span>
              <Badge tone={PRIORITY_TONE[ticket.priority]}>{priorityLabel(ticket.priority)}</Badge>
              {verified && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> {t('verificado')}</Badge>}
              {ticket.remediation_status === 'agent_dispatched' && <Badge tone="peach">{t('IA acionada')}</Badge>}
              {ticket.remediation_status === 'awaiting_vendor' && <Badge tone="peach">{t('aguardando fornecedor')}</Badge>}
              {ticket.remediation_status === 'vendor_engaged' && <Badge tone="sage">{t('fornecedor respondeu')}</Badge>}
              {ticket.remediation_status === 'blocked_needs_admin' && <Badge tone="dark">{t('síndico vai resolver')}</Badge>}
              {ticket.remediation_status === 'resolved' && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> {t('resolvido')}</Badge>}
            </div>
            <div className="text-xs text-dusk-300 mt-1">
              {/* Use reporter_unit_number (their home unit) not unit_number
                  (the ticket's affected unit, which is rarely set on
                  community reports). formatRelativeTime keeps fresh reports
                  reading "há 5 min" instead of the full datestamp. */}
              {[
                `${t('Reportado por')} ${ticket.reporter_first || ''}`.trim(),
                ticket.reporter_unit_number ? `${t('Apto')} ${ticket.reporter_unit_number}` : null,
                formatRelativeTime(ticket.created_at),
              ].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-sage-700 font-semibold">{ticket.verification_count} {t('confirmações')}</span>
              <span className="text-dusk-200">·</span>
              <span className="text-peach-500 font-semibold">{ticket.denial_count} {t('negaram')}</span>
              <span className="text-dusk-200">·</span>
              <span className="text-dusk-300">{t('meta:')} {ticket.verification_threshold}</span>
            </div>
            {/* UX-M8 — at 0/threshold the green fill was width:0% leaving a
                completely empty track that read as a missing UI element.
                Render a faint striped pattern when nothing's been counted
                so the bar communicates "waiting on votes" instead. */}
            <div className="mt-1.5 h-1.5 rounded-full bg-white/40 overflow-hidden">
              {ticket.verification_count === 0 ? (
                <div className="h-full" style={{
                  backgroundImage: 'repeating-linear-gradient(135deg, rgba(102,80,74,0.18) 0 4px, transparent 4px 8px)',
                }} />
              ) : (
                <div className={`h-full ${verified ? 'bg-sage-500' : 'bg-sage-400'}`} style={{ width: `${progress}%` }} />
              )}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/50 space-y-3">
          <p className="text-sm text-dusk-400 whitespace-pre-line">{ticket.description}</p>

          {!verified && !isOwn && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm"
                      variant={myVote === 'confirm' ? 'primary' : 'ghost'}
                      leftIcon={<ThumbsUp className="w-3.5 h-3.5" />}
                      onClick={() => onVote('confirm')}>
                {t('Confirmo')}
              </Button>
              <Button size="sm"
                      variant={myVote === 'deny' ? 'primary' : 'ghost'}
                      leftIcon={<ThumbsDown className="w-3.5 h-3.5" />}
                      onClick={() => onVote('deny')}>
                {t('Não confirmo')}
              </Button>
            </div>
          )}

          {isOwn && (
            <div className="text-xs text-dusk-200">{t('Você reportou este problema; aguardando vizinhos verificarem.')}</div>
          )}

          {detail && <TicketTimeline ticket={ticket} detail={detail} />}

          {detail && detail.verifications.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-dusk-200 mb-2">{t('Votos')}</div>
              <ul className="space-y-1">
                {detail.verifications.map((v) => (
                  <li key={v.id} className="text-xs text-dusk-300 flex items-center gap-2">
                    {v.vote === 'confirm'
                      ? <Check className="w-3 h-3 text-sage-700" />
                      : <X className="w-3 h-3 text-peach-500" />}
                    <span>{v.first_name} {v.last_name}{v.unit_number ? ` · ${v.unit_number}` : ''}</span>
                    {v.comment && <span className="text-dusk-200">— {v.comment}</span>}
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

// Pilot-readiness item 3 — resident-side timeline.
// Residents only ever saw votes + maybe a "resolved" badge. There was no way
// to tell whether the admin had actually dispatched someone, who, when, and
// whether the vendor had replied. The timeline reads the existing
// verified_at/agent_run_at/resolved_at columns plus the new dispatches[]
// array off the ticket detail and renders a single chronological strip so
// the resident has the same situational awareness the admin does — minus
// any vendor PII (just the company name and event timestamps).
type TimelineEvent = {
  key: string;
  at: string;
  icon: React.ReactNode;
  text: React.ReactNode;
};

function TicketTimeline({ ticket, detail }: { ticket: Ticket; detail: TicketDetail }) {
  const events: TimelineEvent[] = [];

  events.push({
    key: 'reported',
    at: ticket.created_at,
    icon: <Megaphone className="w-3.5 h-3.5 text-dusk-300" />,
    text: (
      <>
        {t('Reportado por')} <span className="font-medium text-dusk-500">
          {ticket.reporter_first || t('vizinho')}
        </span>
      </>
    ),
  });

  if (ticket.verified_at) {
    events.push({
      key: 'verified',
      at: ticket.verified_at,
      icon: <Users className="w-3.5 h-3.5 text-sage-700" />,
      text: <>{t('Vizinhos confirmaram o problema')}</>,
    });
  }

  if (ticket.agent_run_at) {
    events.push({
      key: 'agent',
      at: ticket.agent_run_at,
      icon: <Sparkles className="w-3.5 h-3.5 text-peach-500" />,
      text: <>{t('IA gerou plano de remediação')}</>,
    });
  }

  for (const dispatch of detail.dispatches || []) {
    events.push({
      key: `dispatch-${dispatch.id}`,
      at: dispatch.created_at,
      icon: <Send className="w-3.5 h-3.5 text-peach-500" />,
      text: (
        <>
          {t('Síndico acionou')}{' '}
          <span className="font-medium text-dusk-500">
            {dispatch.vendor_name || t('fornecedor')}
          </span>
        </>
      ),
    });
    if (dispatch.responded_at) {
      events.push({
        key: `responded-${dispatch.id}`,
        at: dispatch.responded_at,
        icon: <MessageCircle className="w-3.5 h-3.5 text-sage-700" />,
        text: (
          <>
            <span className="font-medium text-dusk-500">
              {dispatch.vendor_name || t('fornecedor')}
            </span>{' '}
            {t('respondeu')}
          </>
        ),
      });
    }
  }

  if (ticket.blocked_reason && ticket.remediation_status === 'blocked_needs_admin') {
    // Differentiate the two scenarios so the resident knows whether the
    // admin needs to add a contact (no_vendor_in_category) vs chase one
    // that already exists but didn't reply (vendor_no_response).
    const blockedText = ticket.blocked_reason === 'vendor_no_response'
      ? t('Sem resposta do fornecedor — síndico vai retomar')
      : t('Aguardando síndico — sem fornecedor disponível');
    events.push({
      key: 'blocked',
      at: ticket.agent_run_at || ticket.created_at,
      icon: <ShieldAlert className="w-3.5 h-3.5 text-dusk-400" />,
      text: <>{blockedText}</>,
    });
  }

  if (ticket.resolved_at) {
    events.push({
      key: 'resolved',
      at: ticket.resolved_at,
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-sage-700" />,
      text: <>{t('Problema resolvido')}</>,
    });
  }

  // Sort chronologically. Lexicographic compare on the SQLite
  // 'YYYY-MM-DD HH:MM:SS' UTC format gives the same order as Date compare
  // without the parse overhead.
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  if (events.length === 0) return null;

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-dusk-200 mb-2">
        {t('Linha do tempo')}
      </div>
      <ol className="relative border-l border-white/60 pl-4 space-y-2">
        {events.map((evt) => (
          <li key={evt.key} className="relative">
            <span className="absolute -left-[1.4rem] top-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-white/70 border border-white/80">
              {evt.icon}
            </span>
            <div className="text-xs text-dusk-400 leading-snug">{evt.text}</div>
            <div className="text-[10px] uppercase tracking-wider text-dusk-200 mt-0.5">
              {formatRelativeTime(evt.at)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReportForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'maintenance',
    priority: 'normal' as Ticket['priority'],
    community: true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      // Default community threshold = 3 confirmations. Admins can override
      // per-condo later; for the demo a low N keeps the loop testable.
      await apiPost('/tickets', {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        priority: form.priority,
        verification_threshold: form.community ? 3 : 0,
      });
      toast.success(t('Problema reportado'));
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao reportar'));
    } finally { setSaving(false); }
  }

  return (
    <GlassCard className="p-6 mb-2 animate-fade-up">
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">{t('Novo problema')}</h3>
      <p className="text-sm text-dusk-300 mt-1">
        {t('Descreva o que quebrou ou está com defeito. Os vizinhos podem confirmar e o síndico acompanha pela operação.')}
      </p>
      <form onSubmit={submit} className="space-y-3 mt-4">
        <input className="input" placeholder={t('Título (ex: Elevador A parado no 12)')}
               value={form.title} maxLength={140}
               onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <textarea className="input min-h-[100px]"
                  placeholder={t('O que aconteceu, onde, quando você notou.')}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Categoria')}
            <select className="input mt-1" value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{t(c.label)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            {t('Prioridade')}
            <select className="input mt-1" value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value as Ticket['priority'] })}>
              <option value="low">{t('Baixa')}</option>
              <option value="normal">{t('Normal')}</option>
              <option value="high">{t('Alta')}</option>
              <option value="urgent">{t('Urgente')}</option>
            </select>
          </label>
        </div>
        <label className="flex items-start gap-3 rounded-2xl bg-white/45 border border-white/60 p-3 text-sm text-dusk-400">
          <input type="checkbox" checked={form.community} className="mt-1"
                 onChange={(e) => setForm({ ...form, community: e.target.checked })} />
          <span>
            {t('Visível para os vizinhos (eles confirmam o problema).')}
            <span className="block text-xs text-dusk-300 mt-0.5">
              {t('Desmarque para um chamado privado direto ao síndico.')}
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="submit" variant="primary" loading={saving}
                  disabled={!form.title.trim() || !form.description.trim()}>
            {t('Reportar problema')}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
