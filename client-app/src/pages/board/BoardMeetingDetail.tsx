import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Save, CheckCircle2, Circle, Megaphone } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost, apiPatch } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/i18n';

interface ActionItem { id: number; description: string; status: string; owner_label: string | null; due_date: string | null; }
interface Meeting {
  id: number; title: string; scheduled_for: string; agenda: string | null;
  raw_notes: string | null; ai_summary: string | null; status: string;
  action_items: ActionItem[];
}

export default function BoardMeetingDetail() {
  const { id } = useParams();
  const [m, setM] = useState<Meeting | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const load = useCallback(() => apiGet<Meeting>(`/meetings/${id}`).then((data) => {
    setM(data);
    setNotes(data.raw_notes || '');
    if (data.ai_summary) { try { setSummary(JSON.parse(data.ai_summary)); } catch {} }
  }), [id]);
  useEffect(() => { load(); }, [load]);

  async function saveNotes() {
    setSaving(true);
    try {
      await apiPatch(`/meetings/${id}/notes`, { raw_notes: notes });
      toast.success('Anotações salvas');
      setSummary(null);
      load();
    } finally { setSaving(false); }
  }

  async function summarize() {
    setSaving(true);
    try {
      const out = await apiPost<any>(`/ai/meetings/${id}/summarize`);
      setSummary(out);
      toast.success('Reunião resumida');
      load();
    } finally { setSaving(false); }
  }

  async function publishAnnouncement() {
    if (!summary?.resident_announcement) return;
    setSaving(true);
    try {
      await apiPost('/announcements', {
        title: summary.resident_announcement.title,
        body:  summary.resident_announcement.body,
        pinned: 1,
        source: 'ai_meeting',
      });
      toast.success('Comunicado publicado para os moradores');
    } finally { setSaving(false); }
  }

  async function toggle(actionId: number) {
    await apiPost(`/meetings/action-items/${actionId}/toggle`);
    load();
  }

  if (!m) return null;

  return (
    <>
      <Link to="/board/meetings" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4"><ArrowLeft className="w-4 h-4" /> Voltar</Link>
      <PageHeader title={m.title} subtitle={formatDateTime(m.scheduled_for) + (m.agenda ? ` · ${m.agenda}` : '')} />

      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard className="p-6">
          <h3 className="font-display text-lg text-dusk-500 mb-3">Anotações</h3>
          <textarea
            className="input min-h-[280px] font-mono text-sm"
            placeholder="Cole as anotações da reunião aqui. Tópicos, abreviações, do jeito que veio — a IA arruma."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="mt-3 flex gap-2 justify-end">
            <Button variant="ghost" onClick={saveNotes} loading={saving} leftIcon={<Save className="w-4 h-4" />}>Salvar</Button>
            <Button variant="primary" onClick={summarize} loading={saving} leftIcon={<Sparkles className="w-4 h-4" />}>Resumir com IA</Button>
          </div>
        </GlassCard>

        <GlassCard variant={summary ? 'clay-sage' : 'clay'} className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Resumo da IA</h3>
            {summary && <Badge tone="dark">Pronto</Badge>}
          </div>
          {summary ? (
            <div className="space-y-4 text-sm">
              <p className="text-dusk-400 leading-relaxed">{summary.summary}</p>

              {summary.decisions?.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-dusk-300 mb-1">Decisões</div>
                  <ul className="space-y-1">{summary.decisions.map((d: string, i: number) => <li key={i} className="text-dusk-400">• {d}</li>)}</ul>
                </div>
              )}

              {summary.resident_announcement && (
                <div className="border-t border-white/60 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-wider text-dusk-300">Rascunho do comunicado</div>
                    <Button size="sm" variant="primary" onClick={publishAnnouncement} leftIcon={<Megaphone className="w-3.5 h-3.5" />}>Publicar</Button>
                  </div>
                  <div className="p-4 rounded-2xl bg-white/60 backdrop-blur-sm border border-white/70">
                    <div className="font-semibold text-dusk-500">{summary.resident_announcement.title}</div>
                    <p className="text-sm text-dusk-400 mt-1 whitespace-pre-line">{summary.resident_announcement.body}</p>
                  </div>
                </div>
              )}
            </div>
          ) : <p className="text-sm text-dusk-300">Salve as anotações e clique em Resumir. Você recebe um resumo limpo, lista de decisões, tarefas, e um comunicado pronto para publicar.</p>}
        </GlassCard>
      </div>

      {m.action_items?.length > 0 && (
        <>
          <h3 className="font-display text-xl text-dusk-500 mt-10 mb-4">Tarefas</h3>
          <div className="space-y-2">
            {m.action_items.map((a) => (
              <GlassCard key={a.id} className="p-4 flex items-center gap-3">
                <button onClick={() => toggle(a.id)} className="shrink-0">
                  {a.status === 'done' ? <CheckCircle2 className="w-5 h-5 text-sage-600" /> : <Circle className="w-5 h-5 text-dusk-200" />}
                </button>
                <div className="flex-1">
                  <div className={a.status === 'done' ? 'line-through text-dusk-200 text-sm' : 'text-dusk-400 text-sm'}>
                    {a.description}
                  </div>
                  <div className="text-xs text-dusk-200 mt-0.5">
                    {a.owner_label && <span>{a.owner_label}</span>}
                    {a.due_date && <span> · até {formatDate(a.due_date)}</span>}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}
    </>
  );
}
