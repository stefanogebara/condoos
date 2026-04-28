import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { DoorOpen, Plus, Clock, History as HistoryIcon } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import EmptyState from '../../components/EmptyState';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { formatDateTime } from '../../lib/i18n';

interface Visitor {
  id: number;
  visitor_name: string;
  visitor_type: string;
  status: 'pending' | 'approved' | 'denied' | 'arrived' | 'completed';
  expected_at: string | null;
  notes: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Visitor['status'], string> = {
  pending: 'pendente', approved: 'aprovado', denied: 'negado', arrived: 'chegou', completed: 'concluído',
};
const TYPE_LABEL: Record<string, string> = {
  guest: 'visita', delivery: 'entrega', service: 'serviço', rideshare: 'app',
};

// History grace: a visit's expected time can pass by 24h before we move it
// from "Próximas" to "Histórico", so a friend who's running a few hours late
// doesn't disappear from the resident's upcoming list.
const HISTORY_GRACE_MS = 24 * 3600 * 1000;
const HISTORY_LOOKBACK_DAYS = 90;

function isUpcoming(v: Visitor, now: number): boolean {
  if (v.status === 'pending' || v.status === 'approved') {
    if (!v.expected_at) return true; // open-ended request, treat as upcoming
    return new Date(v.expected_at).getTime() >= now - HISTORY_GRACE_MS;
  }
  return false;
}

function isInHistory(v: Visitor, now: number, cutoffMs: number): boolean {
  // Past entries: arrived/completed/denied OR an expected time that's older than the grace window.
  const past = v.status === 'arrived' || v.status === 'completed' || v.status === 'denied' ||
    (v.expected_at != null && new Date(v.expected_at).getTime() < now - HISTORY_GRACE_MS);
  if (!past) return false;
  // 90-day cap on history view (Brazilian QA preference). Anchor by expected_at if present, otherwise created_at.
  const anchor = v.expected_at ? new Date(v.expected_at).getTime() : new Date(v.created_at).getTime();
  return anchor >= cutoffMs;
}

type Tab = 'upcoming' | 'history';

function nextDefaultExpectedAt(): string {
  // Default to "in 1 hour", rounded to the nearest 15 minutes — matches what
  // a resident pre-approving a Saturday delivery would type anyway.
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Visitors() {
  const [rows, setRows] = useState<Visitor[]>([]);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [form, setForm] = useState({
    visitor_name: '',
    visitor_type: 'guest',
    expected_at: nextDefaultExpectedAt(),
    notes: '',
    pre_approve: true,
  });
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = () => apiGet<Visitor[]>('/visitors').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  const { upcoming, history } = useMemo(() => {
    const now = Date.now();
    const cutoffMs = now - HISTORY_LOOKBACK_DAYS * 24 * 3600 * 1000;
    const upcoming = rows.filter((v) => isUpcoming(v, now));
    const history = rows
      .filter((v) => isInHistory(v, now, cutoffMs))
      // Show most recent first within history.
      .sort((a, b) => {
        const ax = (a.expected_at ? new Date(a.expected_at).getTime() : new Date(a.created_at).getTime());
        const bx = (b.expected_at ? new Date(b.expected_at).getTime() : new Date(b.created_at).getTime());
        return bx - ax;
      });
    return { upcoming, history };
  }, [rows]);

  const list = tab === 'upcoming' ? upcoming : history;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.visitor_name.trim()) return;
    setSaving(true);
    try {
      const isFuture = form.expected_at && new Date(form.expected_at).getTime() > Date.now();
      const preApprove = form.pre_approve && !!isFuture;
      await apiPost<{ status: string }>('/visitors', {
        visitor_name: form.visitor_name.trim(),
        visitor_type: form.visitor_type,
        expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : null,
        notes: form.notes.trim() || null,
        pre_approve: preApprove,
      });
      toast.success(
        preApprove
          ? 'Visita pré-aprovada — a portaria já tem a liberação'
          : 'Solicitação enviada à portaria',
      );
      setForm({
        visitor_name: '',
        visitor_type: 'guest',
        expected_at: nextDefaultExpectedAt(),
        notes: '',
        pre_approve: true,
      });
      setShowForm(false);
      setTab('upcoming');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao registrar');
    } finally { setSaving(false); }
  }

  const expectedDate = form.expected_at ? new Date(form.expected_at) : null;
  const isFutureExpected = expectedDate && expectedDate.getTime() > Date.now();

  return (
    <>
      <PageHeader
        title="Visitantes"
        subtitle="Avise sobre visitas, entregas ou serviços. A portaria recebe na hora — e você pode pré-aprovar quem vem mais tarde."
        actions={
          <Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'} leftIcon={<Plus className="w-4 h-4" />}>
            {showForm ? 'Cancelar' : 'Novo visitante'}
          </Button>
        }
      />

      {showForm && (
        <GlassCard className="p-6 mb-8 animate-fade-up">
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
            <input
              className="input"
              placeholder="Nome do visitante"
              required
              value={form.visitor_name}
              onChange={(e) => setForm({ ...form, visitor_name: e.target.value })}
            />
            <select
              className="input"
              value={form.visitor_type}
              onChange={(e) => setForm({ ...form, visitor_type: e.target.value })}
            >
              <option value="guest">Visita</option>
              <option value="delivery">Entrega</option>
              <option value="service">Serviço</option>
              <option value="rideshare">Aplicativo</option>
            </select>
            <label className="block text-xs text-dusk-300 font-medium md:col-span-1">
              Quando chega
              <input
                className="input mt-1"
                type="datetime-local"
                value={form.expected_at}
                onChange={(e) => setForm({ ...form, expected_at: e.target.value })}
              />
              <span className="text-[11px] text-dusk-200 mt-1 block">
                Pode marcar pra daqui a horas, dias ou semanas — a portaria fica avisada.
              </span>
            </label>
            <input
              className="input"
              placeholder="Observações (opcional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <label className="md:col-span-2 flex items-start gap-3 p-3 rounded-2xl bg-white/45 border border-white/60 cursor-pointer hover:bg-white/70 transition">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.pre_approve && !!isFutureExpected}
                disabled={!isFutureExpected}
                onChange={(e) => setForm({ ...form, pre_approve: e.target.checked })}
              />
              <div>
                <div className="text-sm font-semibold text-dusk-500">
                  Pré-aprovar a entrada
                </div>
                <div className="text-xs text-dusk-300 mt-0.5">
                  {isFutureExpected
                    ? 'Quando o visitante chegar, a portaria já tem liberação — sem precisar te ligar.'
                    : 'Disponível só para visitas marcadas para o futuro.'}
                </div>
              </div>
            </label>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>
                {form.pre_approve && isFutureExpected ? 'Pré-aprovar visita' : 'Enviar solicitação'}
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Tabs */}
      {(rows.length > 0 || showForm) && (
        <div className="flex gap-2 mb-6 text-sm">
          <button
            type="button"
            onClick={() => setTab('upcoming')}
            className={`px-4 py-2 rounded-full transition flex items-center gap-2 ${
              tab === 'upcoming'
                ? 'bg-dusk-400 text-cream-50 shadow-clay-sm'
                : 'bg-white/40 text-dusk-400 hover:bg-white/60'
            }`}
          >
            <Clock className="w-4 h-4" /> Próximas
            {upcoming.length > 0 && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${tab === 'upcoming' ? 'bg-cream-50/30' : 'bg-dusk-100/40'}`}>
                {upcoming.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-4 py-2 rounded-full transition flex items-center gap-2 ${
              tab === 'history'
                ? 'bg-dusk-400 text-cream-50 shadow-clay-sm'
                : 'bg-white/40 text-dusk-400 hover:bg-white/60'
            }`}
          >
            <HistoryIcon className="w-4 h-4" /> Histórico
            {history.length > 0 && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${tab === 'history' ? 'bg-cream-50/30' : 'bg-dusk-100/40'}`}>
                {history.length}
              </span>
            )}
          </button>
        </div>
      )}

      {rows.length === 0 && !showForm && (
        <EmptyState
          title="Nenhum visitante registrado"
          body="Avise antes para a portaria estar preparada — você pode pré-aprovar para evitar ligação na hora."
          image="/images/clay-key.png"
          action={<Button onClick={() => setShowForm(true)} variant="primary">Adicionar visitante</Button>}
        />
      )}

      {rows.length > 0 && list.length === 0 && (
        <GlassCard className="p-6 text-center text-sm text-dusk-300">
          {tab === 'upcoming'
            ? 'Nada agendado por enquanto. Quando alguém estiver vindo, registre por aqui.'
            : 'Sem histórico nos últimos 90 dias.'}
        </GlassCard>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {list.map((v) => (
          <GlassCard
            key={v.id}
            variant={tab === 'upcoming' ? 'clay' : undefined}
            className={`p-5 flex items-start gap-4 ${tab === 'history' ? 'opacity-90' : ''}`}
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
              v.status === 'arrived' || v.status === 'completed'
                ? 'bg-sage-200 text-sage-700'
                : v.status === 'denied'
                  ? 'bg-peach-100 text-peach-500'
                  : 'bg-sage-200 text-sage-700'
            }`}>
              <DoorOpen className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-dusk-500">{v.visitor_name}</span>
                <Badge tone={
                  v.status === 'approved' ? 'sage'
                  : v.status === 'arrived' || v.status === 'completed' ? 'sage'
                  : v.status === 'pending' ? 'warning'
                  : v.status === 'denied' ? 'peach'
                  : 'neutral'
                }>{STATUS_LABEL[v.status] || v.status}</Badge>
                <Badge tone="neutral">{TYPE_LABEL[v.visitor_type] || v.visitor_type}</Badge>
              </div>
              {v.expected_at && (
                <div className="text-sm text-dusk-300 mt-1">
                  {tab === 'upcoming' ? 'Previsto para ' : 'Esperado em '}{formatDateTime(v.expected_at)}
                </div>
              )}
              {v.notes && <div className="text-sm text-dusk-200 mt-1 italic">"{v.notes}"</div>}
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
