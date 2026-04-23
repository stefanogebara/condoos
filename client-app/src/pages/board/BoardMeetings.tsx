import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Calendar, Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';

interface Meeting { id: number; title: string; scheduled_for: string; agenda: string | null; status: string; ai_summary: string | null; raw_notes: string | null; }

export default function BoardMeetings() {
  const [rows, setRows] = useState<Meeting[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', scheduled_for: '', agenda: '' });
  const [saving, setSaving] = useState(false);

  const load = () => apiGet<Meeting[]>('/meetings').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPost('/meetings', { ...form, scheduled_for: new Date(form.scheduled_for).toISOString() });
      toast.success('Meeting scheduled');
      setForm({ title: '', scheduled_for: '', agenda: '' });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="Meetings"
        subtitle="Schedule board meetings. Paste raw notes after — AI produces recap and action items."
        actions={<Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'} leftIcon={<Plus className="w-4 h-4" />}>{showForm ? 'Cancel' : 'New meeting'}</Button>}
      />

      {showForm && (
        <GlassCard className="p-6 mb-6 animate-fade-up">
          <form onSubmit={create} className="grid md:grid-cols-2 gap-3">
            <input className="input" placeholder="Title (e.g. Q3 Board Meeting)" required value={form.title}         onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="input" type="datetime-local" required                  value={form.scheduled_for}  onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />
            <textarea className="input md:col-span-2 min-h-[90px]" placeholder="Agenda (optional)" value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>Schedule</Button>
            </div>
          </form>
        </GlassCard>
      )}

      <div className="space-y-4">
        {rows.map((m) => (
          <Link key={m.id} to={`/board/meetings/${m.id}`}>
            <GlassCard variant="clay" hover className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                <Calendar className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-lg text-dusk-500">{m.title}</h3>
                  <Badge tone={m.status === 'completed' ? 'sage' : 'peach'}>{m.status}</Badge>
                  {m.ai_summary && <Badge tone="sage">AI recap</Badge>}
                  {m.raw_notes && !m.ai_summary && <Badge tone="warning">notes pending</Badge>}
                </div>
                <div className="text-sm text-dusk-300 mt-1">{new Date(m.scheduled_for).toLocaleString()}</div>
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}
