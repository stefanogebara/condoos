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
  voting_closes_at: string | null;
  voter_eligibility: 'all' | 'owners_only' | 'primary_contact_only';
  comments: Comment[];
  votes: { yes: number; no: number; abstain: number; total: number };
  my_vote: 'yes' | 'no' | 'abstain' | null;
  voter_rights?: {
    can_vote: boolean;
    eligible_as_owner: boolean;
    eligible_as_primary_contact: boolean;
    voting_weight: number;
    proposal_eligibility: string;
  };
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
      toast.success('Comment posted');
      load();
    } finally { setBusy(false); }
  }

  async function cast(choice: 'yes' | 'no' | 'abstain') {
    setBusy(true);
    try {
      await apiPost(`/proposals/${id}/vote`, { choice });
      toast.success(`Voted ${choice}`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Vote failed');
    } finally { setBusy(false); }
  }

  async function summarize() {
    setBusy(true);
    try {
      const data = await apiPost<any>(`/ai/proposals/${id}/summarize-thread`);
      setSummary(data);
      toast.success('Summary ready');
    } finally { setBusy(false); }
  }

  async function explain() {
    setBusy(true);
    try {
      const data = await apiPost<{ explainer: string }>(`/ai/proposals/${id}/explain`);
      setExplainer(data.explainer);
      toast.success('Explanation ready');
    } finally { setBusy(false); }
  }

  if (!p) return null;
  const pct = p.votes.total ? Math.round((p.votes.yes / p.votes.total) * 100) : 0;

  return (
    <>
      <Link to="/app/proposals" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4"><ArrowLeft className="w-4 h-4" /> Back</Link>
      <PageHeader
        title={p.title}
        subtitle={`Proposed by ${p.author_first} ${p.author_last}${p.estimated_cost ? ` · ~$${p.estimated_cost.toLocaleString()}` : ''}`}
      />
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{p.status}</Badge>
        {p.ai_drafted === 1 && <Badge tone="sage">AI-drafted</Badge>}
        {p.category && <Badge tone="neutral">{p.category}</Badge>}
        {p.voter_eligibility === 'owners_only' && <Badge tone="peach">Owners only</Badge>}
        {p.voter_eligibility === 'primary_contact_only' && <Badge tone="peach">One vote per unit</Badge>}
      </div>

      <GlassCard variant="clay" className="p-7 mb-6">
        <p className="text-dusk-400 leading-relaxed whitespace-pre-line">{p.description}</p>
      </GlassCard>

      {/* Voting */}
      {p.status === 'voting' && (
        <GlassCard variant="clay-sage" className="p-7 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display text-xl text-dusk-500">Open for voting</h3>
              {p.voting_closes_at && <div className="text-xs text-dusk-300 mt-1">Closes {new Date(p.voting_closes_at).toLocaleDateString()}</div>}
            </div>
            <VoteIcon className="w-8 h-8 text-dusk-300" />
          </div>
          <div className="h-3 rounded-full bg-white/60 overflow-hidden flex mb-2">
            <div className="h-full bg-sage-500"  style={{ width: `${p.votes.total ? (p.votes.yes / p.votes.total) * 100 : 0}%` }} />
            <div className="h-full bg-peach-400" style={{ width: `${p.votes.total ? (p.votes.no  / p.votes.total) * 100 : 0}%` }} />
            <div className="h-full bg-dusk-200"  style={{ width: `${p.votes.total ? (p.votes.abstain / p.votes.total) * 100 : 0}%` }} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-sage-700 font-semibold">{p.votes.yes} yes ({pct}%)</span>
            <span className="text-peach-500 font-semibold">{p.votes.no} no</span>
            <span className="text-dusk-300">{p.votes.abstain} abstain</span>
          </div>

          {p.voter_rights?.can_vote === false ? (
            <div className="mt-5 p-4 rounded-2xl bg-white/60 border border-white/70 text-sm text-dusk-400">
              <strong className="font-semibold">You're not eligible to vote on this proposal.</strong>
              <span className="ml-1">
                {p.voter_eligibility === 'owners_only'
                  ? 'Only unit owners can vote on HOA spending decisions.'
                  : p.voter_eligibility === 'primary_contact_only'
                  ? 'Only the primary contact of each unit votes here.'
                  : 'Join a unit first to participate.'}
              </span>
            </div>
          ) : (
            <div className="mt-5 flex gap-2">
              <Button variant={p.my_vote === 'yes' ? 'sage' : 'ghost'} onClick={() => cast('yes')} disabled={busy}>Yes</Button>
              <Button variant={p.my_vote === 'no'  ? 'peach' : 'ghost'} onClick={() => cast('no')}  disabled={busy}>No</Button>
              <Button variant="ghost" onClick={() => cast('abstain')} disabled={busy}>Abstain</Button>
              {p.my_vote && <span className="ml-auto self-center text-xs text-dusk-300">You voted: <span className="font-semibold">{p.my_vote}</span></span>}
            </div>
          )}
        </GlassCard>
      )}

      {/* AI tools */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Discussion summary</h3>
            <Button size="sm" variant="ghost" onClick={summarize} loading={busy && !summary}>Summarize thread</Button>
          </div>
          {summary ? (
            <div className="space-y-3 text-sm">
              <p className="text-dusk-400 leading-relaxed">{summary.summary}</p>
              {summary.points_of_agreement?.length > 0 && <Group label="Agreement"    items={summary.points_of_agreement}    tone="sage" />}
              {summary.points_of_disagreement?.length > 0 && <Group label="Disagreement" items={summary.points_of_disagreement} tone="peach" />}
              {summary.open_questions?.length > 0 && <Group label="Open questions" items={summary.open_questions} tone="neutral" />}
            </div>
          ) : <p className="text-sm text-dusk-300">Ask AI to read the {p.comments.length} comments and summarize where residents agree and disagree.</p>}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> In plain language</h3>
            <Button size="sm" variant="ghost" onClick={explain} loading={busy && !explainer}>Explain for me</Button>
          </div>
          {explainer
            ? <p className="text-sm text-dusk-400 leading-relaxed whitespace-pre-line">{explainer}</p>
            : <p className="text-sm text-dusk-300">Get a plain-language version — no jargon, no legalese.</p>}
        </GlassCard>
      </div>

      {/* Comments */}
      <h3 className="font-display text-xl text-dusk-500 mb-4 flex items-center gap-2"><MessageCircle className="w-5 h-5" /> Discussion ({p.comments.length})</h3>
      <div className="space-y-3 mb-5">
        {p.comments.map((c) => (
          <GlassCard key={c.id} className="p-4 flex items-start gap-3">
            <Avatar name={`${c.first_name} ${c.last_name}`} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-dusk-500 text-sm">{c.first_name} {c.last_name}</span>
                <span className="text-xs text-dusk-200">Unit {c.unit_number}</span>
                <span className="text-xs text-dusk-200 ml-auto">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
              <p className="text-sm text-dusk-400 mt-1 whitespace-pre-line">{c.body}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      <form onSubmit={addComment} className="flex gap-2">
        <input className="input flex-1" placeholder="Share your view..." value={comment} onChange={(e) => setComment(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy}>Post</Button>
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
