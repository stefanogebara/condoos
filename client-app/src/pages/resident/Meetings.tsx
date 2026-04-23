import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Circle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';

interface ActionItem { id: number; description: string; status: string; owner_label: string | null; due_date: string | null; }
interface Meeting {
  id: number;
  title: string;
  scheduled_for: string;
  agenda: string | null;
  ai_summary: string | null;
  raw_notes: string | null;
  status: string;
  action_items?: ActionItem[];
}

export default function Meetings() {
  const [rows, setRows] = useState<Meeting[]>([]);
  useEffect(() => {
    apiGet<Meeting[]>('/meetings').then(async (list) => {
      const withDetail = await Promise.all(list.map((m) => apiGet<Meeting>(`/meetings/${m.id}`).catch(() => m)));
      setRows(withDetail);
    });
  }, []);

  return (
    <>
      <PageHeader title="Meetings" subtitle="Board meetings, agendas, and AI-summarized recaps." />
      <div className="space-y-4">
        {rows.map((m) => {
          const summary = m.ai_summary ? JSON.parse(m.ai_summary) : null;
          return (
            <GlassCard key={m.id} variant="clay" className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                  <Calendar className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-xl text-dusk-500">{m.title}</h3>
                    <Badge tone={m.status === 'completed' ? 'sage' : 'peach'}>{m.status}</Badge>
                  </div>
                  <div className="text-sm text-dusk-300 mt-1">{new Date(m.scheduled_for).toLocaleString()}</div>
                  {m.agenda && <p className="text-sm text-dusk-400 mt-3">{m.agenda}</p>}

                  {summary && (
                    <div className="mt-4 border-t border-white/60 pt-4">
                      <Badge tone="sage" className="mb-2">AI recap</Badge>
                      <p className="text-sm text-dusk-400 leading-relaxed">{summary.summary}</p>
                      {summary.decisions?.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs uppercase tracking-wider text-dusk-200 mb-1">Decisions</div>
                          <ul className="text-sm text-dusk-400 space-y-1">{summary.decisions.map((d: string, i: number) => <li key={i}>• {d}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  )}

                  {m.action_items && m.action_items.length > 0 && (
                    <div className="mt-4 border-t border-white/60 pt-4">
                      <div className="text-xs uppercase tracking-wider text-dusk-200 mb-2">Action items</div>
                      <ul className="space-y-2">
                        {m.action_items.map((a) => (
                          <li key={a.id} className="flex items-start gap-2 text-sm">
                            {a.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-sage-600 mt-0.5" /> : <Circle className="w-4 h-4 text-dusk-200 mt-0.5" />}
                            <span className={a.status === 'done' ? 'line-through text-dusk-200' : 'text-dusk-400'}>
                              {a.description}
                              {a.owner_label && <span className="text-dusk-200"> · {a.owner_label}</span>}
                              {a.due_date && <span className="text-dusk-200"> · due {new Date(a.due_date).toLocaleDateString()}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </>
  );
}
