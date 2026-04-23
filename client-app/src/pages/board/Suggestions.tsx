import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Sparkles, Wand2, ArrowRight } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Avatar from '../../components/Avatar';
import { apiGet, apiPost } from '../../lib/api';

interface Suggestion {
  id: number;
  body: string;
  status: string;
  category: string | null;
  cluster_id: number | null;
  cluster_label: string | null;
  created_at: string;
  first_name: string;
  last_name: string;
  unit_number: string;
}

interface Cluster {
  id: number;
  label: string;
  summary: string;
  members: Suggestion[];
}

export default function Suggestions() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [drafting, setDrafting] = useState<number | null>(null);

  const load = () => Promise.all([
    apiGet<Suggestion[]>('/suggestions').then(setRows),
    apiGet<Cluster[]>('/suggestions/clusters').then(setClusters),
  ]).catch(() => {});
  useEffect(() => { load(); }, []);

  async function cluster() {
    setLoading(true);
    try {
      await apiPost('/ai/cluster-suggestions');
      toast.success('Clustered with AI');
      load();
    } finally { setLoading(false); }
  }

  async function dismiss(id: number) {
    setBusyId(id);
    try {
      await apiPost(`/suggestions/${id}/dismiss`);
      load();
    } finally { setBusyId(null); }
  }

  async function promote(s: Suggestion) {
    setDrafting(s.id);
    try {
      const draft = await apiPost<any>('/ai/proposal-draft', { text: s.body });
      const proposal = await apiPost<{ id: number }>('/proposals', {
        title: draft.title,
        description: draft.description,
        category: draft.category,
        estimated_cost: draft.estimated_cost,
        ai_drafted: true,
        source_suggestion_id: s.id,
      });
      toast.success('Promoted to a proposal');
      navigate(`/board/proposals/${proposal.id}`);
    } finally { setDrafting(null); }
  }

  const unclustered = rows.filter((r) => !r.cluster_id && r.status === 'open');

  return (
    <>
      <PageHeader
        title="Resident suggestions"
        subtitle="Raw input from residents. Cluster related items, promote to proposals, or dismiss."
        actions={<Button variant="primary" leftIcon={<Wand2 className="w-4 h-4" />} onClick={cluster} loading={loading}>Cluster with AI</Button>}
      />

      {/* Clusters */}
      {clusters.length > 0 && (
        <div className="space-y-5 mb-10">
          {clusters.map((c) => (
            <GlassCard key={c.id} variant="clay-sage" className="p-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <Badge tone="dark"><Sparkles className="w-3 h-3" /> Cluster</Badge>
                  <h3 className="font-display text-2xl text-dusk-500 mt-2">{c.label}</h3>
                  <p className="text-sm text-dusk-300 mt-1">{c.summary}</p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => promote(c.members[0])}
                  loading={drafting === c.members[0]?.id}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Draft proposal
                </Button>
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                {c.members.map((m) => <SuggestionCard key={m.id} s={m} compact />)}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {unclustered.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mb-4">{clusters.length > 0 ? 'Unclustered' : 'Open suggestions'}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {unclustered.map((s) => (
              <SuggestionCard key={s.id} s={s}
                actions={
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => dismiss(s.id)} loading={busyId === s.id}>Dismiss</Button>
                    <Button size="sm" variant="primary" onClick={() => promote(s)} loading={drafting === s.id}>Promote</Button>
                  </div>
                }
              />
            ))}
          </div>
        </>
      )}

      {rows.length > 0 && unclustered.length === 0 && clusters.length === 0 && (
        <GlassCard className="p-6 text-sm text-dusk-300">All clear! Run the AI clusterer above when new suggestions come in.</GlassCard>
      )}
    </>
  );
}

function SuggestionCard({ s, compact, actions }: { s: Suggestion; compact?: boolean; actions?: React.ReactNode }) {
  return (
    <GlassCard className={compact ? 'p-4' : 'p-5'}>
      <div className="flex items-start gap-3">
        <Avatar name={`${s.first_name} ${s.last_name}`} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-dusk-200">
            <span className="font-medium text-dusk-400">{s.first_name} {s.last_name}</span>
            <span>Unit {s.unit_number}</span>
            {s.cluster_label && <Badge tone="sage">{s.cluster_label}</Badge>}
          </div>
          <p className="text-sm text-dusk-400 mt-1">{s.body}</p>
          {actions && <div className="mt-3">{actions}</div>}
        </div>
      </div>
    </GlassCard>
  );
}
