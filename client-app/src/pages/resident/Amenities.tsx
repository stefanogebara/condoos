import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Clock, Trophy, Users, Waves, Dumbbell, Flame, PartyPopper } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/i18n';

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
  };
  return errors[code || ''] || 'Booking failed';
}

export default function Amenities() {
  const { user } = useAuth();
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

  const load = () => Promise.all([
    apiGet<Amenity[]>('/amenities').then(setAmenities),
    apiGet<Reservation[]>('/amenities/reservations').then(setReservations),
  ]).catch(() => {});
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
    setBookingDate(new Date().toISOString().slice(0, 10));
  }

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !selectedSlot) return;
    const groupSize = Math.max(1, Math.min(selected.capacity, parseInt(partySize, 10) || 1));
    if (groupSize > selectedSlot.available_spots) {
      toast.error(`Esse horário só tem ${selectedSlot.available_spots} vaga(s) disponível(is).`);
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
          ? `Reserva confirmada para ${groupSize} pessoas`
          : `Reserva confirmada: ${selected.name}`,
      );
      setSelected(null); setSelectedSlot(null); setSlots([]);
      setPartySize('1'); setGuestList(''); setPartyNotes('');
      load();
    } catch (err: any) {
      toast.error(friendlyBookingError(err?.response?.data?.error));
    } finally { setSaving(false); }
  }

  const future = reservations
    .filter((r) => new Date(r.starts_at) > new Date() && r.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <>
      <PageHeader title="Áreas comuns" subtitle="Reserve a piscina, academia, churrasqueira ou salão de festas. Sem conflitos." />

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {amenities.map((a) => {
          const Icon = ICONS[a.icon] || Waves;
          return (
            <GlassCard key={a.id} variant="clay" hover className="p-5 cursor-pointer" onClick={() => chooseAmenity(a)}>
              <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mb-3">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-display text-lg text-dusk-500">{a.name}</h3>
              <p className="text-sm text-dusk-300 mt-1 line-clamp-2">{a.description}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-200">
                <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {a.open_hour}h–{a.close_hour}h</span>
                <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {a.capacity}</span>
              </div>
            </GlassCard>
          );
        })}
      </div>

      {selected && (
        <GlassCard className="p-6 mb-10 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl text-dusk-500">Reservar: {selected.name}</h3>
            <button className="text-sm text-dusk-200 hover:text-dusk-400" onClick={() => setSelected(null)}>Cancelar</button>
          </div>
          <form onSubmit={book} noValidate className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs text-dusk-300">
                Data
                <input
                  type="date"
                  className="input mt-1"
                  value={bookingDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBookingDate(e.target.value)}
                  required
                />
              </label>
              <label className="text-xs text-dusk-300">
                Pessoas na reserva
                <input
                  type="number"
                  min={1}
                  max={selected.capacity}
                  className="input mt-1"
                  value={partySize}
                  onChange={(e) => setPartySize(e.target.value)}
                />
              </label>
            </div>

            <div>
              <div className="text-xs text-dusk-300 mb-2">Horários disponíveis · slots de {selected.slot_minutes} min</div>
              {slots.length === 0 ? (
                <div className="rounded-2xl bg-white/60 border border-white/70 p-4 text-sm text-dusk-300">
                  Nenhum horário disponível para esta data.
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
                        className={`p-3 rounded-2xl border text-left transition ${active ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'} ${slot.available ? 'text-dusk-500' : 'opacity-45 pointer-events-none'}`}
                      >
                        <div className="text-sm font-semibold">
                          {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–{end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-[11px] text-dusk-300">{slot.available_spots} vaga(s)</div>
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
                  <span className="text-sm font-semibold text-dusk-500">Vai ter festa? Avise a portaria.</span>
                </div>
                <p className="text-xs text-dusk-300 mb-3">
                  Quantos convidados e quem são. O porteiro libera por nome — sem ligação na hora.
                </p>
                <div className="grid sm:grid-cols-1 gap-3">
                  <label className="text-xs text-dusk-300">
                    Observações para a portaria (opcional)
                    <input
                      className="input mt-1"
                      placeholder="ex: aniversário, fornecedor de buffet às 18h"
                      maxLength={300}
                      value={partyNotes}
                      onChange={(e) => setPartyNotes(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block text-xs text-dusk-300 mt-3">
                  Lista de convidados (um nome por linha)
                  <textarea
                    className="input mt-1 min-h-[110px] font-mono text-[13px]"
                    placeholder={'Ana Souza\nBruno Lima\nCarla Ferreira\n…'}
                    maxLength={4000}
                    value={guestList}
                    onChange={(e) => setGuestList(e.target.value)}
                  />
                  <span className="text-[11px] text-dusk-200 mt-1 block">
                    A portaria recebe a lista no dia. Pode editar até a hora da festa.
                  </span>
                </label>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saving} disabled={!selectedSlot}>
                {parseInt(partySize, 10) > 1
                  ? 'Reservar e avisar portaria'
                  : 'Confirmar reserva'}
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      <h2 className="font-display text-xl text-dusk-500 mb-4">Próximas reservas</h2>
      {future.length === 0 ? (
        <GlassCard className="p-6 text-sm text-dusk-300">Nenhuma reserva futura no prédio.</GlassCard>
      ) : (
        <div className="space-y-3">
          {future.map((r) => {
            const Icon = ICONS[r.amenity_icon] || Waves;
            const mine = r.user_id === user?.id;
            return (
              <GlassCard key={r.id} className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-dusk-500">{r.amenity_name}</span>
                    {mine && <Badge tone="sage">Você</Badge>}
                    {(r.expected_guests || 0) > 0 && (
                      <Badge tone="peach"><Users className="w-3 h-3" /> {(r.expected_guests || 0) + 1} pessoas</Badge>
                    )}
                  </div>
                  <div className="text-xs text-dusk-200">{formatDateTime(r.starts_at)} · {r.first_name} {r.last_name} (Unidade {r.unit_number})</div>
                  {mine && r.guest_list && (
                    <div className="text-[11px] text-dusk-300 mt-1 italic line-clamp-1">
                      Lista: {r.guest_list.split('\n').filter(Boolean).slice(0, 3).join(', ')}
                      {r.guest_list.split('\n').filter(Boolean).length > 3 && '…'}
                    </div>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </>
  );
}
