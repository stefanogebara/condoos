import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Waves, Dumbbell, Flame, PartyPopper } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Amenity { id: number; name: string; description: string; icon: string; capacity: number; open_hour: number; close_hour: number; }
interface Reservation { id: number; amenity_id: number; user_id: number; amenity_name: string; amenity_icon: string; starts_at: string; ends_at: string; first_name: string; last_name: string; unit_number: string; status: string; }

const ICONS: Record<string, any> = { Waves, Dumbbell, Flame, PartyPopper };

export default function Amenities() {
  const { user } = useAuth();
  const [amenities, setAmenities]       = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected]         = useState<Amenity | null>(null);
  const [starts, setStarts]             = useState('');
  const [ends,   setEnds]               = useState('');
  const [saving, setSaving]             = useState(false);

  const load = () => Promise.all([
    apiGet<Amenity[]>('/amenities').then(setAmenities),
    apiGet<Reservation[]>('/amenities/reservations').then(setReservations),
  ]).catch(() => {});
  useEffect(() => { load(); }, []);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !starts || !ends) return;
    setSaving(true);
    try {
      await apiPost('/amenities/reservations', {
        amenity_id: selected.id,
        starts_at: new Date(starts).toISOString(),
        ends_at:   new Date(ends).toISOString(),
      });
      toast.success(`Booked ${selected.name}`);
      setSelected(null); setStarts(''); setEnds('');
      load();
    } finally { setSaving(false); }
  }

  const myReservations = reservations.filter((r) => r.user_id === user?.id && r.status !== 'cancelled');
  const future = reservations
    .filter((r) => new Date(r.starts_at) > new Date() && r.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <>
      <PageHeader title="Amenities" subtitle="Book the pool, gym, grill, or party room. We prevent conflicts for you." />

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {amenities.map((a) => {
          const Icon = ICONS[a.icon] || Waves;
          return (
            <GlassCard key={a.id} variant="clay" hover className="p-5 cursor-pointer" onClick={() => setSelected(a)}>
              <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mb-3">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-display text-lg text-dusk-500">{a.name}</h3>
              <p className="text-sm text-dusk-300 mt-1 line-clamp-2">{a.description}</p>
              <div className="mt-3 text-xs text-dusk-200">Open {a.open_hour}:00 – {a.close_hour}:00</div>
            </GlassCard>
          );
        })}
      </div>

      {selected && (
        <GlassCard className="p-6 mb-10 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl text-dusk-500">Book: {selected.name}</h3>
            <button className="text-sm text-dusk-200 hover:text-dusk-400" onClick={() => setSelected(null)}>Cancel</button>
          </div>
          <form onSubmit={book} className="grid md:grid-cols-2 gap-3">
            <label className="text-xs text-dusk-300">Starts
              <input type="datetime-local" className="input mt-1" value={starts} onChange={(e) => setStarts(e.target.value)} required />
            </label>
            <label className="text-xs text-dusk-300">Ends
              <input type="datetime-local" className="input mt-1" value={ends}   onChange={(e) => setEnds(e.target.value)}   required />
            </label>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>Confirm booking</Button>
            </div>
          </form>
        </GlassCard>
      )}

      <h2 className="font-display text-xl text-dusk-500 mb-4">Upcoming reservations</h2>
      {future.length === 0 ? (
        <GlassCard className="p-6 text-sm text-dusk-300">No upcoming reservations in the building.</GlassCard>
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
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-dusk-500">{r.amenity_name}</span>
                    {mine && <Badge tone="sage">You</Badge>}
                  </div>
                  <div className="text-xs text-dusk-200">{new Date(r.starts_at).toLocaleString()} · {r.first_name} {r.last_name} (Unit {r.unit_number})</div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </>
  );
}
