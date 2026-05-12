import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarPlus, CalendarX, Clock, Trophy, Users, Waves, Dumbbell, Flame, PartyPopper } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, currentIntlLocale, t, useLocale } from '../../lib/i18n';

interface Amenity {
  id: number; name: string; description: string; icon: string;
  capacity: number; open_hour: number; close_hour: number;
  slot_minutes: number; booking_window_days: number;
}
interface AmenitySlot {
  starts_at: string;
  ends_at: string;
  reserved_people: number;
  available_spots: number;
  available: boolean;
}
interface Reservation {
  id: number; amenity_id: number; user_id: number;
  amenity_name: string; amenity_icon: string;
  starts_at: string; ends_at: string;
  first_name: string; last_name: string; unit_number: string;
  status: string;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  expected_guests?: number | null;
  guest_list?: string | null;
  notes?: string | null;
}

// "Party" surfaces the guest-list section in the booking form. Catches
// the salão de festas + grill/churrasqueira reservations where the guard
// will see groups of 10+ people coming in for a single resident.
function isPartyAmenity(a: Amenity | null): boolean {
  if (!a) return false;
  const t = `${a.name} ${a.icon || ''}`.toLowerCase();
  return /(party|festa|salão|salao|grill|bbq|churrasc)/.test(t);
}

const ICONS: Record<string, any> = { Waves, Dumbbell, Flame, PartyPopper, Trophy };

function friendlyBookingError(code: string | undefined): string {
  const errors: Record<string, string> = {
    invalid_time: 'Choose valid start and end times.',
    ends_must_be_after_starts: 'End time must be after start time.',
    outside_open_hours: 'Booking must stay within the amenity open hours.',
    amenity_conflict: 'That time conflicts with an existing reservation.',
    outside_booking_window: 'Reservations open Sunday at midday for the current week only.',
  };
  return errors[code || ''] || 'Booking failed';
}

function currentBookingWeek() {
  const now = new Date();
  const openAt = new Date(now);
  openAt.setHours(12, 0, 0, 0);
  openAt.setDate(openAt.getDate() - openAt.getDay());
  if (now < openAt) openAt.setDate(openAt.getDate() - 7);
  const start = new Date(openAt);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const nextOpen = new Date(openAt);
  nextOpen.setDate(nextOpen.getDate() + 7);
  return {
    min: start.toISOString().slice(0, 10),
    max: end.toISOString().slice(0, 10),
    nextOpen,
  };
}

export default function Amenities() {
  const { user } = useAuth();
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [amenities, setAmenities]       = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected]         = useState<Amenity | null>(null);
  const [bookingDate, setBookingDate]   = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots]               = useState<AmenitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AmenitySlot | null>(null);
  const [partySize, setPartySize]       = useState('1');
  const [guestList, setGuestList]       = useState('');
  const [partyNotes, setPartyNotes]     = useState('');
  const [saving, setSaving]             = useState(false);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(false);
  const [reservationView, setReservationView] = useState<'mine' | 'building'>('mine');
  const bookingWeek = currentBookingWeek();

  const load = () => {
    setLoadError(false);
    return Promise.all([
      apiGet<Amenity[]>('/amenities').then(setAmenities),
      apiGet<Reservation[]>('/amenities/reservations').then(setReservations),
    ])
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!selected) {
      setSlots([]);
      setSelectedSlot(null);
      return;
    }
    apiGet<{ slots: AmenitySlot[] }>(`/amenities/${selected.id}/slots?date=${bookingDate}`)
      .then((data) => {
        setSlots(data.slots);
        setSelectedSlot((current) => data.slots.find((s) => s.starts_at === current?.starts_at && s.available) || null);
      })
      .catch(() => {
        setSlots([]);
        setSelectedSlot(null);
      });
  }, [selected, bookingDate]);

  function chooseAmenity(a: Amenity) {
    setSelected(a);
    setSelectedSlot(null);
    setPartySize('1');
    setGuestList('');
    setPartyNotes('');
    const todayKey = new Date().toISOString().slice(0, 10);
    setBookingDate(todayKey < bookingWeek.min || todayKey > bookingWeek.max ? bookingWeek.min : todayKey);
  }

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !selectedSlot) return;
    const groupSize = Math.max(1, Math.min(selected.capacity, parseInt(partySize, 10) || 1));
    if (groupSize > selectedSlot.available_spots) {
      toast.error(`${tr('Esse horário só tem')} ${selectedSlot.available_spots} ${tr('vaga(s) disponível(is).')}`);
      return;
    }
    setSaving(true);
    try {
      const guestsNum = Math.max(0, groupSize - 1);
      await apiPost('/amenities/reservations', {
        amenity_id: selected.id,
        starts_at: selectedSlot.starts_at,
        ends_at:   selectedSlot.ends_at,
        expected_guests: guestsNum,
        guest_list: guestList.trim() || null,
        notes: partyNotes.trim() || null,
      });
      toast.success(
        guestsNum > 0
          ? `${tr('Reserva confirmada para')} ${groupSize} ${tr('pessoas')}`
          : `${tr('Reserva confirmada')}: ${selected.name}`,
      );
      setSelected(null); setSelectedSlot(null); setSlots([]);
      setPartySize('1'); setGuestList(''); setPartyNotes('');
      load();
    } catch (err: any) {
      toast.error(tr(friendlyBookingError(err?.response?.data?.error)));
    } finally { setSaving(false); }
  }

  async function cancelReservation(reservation: Reservation) {
    const reason = prompt(`${tr('Cancelar reserva')}: ${reservation.amenity_name}?`, '');
    if (reason === null) return;
    try {
      await apiDelete(`/amenities/reservations/${reservation.id}`, { reason });
      toast.success(tr('Reserva cancelada'));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || tr('Falha ao cancelar reserva'));
    }
  }

  const future = reservations
    .filter((r) => new Date(r.starts_at) > new Date() && r.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const mine = future.filter((r) => r.user_id === user?.id);
  const visibleReservations = reservationView === 'mine' ? mine : future;

  return (
    <>
      <PageHeader
        title={tr('Áreas comuns')}
        subtitle={tr('Reserve a piscina, academia, churrasqueira ou salão de festas. Sem conflitos.')}
      />

      <section className="mb-10" aria-labelledby="available-amenities">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h2 id="available-amenities" className="font-display text-xl text-dusk-500">{tr('Reservar área comum')}</h2>
            <p className="text-sm text-dusk-300 mt-1">{tr('Escolha um espaço e um horário disponível.')}</p>
            <p className="text-xs text-dusk-200 mt-1">
              {tr('As reservas abrem todo domingo ao meio-dia e valem apenas para a semana em curso.')}
            </p>
          </div>
          {selected && (
            <Badge tone="sage">
              <CalendarPlus className="w-3 h-3" /> {selected.name}
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <GlassCard key={i} variant="clay" className="p-5">
                <div className="w-12 h-12 rounded-2xl bg-white/60 mb-3 animate-pulse" />
                <div className="h-5 rounded bg-white/60 mb-2 animate-pulse" />
                <div className="h-4 rounded bg-white/50 w-4/5 animate-pulse" />
              </GlassCard>
            ))}
          </div>
        ) : loadError ? (
          <GlassCard className="p-6 text-sm text-dusk-300">
            {tr('Não conseguimos carregar as áreas comuns. Atualize a página e tente de novo.')}
          </GlassCard>
        ) : amenities.length === 0 ? (
          <GlassCard className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                <CalendarPlus className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display text-lg text-dusk-500">{tr('Ainda não há áreas reserváveis')}</h3>
                <p className="text-sm text-dusk-300 mt-1 max-w-2xl">
                  {tr('Quando o administrador ativar uma piscina, academia, quadra ou salão, você poderá reservar um horário nesta página.')}
                </p>
              </div>
            </div>
          </GlassCard>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {amenities.map((a) => {
              const Icon = ICONS[a.icon] || Waves;
              const active = selected?.id === a.id;
              return (
                <GlassCard key={a.id} variant="clay" hover className={`p-5 ${active ? 'ring-2 ring-sage-300' : ''}`} data-testid="amenity-card">
                  <button
                    type="button"
                    className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 rounded-2xl"
                    onClick={() => chooseAmenity(a)}
                    aria-label={`${tr('Reservar')} ${a.name}`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mb-3">
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="font-display text-lg text-dusk-500">{a.name}</h3>
                    <p className="text-sm text-dusk-300 mt-1 line-clamp-2">{a.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-200">
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {a.open_hour}h-{a.close_hour}h</span>
                      <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {a.capacity}</span>
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant={active ? 'primary' : 'ghost'}
                    size="sm"
                    className="mt-4 w-full"
                    leftIcon={<CalendarPlus className="w-4 h-4" />}
                    onClick={() => chooseAmenity(a)}
                  >
                    {tr('Reservar')}
                  </Button>
                </GlassCard>
              );
            })}
          </div>
        )}
      </section>

      {selected && (
        <GlassCard className="p-6 mb-10 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl text-dusk-500">{tr('Reservar')}: {selected.name}</h3>
            <button className="text-sm text-dusk-200 hover:text-dusk-400" onClick={() => setSelected(null)}>{tr('Cancelar')}</button>
          </div>
          <form onSubmit={book} noValidate className="space-y-4" data-testid="amenity-booking-form">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs text-dusk-300">
                {tr('Data')}
                <input
                  type="date"
                  className="input mt-1"
                  data-testid="amenity-date"
                  value={bookingDate}
                  min={bookingWeek.min}
                  max={bookingWeek.max}
                  onChange={(e) => setBookingDate(e.target.value)}
                  required
                />
              </label>
              <label className="text-xs text-dusk-300">
                {tr('Pessoas na reserva')}
                <input
                  type="number"
                  min={1}
                  max={selected.capacity}
                  className="input mt-1"
                  data-testid="amenity-party-size"
                  value={partySize}
                  onChange={(e) => setPartySize(e.target.value)}
                />
              </label>
            </div>

            <div>
              <div className="text-xs text-dusk-300 mb-2">{tr('Horários disponíveis')} · {tr('slots de')} {selected.slot_minutes} min</div>
              {slots.length === 0 ? (
                <div className="rounded-2xl bg-white/60 border border-white/70 p-4 text-sm text-dusk-300">
                  {tr('Nenhum horário disponível para esta data.')}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {slots.map((slot) => {
                    const active = selectedSlot?.starts_at === slot.starts_at;
                    const start = new Date(slot.starts_at);
                    const end = new Date(slot.ends_at);
                    return (
                      <button
                        key={slot.starts_at}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => setSelectedSlot(slot)}
                        data-testid="amenity-slot"
                        className={`p-3 rounded-2xl border text-left transition ${active ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'} ${slot.available ? 'text-dusk-500' : 'opacity-45 pointer-events-none'}`}
                      >
                        <div className="text-sm font-semibold">
                          {start.toLocaleTimeString(currentIntlLocale(), { hour: '2-digit', minute: '2-digit' })}–{end.toLocaleTimeString(currentIntlLocale(), { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-[11px] text-dusk-300">
                          {slot.available_spots === 0
                            ? tr('Reservado')
                            : `${slot.available_spots}/${selected.capacity} ${tr('lugares disponíveis')}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {isPartyAmenity(selected) && (
              <div className="p-4 rounded-2xl bg-peach-100/40 border border-peach-200">
                <div className="flex items-center gap-2 mb-2">
                  <PartyPopper className="w-4 h-4 text-peach-600" />
                  <span className="text-sm font-semibold text-dusk-500">{tr('Vai ter festa? Avise a portaria.')}</span>
                </div>
                <p className="text-xs text-dusk-300 mb-3">
                  {tr('Quantos convidados e quem são. O porteiro libera por nome — sem ligação na hora.')}
                </p>
                <div className="grid sm:grid-cols-1 gap-3">
                  <label className="text-xs text-dusk-300">
                    {tr('Observações para a portaria (opcional)')}
                    <input
                      className="input mt-1"
                      placeholder={tr('ex: aniversário, fornecedor de buffet às 18h')}
                      maxLength={300}
                      value={partyNotes}
                      onChange={(e) => setPartyNotes(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block text-xs text-dusk-300 mt-3">
                  {tr('Lista de convidados (um nome por linha)')}
                  <textarea
                    className="input mt-1 min-h-[110px] font-mono text-[13px]"
                    placeholder={tr('Ana Souza\nBruno Lima\nCarla Ferreira\n…')}
                    maxLength={4000}
                    value={guestList}
                    onChange={(e) => setGuestList(e.target.value)}
                  />
                  <span className="text-[11px] text-dusk-200 mt-1 block">
                    {tr('A portaria recebe a lista no dia. Pode editar até a hora da festa.')}
                  </span>
                </label>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saving} disabled={!selectedSlot} data-testid="amenity-submit">
                {parseInt(partySize, 10) > 1
                  ? tr('Reservar e avisar portaria')
                  : tr('Confirmar reserva')}
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-dusk-500">{tr('Próximas reservas')}</h2>
          <p className="text-sm text-dusk-300 mt-1">{tr('Acompanhe suas reservas separadas do calendário geral do prédio.')}</p>
        </div>
        <div className="inline-flex rounded-full bg-white/60 border border-white/70 p-1">
          <button
            type="button"
            onClick={() => setReservationView('mine')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${reservationView === 'mine' ? 'bg-dusk-400 text-cream-50' : 'text-dusk-300 hover:text-dusk-500'}`}
          >
            {tr('Minhas reservas')}
          </button>
          <button
            type="button"
            onClick={() => setReservationView('building')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${reservationView === 'building' ? 'bg-dusk-400 text-cream-50' : 'text-dusk-300 hover:text-dusk-500'}`}
          >
            {tr('Reservas do prédio')}
          </button>
        </div>
      </div>
      {visibleReservations.length === 0 ? (
        <GlassCard className="p-6 text-sm text-dusk-300">{tr('Nenhuma reserva futura no prédio.')}</GlassCard>
      ) : (
        <div className="space-y-3">
          {visibleReservations.map((r) => {
            const Icon = ICONS[r.amenity_icon] || Waves;
            const isMine = r.user_id === user?.id;
            return (
              <GlassCard key={r.id} className="p-4 flex flex-col gap-4 sm:flex-row sm:items-center" data-testid={`resident-amenity-reservation-${r.id}`}>
                <div className="w-10 h-10 rounded-xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-dusk-500">{r.amenity_name}</span>
                    {isMine && <Badge tone="sage">{tr('Você')}</Badge>}
                    {(r.expected_guests || 0) > 0 && (
                      <Badge tone="peach"><Users className="w-3 h-3" /> {(r.expected_guests || 0) + 1} {tr('pessoas')}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-dusk-200">{formatDateTime(r.starts_at)} · {r.first_name} {r.last_name} ({tr('Unidade')} {r.unit_number})</div>
                  {r.cancel_reason && (
                    <div className="text-[11px] text-peach-600 mt-1">
                      {tr('Motivo do cancelamento')}: {r.cancel_reason}
                    </div>
                  )}
                  {isMine && r.guest_list && (
                    <div className="text-[11px] text-dusk-300 mt-1 italic line-clamp-1">
                      {tr('Lista')}: {r.guest_list.split('\n').filter(Boolean).slice(0, 3).join(', ')}
                      {r.guest_list.split('\n').filter(Boolean).length > 3 && '…'}
                    </div>
                  )}
                </div>
                {isMine && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<CalendarX className="w-4 h-4" />}
                    onClick={() => cancelReservation(r)}
                  >
                    {tr('Cancelar reserva')}
                  </Button>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </>
  );
}
