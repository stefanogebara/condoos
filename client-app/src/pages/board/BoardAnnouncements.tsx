import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Megaphone, Plus, Pin } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';

interface Announcement { id: number; title: string; body: string; pinned: number; source: string; created_at: string; }

export default function BoardAnnouncements() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', pinned: false });
  const [saving, setSaving] = useState(false);

  const load = () => apiGet<Announcement[]>('/announcements').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPost('/announcements', { ...form, pinned: form.pinned ? 1 : 0, source: 'manual' });
      toast.success('Published');
      setForm({ title: '', body: '', pinned: false });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Everything you've sent residents — including AI-drafted ones from meetings and decisions."
        actions={<Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'} leftIcon={<Plus className="w-4 h-4" />}>{showForm ? 'Cancel' : 'New announcement'}</Button>}
      />

      {showForm && (
        <GlassCard className="p-6 mb-6 animate-fade-up">
          <form onSubmit={post} className="space-y-3">
            <input className="input" placeholder="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea className="input min-h-[140px]" placeholder="Write your announcement..." required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-dusk-400">
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
              Pin to top
            </label>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>Publish</Button>
            </div>
          </form>
        </GlassCard>
      )}

      <div className="space-y-4">
        {rows.map((a) => (
          <GlassCard key={a.id} variant={a.pinned ? 'clay-peach' : 'clay'} className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-white/60 flex items-center justify-center shrink-0">
                <Megaphone className="w-5 h-5 text-peach-500" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {a.pinned ? <Badge tone="peach"><Pin className="w-3 h-3" /> Pinned</Badge> : null}
                  {a.source !== 'manual' && <Badge tone="sage">AI-drafted</Badge>}
                  <span className="text-xs text-dusk-200 ml-auto">{new Date(a.created_at).toLocaleDateString()}</span>
                </div>
                <h3 className="font-display text-lg text-dusk-500 mt-1">{a.title}</h3>
                <p className="text-sm text-dusk-400 mt-1 whitespace-pre-line">{a.body}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
