import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, Clock, Dumbbell, Flame, PartyPopper, Pencil, Plus, Save, Trash2, Trophy, Users, Waves, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDateTime, t } from '../../lib/i18n';

interface Amenity {
  id: number;
  name: string;
  description: string;
  icon: string;
  capacity: number;
  open_hour: number;
  close_hour: number;
  slot_minutes: number;
  booking_window_days: number;
  active: number;
  admin_notes?: string | null;
}

interface Reservation {
  id: number;
  amenity_id: number;
  user_id: number;
  amenity_name: string;
  amenity_icon: string;
  starts_at: string;
  ends_at: string;
  first_name: string;
  last_name: string;
  unit_number: string;
  status: string;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  expected_guests?: number | null;
  guest_list?: string | null;
  notes?: string | null;
}

type AmenityForm = Omit<Amenity, 'id' | 'active'> & { active?: boolean };

const ICONS: Record<string, any> = { Waves, Dumbbell, Flame, PartyPopper, Trophy };
const ICON_OPTIONS = [
  { icon: 'Dumbbell', label: 'Gym', Icon: Dumbbell },
  { icon: 'Waves', label: 'Pool', Icon: Waves },
  { icon: 'Trophy', label: 'Court', Icon: Trophy },
  { icon: 'Flame', label: 'Grill', Icon: Flame },
  { icon: 'PartyPopper', label: 'Party', Icon: PartyPopper },
];

const PRESETS: AmenityForm[] = [
  { name: 'Gym', description: 'Weights, cardio and stretching area', icon: 'Dumbbell', capacity: 20, open_hour: 5, close_hour: 23, slot_minutes: 60, booking_window_days: 14, admin_notes: '' },
  { name: 'Padel Court', description: 'Reservation by court, up to four players', icon: 'Trophy', capacity: 4, open_hour: 7, close_hour: 22, slot_minutes: 90, booking_window_days: 14, admin_notes: '' },
  { name: 'Football Field', description: 'Shared field reservation for one group', icon: 'Trophy', capacity: 14, open_hour: 8, close_hour: 22, slot_minutes: 90, booking_window_days: 14, admin_notes: '' },
  { name: 'Basketball Court', description: 'Half-court or full-court booking', icon: 'Trophy', capacity: 10, open_hour: 7, close_hour: 22, slot_minutes: 60, booking_window_days: 14, admin_notes: '' },
  { name: 'Tennis Court', description: 'Singles or doubles court booking', icon: 'Trophy', capacity: 4, open_hour: 7, close_hour: 22, slot_minutes: 60, booking_window_days: 14, admin_notes: '' },
  { name: 'Pool', description: 'Pool deck and swimming area', icon: 'Waves', capacity: 30, open_hour: 7, close_hour: 22, slot_minutes: 60, booking_window_days: 14, admin_notes: '' },
  { name: 'Party Room', description: 'Event room with kitchen and tables', icon: 'PartyPopper', capacity: 40, open_hour: 9, close_hour: 23, slot_minutes: 180, booking_window_days: 60, admin_notes: 'Residents should add guest names for concierge access.' },
];

const blankForm: AmenityForm = {
  name: '',
  description: '',
  icon: 'Trophy',
  capacity: 4,
  open_hour: 8,
  close_hour: 22,
  slot_minutes: 60,
  booking_window_days: 14,
  admin_notes: '',
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function normalize(form: AmenityForm) {
  const slot = clamp(Math.round((form.slot_minutes || 60) / 15) * 15, 15, 240);
  return {
    ...form,
    name: form.name.trim(),
    description: form.description.trim(),
    capacity: clamp(Math.trunc(form.capacity || 1), 1, 500),
    open_hour: clamp(Math.trunc(form.open_hour || 0), 0, 23),
    close_hour: clamp(Math.trunc(form.close_hour || 1), 1, 24),
    slot_minutes: slot,
    booking_window_days: 7,
    admin_notes: form.admin_notes?.trim() || '',
  };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sameDay(value: string, date: Date) {
  return dateKey(new Date(value)) === dateKey(date);
}

function timeRange(startsAt: string, endsAt: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  return `${new Date(startsAt).toLocaleTimeString(undefined, opts)}-${new Date(endsAt).toLocaleTimeString(undefined, opts)}`;
}

function generatedSlots(form: AmenityForm) {
  const clean = normalize(form);
  const slots: string[] = [];
  for (let minute = clean.open_hour * 60; minute + clean.slot_minutes <= clean.close_hour * 60; minute += clean.slot_minutes) {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    const end = minute + clean.slot_minutes;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}-${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`);
  }
  return slots;
}

export default function BoardAmenities() {
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  async function load() {
    setLoading(true);
    try {
      const [amenityRows, reservationRows] = await Promise.all([
        apiGet<Amenity[]>('/amenities?include_inactive=1'),
        apiGet<Reservation[]>('/amenities/reservations'),
      ]);
      setAmenities(amenityRows);
      setReservations(reservationRows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const activeCount = amenities.filter((a) => a.active).length;
  const upcomingReservations = reservations
    .filter((r) => r.status !== 'cancelled' && new Date(r.ends_at) > new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <>
      <PageHeader
        title={t('Áreas comuns')}
        subtitle={loading ? t('Carregando…') : `${activeCount} ${t('ativas')} · ${amenities.length} ${t('cadastradas para reserva')}`}
        actions={
          <Button
            variant={showNew ? 'ghost' : 'primary'}
            onClick={() => setShowNew((x) => !x)}
            leftIcon={showNew ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showNew ? t('Cancelar') : t('Nova área')}
          </Button>
        }
      />

      {showNew && (
        <AmenityEditor
          mode="create"
          initial={blankForm}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}

      <GlassCard className="p-5 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl text-dusk-500">{t('Adicionar por modelo')}</h2>
            <p className="text-sm text-dusk-300 mt-1">{t('Comece com um padrão e ajuste capacidade, horários de funcionamento e duração dos slots.')}</p>
          </div>
          <Badge tone="sage">{t('capacidade = pessoas por slot')}</Badge>
        </div>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {PRESETS.map((preset) => {
            const Icon = ICONS[preset.icon] || Trophy;
            return (
              <button
                type="button"
                key={preset.name}
                onClick={() => { setShowNew(true); window.setTimeout(() => window.dispatchEvent(new CustomEvent('condoos:preset-amenity', { detail: preset })), 0); }}
                className="p-3 rounded-2xl bg-white/60 border border-white/70 text-left hover:bg-white/80 transition"
              >
                <div className="flex items-center gap-2 text-dusk-500 font-semibold">
                  <Icon className="w-4 h-4" /> {t(preset.name)}
                </div>
                <div className="text-xs text-dusk-300 mt-1">{preset.capacity} {t('pessoas')} · {preset.slot_minutes} min</div>
              </button>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-5 mb-5" data-testid="admin-amenity-reservations">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="font-display text-xl text-dusk-500">{t('Próximas reservas')}</h2>
            <p className="text-sm text-dusk-300 mt-1">{t('Veja quem reservou áreas comuns e cancele quando houver erro ou conflito.')}</p>
          </div>
          <Badge tone="sage">{upcomingReservations.length} {t('ativas')}</Badge>
        </div>
        {upcomingReservations.length === 0 ? (
          <div className="rounded-2xl bg-white/60 border border-white/70 p-4 text-sm text-dusk-300">
            {t('Nenhuma reserva futura no prédio.')}
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingReservations.map((reservation) => (
              <ReservationRow key={reservation.id} reservation={reservation} onChanged={load} />
            ))}
          </div>
        )}
      </GlassCard>

      <ReservationWeekCalendar
        weekStart={weekStart}
        reservations={upcomingReservations}
        onPrevious={() => setWeekStart((d) => addDays(d, -7))}
        onNext={() => setWeekStart((d) => addDays(d, 7))}
        onToday={() => setWeekStart(startOfWeek(new Date()))}
      />

      <div className="space-y-4">
        {amenities.map((amenity) => (
          <AmenityRow key={amenity.id} amenity={amenity} onChanged={load} />
        ))}
      </div>

      {!loading && amenities.length === 0 && (
        <GlassCard className="p-6 text-sm text-dusk-300 text-center">
          {t('Nenhuma área comum cadastrada ainda. Crie a primeira para liberar reservas aos moradores.')}
        </GlassCard>
      )}
    </>
  );
}

function ReservationRow({ reservation, onChanged }: { reservation: Reservation; onChanged: () => void }) {
  const Icon = ICONS[reservation.amenity_icon] || Waves;
  const people = 1 + Math.max(0, Number(reservation.expected_guests || 0));

  async function cancel() {
    const reason = prompt(t('Motivo do cancelamento'), '');
    if (reason === null) return;
    try {
      await apiDelete(`/amenities/reservations/${reservation.id}`, { reason });
      toast.success(t('Reserva cancelada'));
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao cancelar reserva'));
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl bg-white/60 border border-white/70 p-4 sm:flex-row sm:items-center"
      data-testid={`admin-amenity-reservation-${reservation.id}`}
    >
      <div className="w-10 h-10 rounded-xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-dusk-500">{t(reservation.amenity_name)}</span>
          <Badge tone="peach"><Users className="w-3 h-3" /> {people} {t('pessoas')}</Badge>
        </div>
        <div className="text-xs text-dusk-300 mt-1">
          {formatDateTime(reservation.starts_at)} · {reservation.first_name} {reservation.last_name} · {t('Unidade')} {reservation.unit_number}
        </div>
        {reservation.guest_list && (
          <div className="text-[11px] text-dusk-300 mt-1 line-clamp-1">
            {t('Lista')}: {reservation.guest_list.split('\n').filter(Boolean).slice(0, 4).join(', ')}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leftIcon={<CalendarX className="w-4 h-4" />}
        onClick={cancel}
      >
        {t('Cancelar')}
      </Button>
    </div>
  );
}

function ReservationWeekCalendar({
  weekStart,
  reservations,
  onPrevious,
  onNext,
  onToday,
}: {
  weekStart: Date;
  reservations: Reservation[];
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <GlassCard className="p-5 mb-5" data-testid="admin-reservation-calendar">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="font-display text-xl text-dusk-500">{t('Calendário da semana')}</h2>
          <p className="text-sm text-dusk-300 mt-1">{t('Veja rapidamente quais horários já estão ocupados.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onPrevious} leftIcon={<ChevronLeft className="w-4 h-4" />}>{t('Anterior')}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onToday}>{t('Hoje')}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onNext} rightIcon={<ChevronRight className="w-4 h-4" />}>{t('Próxima')}</Button>
        </div>
      </div>
      <div className="grid md:grid-cols-7 gap-2">
        {days.map((day) => {
          const dayReservations = reservations.filter((r) => sameDay(r.starts_at, day));
          return (
            <div key={dateKey(day)} className="rounded-2xl bg-white/60 border border-white/70 p-3 min-h-[150px]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.12em] text-dusk-200">{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className="font-semibold text-dusk-500">{day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                </div>
                <Badge tone={dayReservations.length ? 'sage' : 'neutral'}>{dayReservations.length}</Badge>
              </div>
              <div className="space-y-2">
                {dayReservations.length === 0 ? (
                  <div className="text-xs text-dusk-200">{t('Livre')}</div>
                ) : dayReservations.map((r) => (
                  <div key={r.id} className="rounded-xl bg-cream-50/80 border border-white/80 p-2">
                    <div className="text-xs font-semibold text-dusk-500">{timeRange(r.starts_at, r.ends_at)}</div>
                    <div className="text-xs text-dusk-300 truncate">{t(r.amenity_name)}</div>
                    <div className="text-[11px] text-dusk-200 truncate">{r.first_name} {r.last_name}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function AmenityRow({ amenity, onChanged }: { amenity: Amenity; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const Icon = ICONS[amenity.icon] || Trophy;

  async function deactivate() {
    if (!confirm(`${t('Desativar reservas para')} "${amenity.name}"? ${t('Reservas antigas ficam no histórico.')}`)) return;
    try {
      await apiDelete(`/amenities/${amenity.id}`);
      toast.success(t('Área desativada'));
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao desativar'));
    }
  }

  if (editing) {
    return (
      <AmenityEditor
        mode="edit"
        id={amenity.id}
        initial={{
          name: amenity.name,
          description: amenity.description || '',
          icon: amenity.icon || 'Trophy',
          capacity: amenity.capacity,
          open_hour: amenity.open_hour,
          close_hour: amenity.close_hour,
          slot_minutes: amenity.slot_minutes,
          booking_window_days: amenity.booking_window_days,
          active: !!amenity.active,
          admin_notes: amenity.admin_notes || '',
        }}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged(); }}
      />
    );
  }

  return (
    <GlassCard variant="clay" className={`p-5 ${amenity.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
          <Icon className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-xl text-dusk-500">{t(amenity.name)}</h3>
            <Badge tone={amenity.active ? 'sage' : 'neutral'}>{amenity.active ? t('ativa') : t('inativa')}</Badge>
          </div>
          <p className="text-sm text-dusk-300 mt-1">{amenity.description ? t(amenity.description) : t('Sem descrição.')}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-300">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1"><Users className="w-3 h-3" /> {amenity.capacity} {t('pessoas')}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1"><Clock className="w-3 h-3" /> {amenity.open_hour}h-{amenity.close_hour}h · {amenity.slot_minutes} min</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1">{amenity.booking_window_days} {t('dias de antecedência')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="p-2 text-dusk-300 hover:text-dusk-500" title={t('Editar área')} aria-label={`${t('Editar área')} ${amenity.name}`}>
            <Pencil className="w-4 h-4" />
          </button>
          {amenity.active ? (
            <button onClick={deactivate} className="p-2 text-dusk-300 hover:text-peach-600" title={t('Desativar área')} aria-label={`${t('Desativar área')} ${amenity.name}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

function AmenityEditor({
  mode,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit';
  id?: number;
  initial: AmenityForm;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AmenityForm>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function applyPreset(e: Event) {
      const custom = e as CustomEvent<AmenityForm>;
      setForm(custom.detail);
    }
    if (mode === 'create') window.addEventListener('condoos:preset-amenity', applyPreset);
    return () => window.removeEventListener('condoos:preset-amenity', applyPreset);
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = normalize(form);
    if (!body.name) {
      toast.error(t('Dê um nome para a área.'));
      return;
    }
    if (body.close_hour <= body.open_hour) {
      toast.error(t('O horário final precisa ser depois da abertura.'));
      return;
    }
    if (body.slot_minutes > (body.close_hour - body.open_hour) * 60) {
      toast.error(t('O slot precisa caber no horário de funcionamento.'));
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') await apiPost('/amenities', body);
      else await apiPatch(`/amenities/${id}`, body);
      toast.success(mode === 'create' ? t('Área criada') : t('Área atualizada'));
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha ao salvar área'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-5 mb-5 animate-fade-up">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-xl text-dusk-500">{mode === 'create' ? t('Nova área comum') : t('Editar área comum')}</h2>
        <button onClick={onCancel} className="text-dusk-300 hover:text-dusk-500" aria-label={t('Cancelar')}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Nome')}
          <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Tipo visual')}
          <div className="mt-1 grid grid-cols-5 gap-1">
            {ICON_OPTIONS.map(({ icon, label, Icon }) => (
              <button
                key={icon}
                type="button"
                onClick={() => setForm({ ...form, icon })}
                className={`h-11 rounded-2xl border flex items-center justify-center transition ${form.icon === icon ? 'bg-sage-100 border-sage-300 text-sage-700' : 'bg-white/60 border-white/70 text-dusk-300 hover:bg-white/80'}`}
                title={t(label)}
                aria-label={t(label)}
              >
                <Icon className="w-5 h-5" />
              </button>
            ))}
          </div>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Descrição')}
          <input className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={280} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Pessoas por slot')}
          <input type="number" min={1} max={500} className="input mt-1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 1 })} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Duração do slot')}
          <select className="input mt-1" value={form.slot_minutes} onChange={(e) => setForm({ ...form, slot_minutes: parseInt(e.target.value) })}>
            {[30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m} {t('minutos')}</option>)}
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Abre às')}
          <input type="number" min={0} max={23} className="input mt-1" value={form.open_hour} onChange={(e) => setForm({ ...form, open_hour: parseInt(e.target.value) || 0 })} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          {t('Fecha às')}
          <input type="number" min={1} max={24} className="input mt-1" value={form.close_hour} onChange={(e) => setForm({ ...form, close_hour: parseInt(e.target.value) || 1 })} />
        </label>
        <div className="rounded-2xl bg-white/60 border border-white/70 p-4 text-sm text-dusk-300">
          {t('As reservas abrem todo domingo ao meio-dia para a semana em curso. O administrador controla apenas horários, duração e capacidade.')}
        </div>
        <label className="block text-xs text-dusk-300 font-medium">
          Status
          <select className="input mt-1" value={form.active === false ? '0' : '1'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
            <option value="1">{t('Ativa para reservas')}</option>
            <option value="0">{t('Inativa')}</option>
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          {t('Observações internas')}
          <textarea className="input mt-1 min-h-[84px]" value={form.admin_notes || ''} onChange={(e) => setForm({ ...form, admin_notes: e.target.value })} maxLength={600} />
        </label>
        <SlotPreview form={form} />
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>{t('Cancelar')}</Button>
          <Button type="submit" variant="primary" loading={saving} leftIcon={<Save className="w-4 h-4" />}>{t('Salvar')}</Button>
        </div>
      </form>
    </GlassCard>
  );
}

function SlotPreview({ form }: { form: AmenityForm }) {
  const slots = generatedSlots(form);
  return (
    <div className="md:col-span-2 rounded-2xl bg-white/60 border border-white/70 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-dusk-500 mb-3">
        <CalendarDays className="w-4 h-4" /> {t('Prévia de horários')}
      </div>
      {slots.length === 0 ? (
        <div className="text-sm text-dusk-300">{t('Ajuste o horário para criar pelo menos um turno.')}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => (
            <span key={slot} className="rounded-full bg-cream-50 border border-white/80 px-3 py-1 text-xs text-dusk-400">{slot}</span>
          ))}
        </div>
      )}
    </div>
  );
}
