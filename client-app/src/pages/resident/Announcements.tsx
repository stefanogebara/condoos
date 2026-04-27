import React, { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatDate } from '../../lib/i18n';

interface Announcement {
  id: number;
  title: string;
  body: string;
  pinned: number;
  source: 'manual' | 'ai_meeting' | 'ai_decision';
  created_at: string;
  first_name: string;
  last_name: string;
}

export default function Announcements() {
  const [rows, setRows] = useState<Announcement[]>([]);
  useEffect(() => { apiGet<Announcement[]>('/announcements').then(setRows).catch(() => {}); }, []);

  return (
    <>
      <PageHeader title="Comunicados" subtitle="Avisos do síndico. Itens fixados ficam no topo." />
      <div className="space-y-4">
        {rows.map((a) => (
          <GlassCard key={a.id} variant={a.pinned ? 'clay-peach' : 'clay'} className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/60 flex items-center justify-center shrink-0">
                <Megaphone className="w-6 h-6 text-peach-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {a.pinned ? <Badge tone="peach"><Pin className="w-3 h-3" /> Pinned</Badge> : null}
                  {a.source === 'ai_meeting'  && <Badge tone="sage">AI meeting recap</Badge>}
                  {a.source === 'ai_decision' && <Badge tone="sage">AI decision</Badge>}
                  <span className="text-xs text-dusk-200 ml-auto">{formatDate(a.created_at)}</span>
                </div>
                <h3 className="font-display text-xl text-dusk-500 mt-2">{a.title}</h3>
                <p className="text-dusk-300 mt-2 whitespace-pre-line leading-relaxed">{a.body}</p>
                <div className="mt-3 text-xs text-dusk-200">Posted by {a.first_name} {a.last_name}</div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
