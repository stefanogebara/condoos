import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { formatCurrency, t } from '../../lib/i18n';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    setLoading(true); setError(false);
    apiGet<Proposal[]>('/proposals')
      .then((r) => { setRows(r || []); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader title={t('Propostas')} subtitle={t('Todas as decisões do seu prédio — passadas, atuais e em andamento.')} />
      {loading && <p className="text-sm text-dusk-300">{t('Carregando...')}</p>}
      {!loading && error && (
        <div className="rounded-3xl border border-peach-200 bg-peach-50/80 p-4 text-sm">
          <p className="font-medium text-peach-500">{t('Não foi possível carregar as propostas')}</p>
          <p className="text-xs text-dusk-400 mt-1">{t('Verifique sua conexão e tente recarregar a página.')}</p>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-dusk-300">{t('Nenhuma proposta no momento.')}</p>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((p) => (
          <Link key={p.id} to={`/app/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5 h-full">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Badge tone={TONE[p.status]}>{t(STATUS[p.status] || p.status)}</Badge>
                {p.ai_drafted === 1 && <Badge tone="sage">{t('Redigido pela IA')}</Badge>}
                {p.category && <Badge tone="neutral">{t(p.category)}</Badge>}
              </div>
              <h3 data-user-content className="font-display text-lg text-dusk-500 leading-snug">{t(p.title)}</h3>
              <p data-user-content className="text-sm text-dusk-300 mt-2 line-clamp-2">{t(p.description)}</p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/50">
                <div className="text-xs text-dusk-200">
                  {p.estimated_cost ? `${t('Estimativa')}: ${formatCurrency(Math.abs(p.estimated_cost))}` : '—'}
                </div>
                {p.status === 'voting' ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-sage-700 font-semibold">{p.votes.yes} {t('sim')}</span>
                    <span className="text-dusk-200">·</span>
                    <span className="text-peach-500 font-semibold">{p.votes.no} {t('não')}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-dusk-200">
                    <MessageCircle className="w-3 h-3" /> {t('discussão')}
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
