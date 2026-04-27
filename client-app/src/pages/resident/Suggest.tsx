import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Sparkles, Send, ArrowRight, Lightbulb } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiPost } from '../../lib/api';
import { track } from '../../lib/analytics';
import { formatCurrency } from '../../lib/i18n';

interface Draft {
  title: string;
  description: string;
  category: string;
  estimated_cost: number | null;
  rationale: string;
  _fallback?: boolean;
}

export default function Suggest() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [suggestionId, setSuggestionId] = useState<number | null>(null);

  async function submitRaw() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost<{ id: number }>('/suggestions', { body: text });
      setSuggestionId(res.id);
      toast.success('Enviado ao síndico');
      setDrafting(true);
      try {
        const d = await apiPost<Draft>('/ai/proposal-draft', { text });
        track('proposal_drafted', { category: d.category, has_estimate: d.estimated_cost != null, fallback: !!d._fallback });
        setDraft(d);
      } finally { setDrafting(false); }
    } finally { setSaving(false); }
  }

  async function promoteToProposal() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await apiPost<{ id: number }>('/proposals', {
        title: draft.title,
        description: draft.description,
        category: draft.category,
        estimated_cost: draft.estimated_cost,
        ai_drafted: true,
        source_suggestion_id: suggestionId,
      });
      track('proposal_published', { proposal_id: res.id, category: draft.category, ai_drafted: true });
      toast.success('Proposta criada — em discussão');
      navigate(`/app/proposals/${res.id}`);
    } finally { setSaving(false); }
  }

  const examples = [
    'O ar do saguão mal está funcionando. Ontem marcou 30°C aqui dentro.',
    'Podemos colocar carregadores de carro elétrico na garagem?',
    'A esteira #3 da academia faz um barulho alto quando alguém usa.',
  ];

  return (
    <>
      <PageHeader
        title="Sugerir algo"
        subtitle="Conta o que tá pegando. A IA transforma sua ideia numa proposta pronta pro síndico."
      />

      <GlassCard variant="clay" className="p-7 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-lg text-dusk-500">O que tá pegando?</h3>
            <p className="text-xs text-dusk-300">Pode ser informal. Escreva como falaria com um vizinho.</p>
          </div>
        </div>
        <textarea
          className="input min-h-[140px] resize-none"
          placeholder="ex: O ar do saguão tá quebrado, marca 30°C aqui dentro..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={drafting || !!draft}
        />
        {!draft && (
          <>
            <div className="flex items-center justify-between mt-4 gap-2 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setText(ex)}
                    className="chip hover:bg-white/70 transition"
                  >
                    {ex.length > 44 ? ex.slice(0, 44) + '...' : ex}
                  </button>
                ))}
              </div>
              <Button onClick={submitRaw} variant="primary" loading={saving || drafting} rightIcon={<Send className="w-4 h-4" />} disabled={!text.trim()}>
                {drafting ? 'IA redigindo...' : 'Enviar'}
              </Button>
            </div>
          </>
        )}
      </GlassCard>

      {drafting && (
        <GlassCard className="p-7 text-center animate-fade-up">
          <div className="w-14 h-14 rounded-full bg-sage-200 text-sage-700 flex items-center justify-center mx-auto animate-pulse">
            <Sparkles className="w-6 h-6" />
          </div>
          <p className="mt-4 text-dusk-400">A IA está transformando sua ideia em uma proposta estruturada...</p>
        </GlassCard>
      )}

      {draft && (
        <GlassCard variant="clay-sage" className="p-7 animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <Badge tone="sage"><Sparkles className="w-3 h-3" /> Proposta redigida pela IA</Badge>
            {draft._fallback && <Badge tone="warning">modo offline</Badge>}
            <Badge tone="neutral">{draft.category}</Badge>
            {draft.estimated_cost && <Badge tone="neutral">~{formatCurrency(draft.estimated_cost)}</Badge>}
          </div>
          <h3 className="font-display text-2xl text-dusk-500 leading-tight">{draft.title}</h3>
          <p className="text-sm text-dusk-300 mt-1 italic">{draft.rationale}</p>
          <div className="mt-4 p-4 rounded-2xl bg-white/60 backdrop-blur-sm border border-white/70">
            <p className="text-dusk-400 leading-relaxed whitespace-pre-line">{draft.description}</p>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2 flex-wrap">
            <Button variant="ghost" onClick={() => { setDraft(null); setSuggestionId(null); setText(''); }}>
              Recomeçar
            </Button>
            <Button variant="primary" onClick={promoteToProposal} loading={saving} rightIcon={<ArrowRight className="w-4 h-4" />}>
              Enviar ao síndico
            </Button>
          </div>
        </GlassCard>
      )}
    </>
  );
}
