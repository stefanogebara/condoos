import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Gavel, Plus, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';

interface Assembly {
  id: number;
  title: string;
  kind: 'ordinary' | 'extraordinary';
  status: 'draft' | 'convoked' | 'in_session' | 'closed';
  first_call_at: string;
  second_call_at: string | null;
  agenda_count: number;
  creator_first: string;
  creator_last: string;
}

const KIND_LABEL: Record<Assembly['kind'], string> = {
  ordinary:      'Ordinária (AGO)',
  extraordinary: 'Extraordinária (AGE)',
};

const STATUS_TONE: Record<Assembly['status'], any> = {
  draft:      'neutral',
  convoked:   'peach',
  in_session: 'sage',
  closed:     'dark',
};

export default function BoardAssemblies() {
  const [rows, setRows] = useState<Assembly[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', kind: 'ordinary' as Assembly['kind'], first_call_at: '', second_call_at: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => apiGet<Assembly[]>('/assemblies').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const firstIso = new Date(form.first_call_at).toISOString();
      const secondIso = form.second_call_at
        ? new Date(form.second_call_at).toISOString()
        : new Date(new Date(form.first_call_at).getTime() + 30 * 60 * 1000).toISOString();
      const created = await apiPost<{ id: number }>('/assemblies', {
        title: form.title,
        kind: form.kind,
        first_call_at: firstIso,
        second_call_at: secondIso,
      });
      toast.success('Assembly created — add items to the agenda');
      setForm({ title: '', kind: 'ordinary', first_call_at: '', second_call_at: '' });
      setShowForm(false);
      await load();
      // Auto-redirect to the new assembly for agenda setup
      window.location.href = `/board/assemblies/${created.id}`;
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Create failed');
    } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="Assemblies"
        subtitle="Brazilian AGO / AGE. Owners vote. Proxies & quorum enforced. AI drafts the ata."
        actions={<Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'} leftIcon={<Plus className="w-4 h-4" />}>{showForm ? 'Cancel' : 'New assembly'}</Button>}
      />

      {showForm && (
        <GlassCard className="p-6 mb-6 animate-fade-up">
          <form onSubmit={create} className="grid md:grid-cols-2 gap-3">
            <input className="input md:col-span-2" placeholder="Title (e.g. AGO 2026 — Prestação de contas)" required
                   value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Assembly['kind'] })}>
              <option value="ordinary">Ordinária (AGO)</option>
              <option value="extraordinary">Extraordinária (AGE)</option>
            </select>
            <div />
            <div>
              <label className="text-xs text-dusk-300 uppercase tracking-wider">1ª chamada</label>
              <input className="input mt-1" type="datetime-local" required
                     value={form.first_call_at} onChange={(e) => setForm({ ...form, first_call_at: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-dusk-300 uppercase tracking-wider">2ª chamada (optional — defaults to +30min)</label>
              <input className="input mt-1" type="datetime-local"
                     value={form.second_call_at} onChange={(e) => setForm({ ...form, second_call_at: e.target.value })} />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving} leftIcon={<Sparkles className="w-4 h-4" />}>
                Create & open agenda
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      <div className="space-y-4">
        {rows.length === 0 && (
          <GlassCard className="p-8 text-center">
            <Gavel className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
            <p className="text-dusk-400">No assemblies yet. Start an AGO when the annual review cycle comes around.</p>
          </GlassCard>
        )}
        {rows.map((a) => (
          <Link key={a.id} to={`/board/assemblies/${a.id}`}>
            <GlassCard variant="clay" hover className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-peach-200 text-peach-700 flex items-center justify-center shrink-0">
                <Gavel className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-lg text-dusk-500">{a.title}</h3>
                  <Badge tone={STATUS_TONE[a.status]}>{a.status.replace('_', ' ')}</Badge>
                  <Badge tone="neutral">{KIND_LABEL[a.kind]}</Badge>
                </div>
                <div className="text-sm text-dusk-300 mt-1">
                  {new Date(a.first_call_at).toLocaleString('pt-BR')} · {a.agenda_count} item{a.agenda_count === 1 ? '' : 's'} on agenda
                </div>
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}
