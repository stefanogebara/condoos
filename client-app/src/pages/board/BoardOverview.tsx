import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Vote, Calendar, Users, ArrowRight, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Proposal { id: number; title: string; status: string; votes: { yes: number; no: number; abstain: number; total: number }; }
interface Suggestion { id: number; body: string; status: string; }
interface Meeting { id: number; title: string; scheduled_for: string; status: string; }

export default function BoardOverview() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [residents, setResidents] = useState<any[]>([]);
  const [condoName, setCondoName] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const loads = [
      apiGet<Proposal[]>('/proposals').then(setProposals),
      apiGet<Suggestion[]>('/suggestions').then(setSuggestions),
      apiGet<Meeting[]>('/meetings').then(setMeetings),
      apiGet<any[]>('/users/residents').then(setResidents),
      apiGet<Array<{ status: string; condo_name: string }>>('/onboarding/me').then((rows) => {
        const active = rows.find((r) => r.status === 'active');
        if (active) setCondoName(active.condo_name);
      }),
    ];
    Promise.allSettled(loads).then((results) => {
      if (!alive) return;
      setLoadError(results.some((r) => r.status === 'rejected')
        ? 'Não foi possível carregar parte dos dados. Atualize a página ou entre novamente.'
        : null);
    });
    return () => { alive = false; };
  }, []);

  const openSuggestions = suggestions.filter((s) => s.status === 'open');
  const openProposals = proposals.filter((p) => p.status === 'voting' || p.status === 'discussion');
  const upcoming = meetings.filter((m) => new Date(m.scheduled_for) > new Date() && m.status !== 'completed');

  const STATUS_LABEL: Record<string, string> = {
    voting: 'em votação', discussion: 'em discussão', approved: 'aprovada',
    rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva',
  };

  return (
    <>
      <PageHeader
        title={`Bem-vindo de volta, ${user?.first_name}.`}
        subtitle={condoName ? `Tudo que precisa da sua atenção no ${condoName}.` : 'Tudo que precisa da sua atenção.'}
      />
      {loadError && (
        <GlassCard variant="clay-peach" className="p-4 mb-6 text-sm text-dusk-500">
          {loadError}
        </GlassCard>
      )}

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <Stat icon={Inbox}    color="peach" label="Sugestões novas"    value={openSuggestions.length} to="/board/suggestions" />
        <Stat icon={Vote}     color="sage"  label="Propostas ativas"   value={openProposals.length}   to="/board/proposals" />
        <Stat icon={Calendar} color="peach" label="Reuniões agendadas" value={upcoming.length}        to="/board/meetings" />
        <Stat icon={Users}    color="sage"  label="Moradores"          value={residents.length}       to="/board/residents" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard variant="clay-peach" className="p-7">
          <Badge tone="dark" className="mb-3"><Sparkles className="w-3 h-3" /> Caixa de IA</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">
            {openSuggestions.length === 1
              ? '1 sugestão de morador esperando'
              : `${openSuggestions.length} sugestões de moradores esperando`}
          </h2>
          <p className="text-sm text-dusk-300 mt-2">Agrupe, transforme em proposta ou descarte. Um clique cada.</p>
          <Link to="/board/suggestions" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            Abrir caixa <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>

        <GlassCard variant="clay-sage" className="p-7">
          <Badge tone="dark" className="mb-3">Reunião pronta?</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">Cole as anotações. Receba o resumo, tarefas e o comunicado pros moradores.</h2>
          <Link to="/board/meetings" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            Ver reuniões <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>
      </div>

      <h2 className="font-display text-xl text-dusk-500 mt-10 mb-4">Propostas ativas</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {openProposals.map((p) => (
          <Link key={p.id} to={`/board/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5">
              <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{STATUS_LABEL[p.status] || p.status}</Badge>
              <h3 className="font-semibold text-dusk-500 mt-2">{p.title}</h3>
              {p.status === 'voting' && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-sage-700 font-semibold">{p.votes.yes} sim</span>
                  <span className="text-peach-500 font-semibold">{p.votes.no} não</span>
                  <span className="text-dusk-200">{p.votes.abstain} abst.</span>
                </div>
              )}
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({ icon: Icon, color, label, value, to }: any) {
  return (
    <Link to={to}>
      <GlassCard variant="clay" hover className="p-5 h-full">
        <div className="flex items-start justify-between">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <ArrowRight className="w-4 h-4 text-dusk-200" />
        </div>
        <div className="mt-4 font-display text-3xl text-dusk-500">{value}</div>
        <div className="text-xs text-dusk-300 mt-0.5">{label}</div>
      </GlassCard>
    </Link>
  );
}
