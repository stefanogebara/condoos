import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Play, Check, X, MessageCircle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Avatar from '../../components/Avatar';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';

export default function BoardProposalDetail() {
  const { id } = useParams();
  const [p, setP] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [decision, setDecision] = useState<any>(null);
  const [explainer, setExplainer] = useState<string | null>(null);

  const load = () => apiGet<any>(`/proposals/${id}`).then((d) => {
    setP(d);
    if (d.ai_summary)      { try { setSummary(JSON.parse(d.ai_summary)); } catch {} }
    if (d.ai_explainer)    setExplainer(d.ai_explainer);
    if (d.decision_summary){ try { setDecision(JSON.parse(d.decision_summary)); } catch {} }
  });
  useEffect(() => { load(); }, [id]);

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await apiPost(`/proposals/${id}/status`, { status });
      toast.success(`Status: ${status}`);
      load();
    } finally { setBusy(false); }
  }

  async function summarize() {
    setBusy(true);
    try {
      const data = await apiPost<any>(`/ai/proposals/${id}/summarize-thread`);
      setSummary(data);
      toast.success('Thread summarized');
    } finally { setBusy(false); }
  }

  async function explain() {
    setBusy(true);
    try {
      const data = await apiPost<{ explainer: string }>(`/ai/proposals/${id}/explain`);
      setExplainer(data.explainer);
      toast.success('Explanation generated');
    } finally { setBusy(false); }
  }

  async function closeDecision() {
    setBusy(true);
    try {
      const data = await apiPost<any>(`/ai/proposals/${id}/decision-summary`);
      setDecision(data);
      await apiPost('/announcements', {
        title: data.headline,
        body: `${data.rationale}\n\nNext steps:\n${(data.next_steps || []).map((s: string) => `• ${s}`).join('\n')}`,
        pinned: 1,
        source: 'ai_decision',
        related_proposal_id: Number(id),
      });
      toast.success('Decision summary + announcement published');
      load();
    } finally { setBusy(false); }
  }

  if (!p) return null;

  return (
    <>
      <Link to="/board/proposals" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4"><ArrowLeft className="w-4 h-4" /> Back</Link>
      <PageHeader
        title={p.title}
        subtitle={`${p.author_first} ${p.author_last}${p.estimated_cost ? ` · ~$${p.estimated_cost.toLocaleString()}` : ''}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {p.status === 'discussion' && <Button variant="primary" onClick={() => setStatus('voting')} leftIcon={<Play className="w-4 h-4" />} loading={busy}>Open voting</Button>}
            {p.status === 'voting'     && <Button variant="primary" onClick={closeDecision} leftIcon={<Check className="w-4 h-4" />} loading={busy}>Close & AI decision</Button>}
            {(['voting','discussion'].includes(p.status)) && <Button variant="ghost" onClick={() => setStatus('rejected')} leftIcon={<X className="w-4 h-4" />}>Reject</Button>}
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{p.status}</Badge>
        {p.ai_drafted === 1 && <Badge tone="sage">AI-drafted</Badge>}
        {p.category && <Badge tone="neutral">{p.category}</Badge>}
      </div>

      <GlassCard variant="clay" className="p-7 mb-6">
        <p className="text-dusk-400 whitespace-pre-line leading-relaxed">{p.description}</p>
      </GlassCard>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <GlassCard variant="clay-sage" className="p-5 text-center">
          <div className="font-display text-4xl text-sage-700">{p.votes.yes}</div>
          <div className="text-sm text-dusk-400 mt-1">Yes</div>
        </GlassCard>
        <GlassCard variant="clay-peach" className="p-5 text-center">
          <div className="font-display text-4xl text-peach-500">{p.votes.no}</div>
          <div className="text-sm text-dusk-400 mt-1">No</div>
        </GlassCard>
        <GlassCard className="p-5 text-center">
          <div className="font-display text-4xl text-dusk-300">{p.votes.abstain}</div>
          <div className="text-sm text-dusk-400 mt-1">Abstain</div>
        </GlassCard>
      </div>

      {decision && (
        <GlassCard variant="clay-sage" className="p-7 mb-6">
          <Badge tone="dark" className="mb-3"><Sparkles className="w-3 h-3" /> Board decision summary</Badge>
          <h3 className="font-display text-2xl text-dusk-500">{decision.headline}</h3>
          <p className="text-dusk-400 mt-3 leading-relaxed">{decision.rationale}</p>
          {decision.next_steps?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-dusk-300 mb-1">Next steps</div>
              <ul className="text-sm text-dusk-400 space-y-1">{decision.next_steps.map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
        </GlassCard>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Discussion summary</h3>
            <Button size="sm" variant="ghost" onClick={summarize} loading={busy}>Summarize</Button>
          </div>
          {summary ? (
            <div className="space-y-3 text-sm">
              <p className="text-dusk-400 leading-relaxed">{summary.summary}</p>
              {summary.points_of_agreement?.length    > 0 && <Group label="Agreement"      items={summary.points_of_agreement}    tone="sage"    />}
              {summary.points_of_disagreement?.length > 0 && <Group label="Disagreement"   items={summary.points_of_disagreement} tone="peach"   />}
              {summary.open_questions?.length         > 0 && <Group label="Open questions" items={summary.open_questions}         tone="neutral" />}
            </div>
          ) : <p className="text-sm text-dusk-300">Run a quick read of all {p.comments.length} comments.</p>}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Resident-friendly explainer</h3>
            <Button size="sm" variant="ghost" onClick={explain} loading={busy}>Generate</Button>
          </div>
          {explainer ? <p className="text-sm text-dusk-400 leading-relaxed whitespace-pre-line">{explainer}</p> : <p className="text-sm text-dusk-300">Get a plain-language version to post as an announcement.</p>}
        </GlassCard>
      </div>

      <h3 className="font-display text-xl text-dusk-500 mb-4 flex items-center gap-2"><MessageCircle className="w-5 h-5" /> Discussion ({p.comments.length})</h3>
      <div className="space-y-3">
        {p.comments.map((c: any) => (
          <GlassCard key={c.id} className="p-4 flex items-start gap-3">
            <Avatar name={`${c.first_name} ${c.last_name}`} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-dusk-200">
                <span className="font-medium text-dusk-400">{c.first_name} {c.last_name}</span>
                <span>Unit {c.unit_number}</span>
                <span className="ml-auto">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
              <p className="text-sm text-dusk-400 mt-1">{c.body}</p>
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}

function Group({ label, items, tone }: { label: string; items: string[]; tone: any }) {
  return (
    <div>
      <Badge tone={tone}>{label}</Badge>
      <ul className="mt-2 ml-1 space-y-1">{items.map((t, i) => <li key={i} className="text-dusk-300 text-sm">• {t}</li>)}</ul>
    </div>
  );
}
