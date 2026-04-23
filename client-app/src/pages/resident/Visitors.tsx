import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { DoorOpen, Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import EmptyState from '../../components/EmptyState';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';

interface Visitor {
  id: number;
  visitor_name: string;
  visitor_type: string;
  status: 'pending' | 'approved' | 'denied' | 'arrived' | 'completed';
  expected_at: string | null;
  notes: string | null;
  created_at: string;
}

export default function Visitors() {
  const [rows, setRows] = useState<Visitor[]>([]);
  const [form, setForm] = useState({ visitor_name: '', visitor_type: 'guest', expected_at: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = () => apiGet<Visitor[]>('/visitors').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.visitor_name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/visitors', {
        ...form,
        expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : null,
      });
      toast.success('Visitor request sent to the front desk');
      setForm({ visitor_name: '', visitor_type: 'guest', expected_at: '', notes: '' });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="Visitors"
        subtitle="Request guests, deliveries, or services. The front desk is notified instantly."
        actions={
          <Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'} leftIcon={<Plus className="w-4 h-4" />}>
            {showForm ? 'Cancel' : 'New visitor'}
          </Button>
        }
      />

      {showForm && (
        <GlassCard className="p-6 mb-8 animate-fade-up">
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
            <input className="input" placeholder="Visitor name"   required value={form.visitor_name} onChange={(e) => setForm({ ...form, visitor_name: e.target.value })} />
            <select className="input" value={form.visitor_type} onChange={(e) => setForm({ ...form, visitor_type: e.target.value })}>
              <option value="guest">Guest</option>
              <option value="delivery">Delivery</option>
              <option value="service">Service</option>
              <option value="rideshare">Rideshare</option>
            </select>
            <input className="input" type="datetime-local" value={form.expected_at} onChange={(e) => setForm({ ...form, expected_at: e.target.value })} />
            <input className="input" placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>Submit request</Button>
            </div>
          </form>
        </GlassCard>
      )}

      {rows.length === 0 && !showForm && (
        <EmptyState title="No visitors on file" body="Request guests or schedule services in advance so the front desk is ready." image="/images/clay-key.png" action={<Button onClick={() => setShowForm(true)} variant="primary">Add a visitor</Button>} />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((v) => (
          <GlassCard key={v.id} variant="clay" className="p-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-sage-200 flex items-center justify-center shrink-0">
              <DoorOpen className="w-6 h-6 text-sage-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-dusk-500">{v.visitor_name}</span>
                <Badge tone={v.status === 'approved' ? 'sage' : v.status === 'pending' ? 'warning' : 'neutral'}>{v.status}</Badge>
                <Badge tone="neutral">{v.visitor_type}</Badge>
              </div>
              {v.expected_at && <div className="text-sm text-dusk-300 mt-1">Expected {new Date(v.expected_at).toLocaleString()}</div>}
              {v.notes && <div className="text-sm text-dusk-200 mt-1 italic">"{v.notes}"</div>}
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
