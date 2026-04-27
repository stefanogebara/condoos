import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatCurrency } from '../../lib/i18n';

interface Proposal {
  id: number;
  title: string;
  description: string;
  category: string | null;
  estimated_cost: number | null;
  status: string;
  ai_drafted: number;
  created_at: string;
  author_first: string;
  author_last: string;
  votes: { yes: number; no: number; abstain: number; total: number };
}

const STATUS: Record<string, string> = {
  discussion:    'em discussão',
  voting:        'em votação',
  approved:      'aprovada',
  rejected:      'reprovada',
  completed:     'concluída',
  inconclusive:  'inconclusiva',
};
const TONE: Record<string, any> = {
  discussion: 'sage',
  voting:     'peach',
  approved:   'sage',
  rejected:   'neutral',
  completed:  'neutral',
};

export default function Proposals() {
  const [rows, setRows] = useState<Proposal[]>([]);
  useEffect(() => { apiGet<Proposal[]>('/proposals').then(setRows).catch(() => {}); }, []);

  return (
    <>
      <PageHeader title="Propostas" subtitle="Todas as decisões do seu prédio — passadas, atuais e em andamento." />
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((p) => (
          <Link key={p.id} to={`/app/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5 h-full">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge tone={TONE[p.status]}>{STATUS[p.status]}</Badge>
                {p.ai_drafted === 1 && <Badge tone="sage">Redigido pela IA</Badge>}
                {p.category && <Badge tone="neutral">{p.category}</Badge>}
              </div>
              <h3 className="font-display text-lg text-dusk-500 leading-snug">{p.title}</h3>
              <p className="text-sm text-dusk-300 mt-2 line-clamp-2">{p.description}</p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/50">
                <div className="text-xs text-dusk-200">
                  {p.estimated_cost ? `~${formatCurrency(p.estimated_cost)}` : '—'}
                </div>
                {p.status === 'voting' ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-sage-700 font-semibold">{p.votes.yes} sim</span>
                    <span className="text-dusk-200">·</span>
                    <span className="text-peach-500 font-semibold">{p.votes.no} não</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-dusk-200">
                    <MessageCircle className="w-3 h-3" /> discussion
                  </div>
                )}
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}
