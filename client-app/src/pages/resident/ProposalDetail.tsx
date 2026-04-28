import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Vote as VoteIcon, MessageCircle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Avatar from '../../components/Avatar';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { track } from '../../lib/analytics';
import { formatCurrency, formatDate } from '../../lib/i18n';

interface Comment { id: number; body: string; created_at: string; first_name: string; last_name: string; unit_number: string; }
interface Proposal {
  id: number;
  title: string;
  description: string;
  category: string | null;
  estimated_cost: number | null;
  status: string;
  ai_drafted: number;
  ai_summary: string | null;
  ai_explainer: string | null;
  decision_summary: string | null;
  author_first: string;
  author_last: string;
  voting_opens_at: string | null;
  voting_closes_at: string | null;
  voter_eligibility: 'all' | 'owners_only' | 'primary_contact_only';
  quorum_percent: number;
  close_reason: string | null;
  comments: Comment[];
  votes: {
    yes: number;
    no: number;
    abstain: number;
    total: number;
    yes_weight: number;
    no_weight: number;
    abstain_weight: number;
    total_weight: number;
  };
  quorum?: {
    eligible_voter_count: number;
    votes_cast: number;
    turnout_percent: number;
    quorum_percent: number;
    quorum_met: boolean;
  };
  my_vote: 'yes' | 'no' | 'abstain' | null;
  voter_rights?: {
    can_vote: boolean;
    eligible_as_owner: boolean;
    eligible_as_primary_contact: boolean;
    voting_weight: number;
    proposal_eligibility: string;
  };
}

/** "2d 4h 31m" or "closed" or "opens in 3h 12m" */
function formatWindow(opens_at: string | null, closes_at: string | null): { label: string; tone: 'live' | 'pre' | 'over' } {
  const now = Date.now();
  if (opens_at && now < new Date(opens_at).getTime()) {
    return { label: `Opens in ${humanDelta(new Date(opens_at).getTime() - now)}`, tone: 'pre' };
  }
  if (closes_at) {
    const delta = new Date(closes_at).getTime() - now;
    if (delta <= 0) return { label: 'Voting closed', tone: 'over' };
    return { label: `Closes in ${humanDelta(delta)}`, tone: 'live' };
  }
  return { label: 'Open', tone: 'live' };
}

function humanDelta(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

export default function ProposalDetail() {
  const { id } = useParams();
  const [p, setP] = useState<Proposal | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [explainer, setExplainer] = useState<string | null>(null);

  const load = useCallback(() => apiGet<Proposal>(`/proposals/${id}`).then((data) => {
    setP(data);
    if (data.ai_summary) {
      try { setSummary(JSON.parse(data.ai_summary)); } catch {}
    }
    if (data.ai_explainer) setExplainer(data.ai_explainer);
  }).catch(() => {}), [id]);
  useEffect(() => { load(); }, [load]);

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/proposals/${id}/comments`, { body: comment });
      setComment('');
      setSummary(null);
      toast.success('Comentário publicado');
      load();
    } finally { setBusy(false); }
  }

  async function cast(choice: 'yes' | 'no' | 'abstain') {
    setBusy(true);
    try {
      await apiPost(`/proposals/${id}/vote`, { choice });
      track('vote_cast', { proposal_id: Number(id), choice, surface: 'resident_proposal_detail' });
      toast.success(`Voto registrado: ${choice === 'yes' ? 'Sim' : choice === 'no' ? 'Não' : 'Abstenção'}`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Voto falhou');
    } finally { setBusy(false); }
  }

  async function summarize() {
    setBusy(true);
    try {
      const data = await apiPost<any>(`/ai/proposals/${id}/summarize-thread`);
      setSummary(data);
      toast.success('Resumo gerado');
    } finally { setBusy(false); }
  }

  async function explain() {
    setBusy(true);
    try {
      const data = await apiPost<{ explainer: string }>(`/ai/proposals/${id}/explain`);
      setExplainer(data.explainer);
      toast.success('Explicação gerada');
    } finally { setBusy(false); }
  }

  if (!p) return null;
  const weightedTotal = p.votes.total_weight || p.votes.total;
  const usesWeightedTally =
    p.votes.yes_weight !== p.votes.yes ||
    p.votes.no_weight !== p.votes.no ||
    p.votes.abstain_weight !== p.votes.abstain;
  const pct = weightedTotal ? Math.round((p.votes.yes_weight / weightedTotal) * 100) : 0;

  return (
    <>
      <Link to="/app/proposals" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4"><ArrowLeft className="w-4 h-4" /> Voltar</Link>
      <PageHeader
        title={p.title}
        subtitle={`Proposto por ${p.author_first} ${p.author_last}${p.estimated_cost ? ` · ~${formatCurrency(p.estimated_cost)}` : ''}`}
      />
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{({ discussion: 'em discussão', voting: 'em votação', approved: 'aprovada', rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva' } as Record<string,string>)[p.status] || p.status}</Badge>
        {p.ai_drafted === 1 && <Badge tone="sage">Redigido pela IA</Badge>}
        {p.category && <Badge tone="neutral">{p.category}</Badge>}
        {p.voter_eligibility === 'owners_only' && <Badge tone="peach">Só proprietários</Badge>}
        {p.voter_eligibility === 'primary_contact_only' && <Badge tone="peach">Um voto por unidade</Badge>}
      </div>

      <GlassCard variant="clay" className="p-7 mb-6">
        <p className="text-dusk-400 leading-relaxed whitespace-pre-line">{p.description}</p>
      </GlassCard>

      {/* Voting */}
      {p.status === 'voting' && (() => {
        const win = formatWindow(p.voting_opens_at, p.voting_closes_at);
        return (
        <GlassCard variant="clay-sage" className="p-7 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-xl text-dusk-500">Aberta para votação</h3>
              <div className={`text-xs mt-1 font-medium ${win.tone === 'over' ? 'text-peach-500' : win.tone === 'pre' ? 'text-dusk-300' : 'text-sage-700'}`}>
                {win.label}
              </div>
              {p.quorum && p.quorum.quorum_percent > 0 && (
                <div className="mt-2 text-xs text-dusk-300">
                  Quórum: <span className={`font-semibold ${p.quorum.quorum_met ? 'text-sage-700' : 'text-peach-500'}`}>
                    {p.quorum.turnout_percent}%
                  </span>
                  {' / '}{p.quorum.quorum_percent}% exigido
                  <span className="text-dusk-200"> · {p.quorum.votes_cast} de {p.quorum.eligible_voter_count} votaram</span>
                </div>
              )}
            </div>
            <VoteIcon className="w-8 h-8 text-dusk-300" />
          </div>
          <div className="h-3 rounded-full bg-white/60 overflow-hidden flex mb-2">
            <div className="h-full bg-sage-500"  style={{ width: `${weightedTotal ? (p.votes.yes_weight / weightedTotal) * 100 : 0}%` }} />
            <div className="h-full bg-peach-400" style={{ width: `${weightedTotal ? (p.votes.no_weight  / weightedTotal) * 100 : 0}%` }} />
            <div className="h-full bg-dusk-200"  style={{ width: `${weightedTotal ? (p.votes.abstain_weight / weightedTotal) * 100 : 0}%` }} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-sage-700 font-semibold">{p.votes.yes} sim ({pct}%)</span>
            <span className="text-peach-500 font-semibold">{p.votes.no} não</span>
            <span className="text-dusk-300">{p.votes.abstain} abstenção</span>
          </div>
          {usesWeightedTally && (
            <div className="mt-2 text-xs text-dusk-300">
              Apuração com peso: {p.votes.yes_weight} sim · {p.votes.no_weight} não · {p.votes.abstain_weight} abstenção
            </div>
          )}

          {p.voter_rights?.can_vote === false ? (
            <div className="mt-5 p-4 rounded-2xl bg-white/60 border border-white/70 text-sm text-dusk-400">
              <strong className="font-semibold">Você não pode votar nesta proposta.</strong>
              <span className="ml-1">
                {p.voter_eligibility === 'owners_only'
                  ? 'Só proprietários votam em decisões de gastos do condomínio.'
                  : p.voter_eligibility === 'primary_contact_only'
                  ? 'Só o contato principal de cada unidade vota aqui.'
                  : 'Vincule sua unidade primeiro para participar.'}
              </span>
            </div>
          ) : (
            <div className="mt-5 flex gap-2">
              <Button variant={p.my_vote === 'yes' ? 'sage' : 'ghost'} onClick={() => cast('yes')} disabled={busy}>Sim</Button>
              <Button variant={p.my_vote === 'no'  ? 'peach' : 'ghost'} onClick={() => cast('no')}  disabled={busy}>Não</Button>
              <Button variant="ghost" onClick={() => cast('abstain')} disabled={busy}>Abstenção</Button>
              {p.my_vote && <span className="ml-auto self-center text-xs text-dusk-300">Seu voto: <span className="font-semibold">{p.my_vote === 'yes' ? 'Sim' : p.my_vote === 'no' ? 'Não' : 'Abstenção'}</span></span>}
            </div>
          )}
        </GlassCard>
        );
      })()}

      {/* Inconclusive / quorum-failure banner */}
      {p.status === 'inconclusive' && (
        <GlassCard variant="clay-peach" className="p-5 mb-6 text-sm text-dusk-500">
          <span className="font-semibold">Votação encerrada como inconclusiva.</span>{' '}
          {p.close_reason === 'quorum_not_met'
            ? `O quórum de ${p.quorum_percent}% não foi atingido${p.quorum ? ` — só ${p.quorum.turnout_percent}% votaram.` : '.'} O síndico pode reabrir a votação depois.`
            : 'Não houve votos suficientes para qualquer lado. Decisão adiada.'}
        </GlassCard>
      )}

      {/* AI tools */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Resumo da discussão</h3>
            <Button size="sm" variant="ghost" onClick={summarize} loading={busy && !summary}>Resumir discussão</Button>
          </div>
          {summary ? (
            <div className="space-y-3 text-sm">
              <p className="text-dusk-400 leading-relaxed">{summary.summary}</p>
              {summary.points_of_agreement?.length > 0 && <Group label="Concordância"  items={summary.points_of_agreement}    tone="sage" />}
              {summary.points_of_disagreement?.length > 0 && <Group label="Discordância" items={summary.points_of_disagreement} tone="peach" />}
              {summary.open_questions?.length > 0 && <Group label="Em aberto" items={summary.open_questions} tone="neutral" />}
            </div>
          ) : <p className="text-sm text-dusk-300">Peça pra IA ler os {p.comments.length} comentários e resumir onde os moradores concordam ou discordam.</p>}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Em linguagem simples</h3>
            <Button size="sm" variant="ghost" onClick={explain} loading={busy && !explainer}>Explicar pra mim</Button>
          </div>
          {explainer
            ? <p className="text-sm text-dusk-400 leading-relaxed whitespace-pre-line">{explainer}</p>
            : <p className="text-sm text-dusk-300">Versão sem juridiquês, sem termo técnico.</p>}
        </GlassCard>
      </div>

      {/* Comments */}
      <h3 className="font-display text-xl text-dusk-500 mb-4 flex items-center gap-2"><MessageCircle className="w-5 h-5" /> Discussão ({p.comments.length})</h3>
      <div className="space-y-3 mb-5">
        {p.comments.map((c) => (
          <GlassCard key={c.id} className="p-4 flex items-start gap-3">
            <Avatar name={`${c.first_name} ${c.last_name}`} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-dusk-500 text-sm">{c.first_name} {c.last_name}</span>
                <span className="text-xs text-dusk-200">Unidade {c.unit_number}</span>
                <span className="text-xs text-dusk-200 ml-auto">{formatDate(c.created_at)}</span>
              </div>
              <p className="text-sm text-dusk-400 mt-1 whitespace-pre-line">{c.body}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      <form onSubmit={addComment} className="flex gap-2">
        <input className="input flex-1" placeholder="Diga o que você acha..." value={comment} onChange={(e) => setComment(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy}>Comentar</Button>
      </form>
    </>
  );
}

function Group({ label, items, tone }: { label: string; items: string[]; tone: 'sage' | 'peach' | 'neutral' }) {
  return (
    <div>
      <Badge tone={tone}>{label}</Badge>
      <ul className="mt-2 space-y-1 ml-1">
        {items.map((t, i) => <li key={i} className="text-dusk-300 text-sm">• {t}</li>)}
      </ul>
    </div>
  );
}
