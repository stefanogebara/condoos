import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, DoorOpen, Plus, Clock, History as HistoryIcon, PartyPopper, Repeat2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import EmptyState from '../../components/EmptyState';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { formatDateTime, t } from '../../lib/i18n';

interface Visitor {
  id: number;
  visitor_name: string;
  visitor_type: string;
  status: 'pending' | 'approved' | 'denied' | 'arrived' | 'completed';
  expected_at: string | null;
  notes: string | null;
  created_at: string;
  expected_guests?: number | null;
  guest_list?: string | null;
  recurring_days?: string | null;
  recurring_until?: string | null;
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
type FormMode = 'single' | 'party';

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
    mode: 'single' as FormMode,
    visitor_name: '',
    visitor_type: 'guest',
    expected_at: nextDefaultExpectedAt(),
    notes: '',
    pre_approve: true,
    expected_guests: '0',
    guest_list: '',
    recurring: false,
    recurring_days: [] as number[],
    recurring_until: '',
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
  const reusableVisitors = useMemo(() => {
    const seen = new Set<string>();
    return rows
      .filter((v) => !v.guest_list)
      .sort((a, b) => new Date(b.expected_at || b.created_at).getTime() - new Date(a.expected_at || a.created_at).getTime())
      .filter((v) => {
        const key = `${v.visitor_name.toLowerCase()}|${v.visitor_type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }, [rows]);

  function resetForm(next?: Partial<typeof form>) {
    setForm({
      mode: 'single',
      visitor_name: '',
      visitor_type: 'guest',
      expected_at: nextDefaultExpectedAt(),
      notes: '',
      pre_approve: true,
      expected_guests: '0',
      guest_list: '',
      recurring: false,
      recurring_days: [],
      recurring_until: '',
      ...next,
    });
  }

  function reuseVisitor(v: Visitor) {
    resetForm({
      mode: 'single',
      visitor_name: v.visitor_name,
      visitor_type: v.visitor_type,
      notes: v.notes || '',
      expected_at: nextDefaultExpectedAt(),
      pre_approve: true,
    });
    setShowForm(true);
    setTab('upcoming');
  }

  function toggleRecurringDay(day: number) {
    setForm((current) => {
      const exists = current.recurring_days.includes(day);
      const recurring_days = exists
        ? current.recurring_days.filter((d) => d !== day)
        : [...current.recurring_days, day].sort((a, b) => a - b);
      return { ...current, recurring_days };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.visitor_name.trim()) return;
    setSaving(true);
    try {
      const isFuture = form.expected_at && new Date(form.expected_at).getTime() > Date.now();
      const isParty = form.mode === 'party';
      const preApprove = (form.pre_approve && !!isFuture) || isParty || form.recurring;
      const guestNames = form.guest_list.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      await apiPost<{ status: string }>('/visitors', {
        visitor_name: form.visitor_name.trim(),
        visitor_type: isParty ? 'guest' : form.visitor_type,
        expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : null,
        notes: form.notes.trim() || null,
        pre_approve: preApprove,
        expected_guests: isParty ? Math.max(guestNames.length, parseInt(form.expected_guests, 10) || 0) : 0,
        guest_list: isParty ? guestNames.join('\n') : null,
        recurring_days: form.recurring ? form.recurring_days : [],
        recurring_until: form.recurring && form.recurring_until ? new Date(`${form.recurring_until}T23:59:00`).toISOString() : null,
      });
      toast.success(
        isParty
          ? t('Festa registrada — a portaria recebeu a lista')
          : preApprove
          ? t('Visita pré-aprovada — a portaria já tem a liberação')
          : t('Solicitação enviada à portaria'),
      );
      resetForm();
      setShowForm(false);
      setTab('upcoming');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao registrar'));
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
            <div className="md:col-span-2 inline-flex rounded-full bg-white/60 border border-white/70 p-1 w-fit">
              {([
                ['single', t('Visitante')],
                ['party', t('Festa')],
              ] as Array<[FormMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm({ ...form, mode, visitor_name: mode === 'party' && !form.visitor_name ? t('Festa / evento') : form.visitor_name })}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition ${form.mode === mode ? 'bg-dusk-400 text-cream-50' : 'text-dusk-300 hover:text-dusk-500'}`}
                >
                  {mode === 'party' ? <PartyPopper className="inline w-4 h-4 mr-1" /> : <DoorOpen className="inline w-4 h-4 mr-1" />}
                  {label}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder={form.mode === 'party' ? t('Nome da festa ou evento') : t('Nome do visitante')}
              required
              value={form.visitor_name}
              onChange={(e) => setForm({ ...form, visitor_name: e.target.value })}
            />
            {form.mode === 'single' ? (
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
            ) : (
              <input
                className="input"
                type="number"
                min={0}
                max={500}
                placeholder={t('Quantidade de convidados')}
                value={form.expected_guests}
                onChange={(e) => setForm({ ...form, expected_guests: e.target.value })}
              />
            )}
            <label className="block text-xs text-dusk-300 font-medium md:col-span-1">
              {form.mode === 'party' ? t('Quando começa') : t('Quando chega')}
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
              placeholder={t('Observações (opcional)')}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            {form.mode === 'party' && (
              <label className="md:col-span-2 block text-xs text-dusk-300">
                {t('Lista de participantes (um nome por linha)')}
                <textarea
                  className="input mt-1 min-h-[130px] font-mono text-[13px]"
                  placeholder={'Ana Souza\nBruno Lima\nCarla Ferreira'}
                  value={form.guest_list}
                  onChange={(e) => setForm({ ...form, guest_list: e.target.value })}
                  maxLength={4000}
                />
                <span className="text-[11px] text-dusk-200 mt-1 block">{t('A portaria vê esta lista e libera por nome.')}</span>
              </label>
            )}
            {form.mode === 'single' && (
              <>
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
                      {t('Pré-aprovar entrada')}
                    </div>
                    <div className="text-xs text-dusk-300 mt-0.5">
                      {isFutureExpected
                        ? t('Quando chegar, a portaria já tem liberação — sem precisar te ligar.')
                        : t('Disponível só para visitas marcadas para o futuro.')}
                    </div>
                  </div>
                </label>
                <div className="md:col-span-2 p-3 rounded-2xl bg-white/45 border border-white/60">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form.recurring}
                      onChange={(e) => setForm({ ...form, recurring: e.target.checked })}
                    />
                    <div>
                      <div className="text-sm font-semibold text-dusk-500 flex items-center gap-2"><Repeat2 className="w-4 h-4" /> {t('Visitante recorrente')}</div>
                      <div className="text-xs text-dusk-300 mt-0.5">{t('Permite entrada em dias específicos, usando a hora marcada acima.')}</div>
                    </div>
                  </label>
                  {form.recurring && (
                    <div className="mt-3 grid md:grid-cols-[1fr_180px] gap-3">
                      <div className="flex flex-wrap gap-2">
                        {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((label, day) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => toggleRecurringDay(day)}
                            className={`px-3 py-2 rounded-full text-xs font-semibold transition ${form.recurring_days.includes(day) ? 'bg-sage-200 text-sage-800' : 'bg-white/60 text-dusk-300 hover:bg-white/80'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label className="text-xs text-dusk-300">
                        {t('Até')}
                        <input className="input mt-1" type="date" value={form.recurring_until} onChange={(e) => setForm({ ...form, recurring_until: e.target.value })} />
                      </label>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>
                {form.mode === 'party'
                  ? t('Registrar festa')
                  : form.recurring
                    ? t('Salvar visitante recorrente')
                    : form.pre_approve && isFutureExpected ? t('Pré-aprovar visita') : t('Enviar solicitação')}
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      {showForm && reusableVisitors.length > 0 && (
        <GlassCard className="p-5 mb-8">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-dusk-500">
            <HistoryIcon className="w-4 h-4" /> {t('Visitantes anteriores')}
          </div>
          <div className="flex flex-wrap gap-2">
            {reusableVisitors.map((v) => (
              <button
                key={`${v.visitor_name}-${v.visitor_type}-${v.id}`}
                type="button"
                onClick={() => reuseVisitor(v)}
                className="px-3 py-2 rounded-full bg-white/60 border border-white/70 text-sm text-dusk-400 hover:bg-white/80"
              >
                {v.visitor_name}
              </button>
            ))}
          </div>
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
                <Badge tone="neutral">{t(TYPE_LABEL[v.visitor_type] || v.visitor_type)}</Badge>
                {v.guest_list && <Badge tone="peach"><PartyPopper className="w-3 h-3" /> {t('Festa')}</Badge>}
                {v.recurring_days && <Badge tone="sage"><Repeat2 className="w-3 h-3" /> {t('recorrente')}</Badge>}
              </div>
              {v.expected_at && (
                <div className="text-sm text-dusk-300 mt-1">
                  {tab === 'upcoming' ? 'Previsto para ' : 'Esperado em '}{formatDateTime(v.expected_at)}
                </div>
              )}
              {v.notes && <div className="text-sm text-dusk-200 mt-1 italic">"{v.notes}"</div>}
              {v.guest_list && (
                <details className="mt-2">
                  <summary className="text-xs text-dusk-400 underline decoration-dotted underline-offset-4 cursor-pointer">
                    {t('Lista de participantes')} ({v.guest_list.split('\n').filter(Boolean).length})
                  </summary>
                  <pre className="mt-2 p-2 rounded-xl bg-white/50 text-xs text-dusk-400 whitespace-pre-wrap font-sans">{v.guest_list}</pre>
                </details>
              )}
              {v.recurring_days && (
                <div className="text-xs text-dusk-300 mt-2 flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  {v.recurring_days.split(',').map((d) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][Number(d)]).filter(Boolean).join(', ')}
                  {v.recurring_until ? ` · ${t('Até').toLowerCase()} ${formatDateTime(v.recurring_until).split(',')[0]}` : ''}
                </div>
              )}
              {tab === 'history' && !v.guest_list && (
                <Button size="sm" variant="ghost" className="mt-3" onClick={() => reuseVisitor(v)}>
                  {t('Usar de novo')}
                </Button>
              )}
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
