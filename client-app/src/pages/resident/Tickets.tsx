// Incident Loop — resident view.
// Resident reports a broken thing → other residents verify → admin/majority
// confirms → admin dispatches AI agent (Phase 2 will auto-dispatch).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, CheckCircle2, Plus, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, t } from '../../lib/i18n';

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
  verification_threshold: number;
  verification_count: number;
  denial_count: number;
  verified_at: string | null;
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

interface TicketDetail extends Ticket {
  verifications: Verification[];
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

  const community = rows.filter((r) => r.verification_threshold > 0);
  const mine = rows.filter((r) => r.reporter_id === user?.id && r.verification_threshold === 0);

  return (
    <>
      <PageHeader
        title="Problemas no prédio"
        subtitle="Reporte uma falha, ajude a verificar relatos de vizinhos ou acompanhe o seu chamado."
        actions={
          <Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'}
                  leftIcon={showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}>
            {showForm ? 'Cancelar' : 'Reportar problema'}
          </Button>
        }
      />

      {showForm && <ReportForm onCreated={() => { setShowForm(false); load(); }} />}

      {community.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3">Aguardando verificação</h2>
          <div className="space-y-3">
            {community.map((tk) => (
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
          <h2 className="font-display text-xl text-dusk-500 mt-8 mb-3">Meus chamados privados</h2>
          <div className="space-y-3">
            {mine.map((tk) => (
              <GlassCard key={tk.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-dusk-500">{tk.title}</div>
                    <div className="text-xs text-dusk-300 mt-1">{tk.category} · {formatDateTime(tk.created_at)}</div>
                  </div>
                  <Badge tone={PRIORITY_TONE[tk.priority]}>{PRIORITY_LABEL[tk.priority]}</Badge>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {rows.length === 0 && !showForm && (
        <GlassCard className="p-8 text-center mt-6">
          <AlertTriangle className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
          <h3 className="font-display text-lg text-dusk-500">Nenhum problema reportado</h3>
          <p className="text-sm text-dusk-300 mt-2 max-w-md mx-auto">
            Se algo no prédio quebrar, reporte aqui. Os vizinhos confirmam e o síndico aciona a manutenção certa.
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
              <Badge tone={PRIORITY_TONE[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]}</Badge>
              {verified && <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> verificado</Badge>}
              {ticket.remediation_status === 'agent_dispatched' && <Badge tone="peach">IA acionada</Badge>}
            </div>
            <div className="text-xs text-dusk-300 mt-1">
              Reportado por {ticket.reporter_first} {ticket.unit_number ? `· Apto ${ticket.unit_number}` : ''} · {formatDateTime(ticket.created_at)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-sage-700 font-semibold">{ticket.verification_count} confirmações</span>
              <span className="text-dusk-200">·</span>
              <span className="text-peach-500 font-semibold">{ticket.denial_count} negaram</span>
              <span className="text-dusk-200">·</span>
              <span className="text-dusk-300">meta: {ticket.verification_threshold}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/40 overflow-hidden">
              <div className={`h-full ${verified ? 'bg-sage-500' : 'bg-sage-400'}`} style={{ width: `${progress}%` }} />
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
                Confirmo
              </Button>
              <Button size="sm"
                      variant={myVote === 'deny' ? 'primary' : 'ghost'}
                      leftIcon={<ThumbsDown className="w-3.5 h-3.5" />}
                      onClick={() => onVote('deny')}>
                Não confirmo
              </Button>
            </div>
          )}

          {isOwn && (
            <div className="text-xs text-dusk-200">Você reportou este problema; aguardando vizinhos verificarem.</div>
          )}

          {detail && detail.verifications.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-dusk-200 mb-2">Votos</div>
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
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">Novo problema</h3>
      <p className="text-sm text-dusk-300 mt-1">
        Descreva o que quebrou ou está com defeito. Os vizinhos podem confirmar e o síndico acompanha pela operação.
      </p>
      <form onSubmit={submit} className="space-y-3 mt-4">
        <input className="input" placeholder="Título (ex: Elevador A parado no 12)"
               value={form.title} maxLength={140}
               onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <textarea className="input min-h-[100px]"
                  placeholder="O que aconteceu, onde, quando você notou."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block text-xs text-dusk-300 font-medium">
            Categoria
            <select className="input mt-1" value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            Prioridade
            <select className="input mt-1" value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value as Ticket['priority'] })}>
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
        </div>
        <label className="flex items-start gap-3 rounded-2xl bg-white/45 border border-white/60 p-3 text-sm text-dusk-400">
          <input type="checkbox" checked={form.community} className="mt-1"
                 onChange={(e) => setForm({ ...form, community: e.target.checked })} />
          <span>
            Vísivel para os vizinhos (eles confirmam o problema).
            <span className="block text-xs text-dusk-300 mt-0.5">
              Desmarque para um chamado privado direto ao síndico.
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="submit" variant="primary" loading={saving}
                  disabled={!form.title.trim() || !form.description.trim()}>
            Reportar problema
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
