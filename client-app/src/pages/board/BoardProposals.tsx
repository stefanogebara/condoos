import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';

interface Proposal {
  id: number;
  title: string;
  description: string;
  category: string | null;
  estimated_cost: number | null;
  status: string;
  ai_drafted: number;
  author_first: string;
  author_last: string;
  votes: { yes: number; no: number; abstain: number; total: number };
}

export default function BoardProposals() {
  const [rows, setRows] = useState<Proposal[]>([]);
  useEffect(() => { apiGet<Proposal[]>('/proposals').then(setRows).catch(() => {}); }, []);

  const grouped = {
    voting:     rows.filter((p) => p.status === 'voting'),
    discussion: rows.filter((p) => p.status === 'discussion'),
    done:       rows.filter((p) => ['approved', 'rejected', 'completed'].includes(p.status)),
  };

  return (
    <>
      <PageHeader title="Proposals" subtitle="All decisions in motion. Open voting, discuss, summarize, close." />
      <Section title="Open for voting" items={grouped.voting} />
      <Section title="In discussion"   items={grouped.discussion} />
      <Section title="Resolved"        items={grouped.done} />
    </>
  );
}

function Section({ title, items }: { title: string; items: any[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2 className="font-display text-xl text-dusk-500 mt-8 mb-4">{title}</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {items.map((p: any) => (
          <Link key={p.id} to={`/board/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5 h-full">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge tone={p.status === 'voting' ? 'peach' : p.status === 'discussion' ? 'sage' : 'neutral'}>{p.status}</Badge>
                {p.ai_drafted === 1 && <Badge tone="sage">AI-drafted</Badge>}
                {p.category && <Badge tone="neutral">{p.category}</Badge>}
              </div>
              <h3 className="font-display text-lg text-dusk-500">{p.title}</h3>
              <p className="text-sm text-dusk-300 mt-2 line-clamp-2">{p.description}</p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/50 text-xs">
                <span className="text-dusk-200">by {p.author_first}</span>
                {p.status === 'voting' ? (
                  <span>
                    <span className="text-sage-700 font-semibold">{p.votes.yes}</span>
                    <span className="text-dusk-200 mx-1">·</span>
                    <span className="text-peach-500 font-semibold">{p.votes.no}</span>
                  </span>
                ) : (
                  p.estimated_cost ? <span className="text-dusk-300">~R$ {p.estimated_cost.toLocaleString('pt-BR')}</span> : null
                )}
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}
