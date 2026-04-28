import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Play, Check, X, MessageCircle, Vote, AlertTriangle, Calculator } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Avatar from '../../components/Avatar';
import Button from '../../components/Button';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/i18n';

const QUORUM_OPTIONS = [0, 25, 50, 67, 75];

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  discussion: 'em discussão', voting: 'em votação', approved: 'aprovada',
  rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva',
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function BoardProposalDetail() {
  const { id } = useParams();
  const [p, setP] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [decision, setDecision] = useState<any>(null);
  const [explainer, setExplainer] = useState<string | null>(null);
  const [form, setForm] = useState<{ quorum: number; opens: string; closes: string }>({ quorum: 0, opens: '', closes: '' });

  const load = useCallback(() => apiGet<any>(`/proposals/${id}`).then((d) => {
    setP(d);
    setForm({
      quorum: d.quorum_percent || 0,
      opens:  toLocalInput(d.voting_opens_at),
      closes: toLocalInput(d.voting_closes_at),
    });
    if (d.ai_summary)      { try { setSummary(JSON.parse(d.ai_summary)); } catch {} }
    if (d.ai_explainer)    setExplainer(d.ai_explainer);
    if (d.decision_summary){ try { setDecision(JSON.parse(d.decision_summary)); } catch {} }
  }), [id]);
  useEffect(() => { load(); }, [load]);

  async function saveCompliance() {
    setBusy(true);
    try {
      await apiPatch(`/proposals/${id}/compliance`, {
        quorum_percent:    form.quorum,
        voting_opens_at:   fromLocalInput(form.opens),
        voting_closes_at:  fromLocalInput(form.closes),
      });
      toast.success('Regras de votação atualizadas');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao atualizar');
    } finally { setBusy(false); }
  }

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await apiPost(`/proposals/${id}/status`, { status });
      toast.success(`Status: ${PROPOSAL_STATUS_LABEL[status] || status}`);
      load();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === 'missing_cost_estimate') {
        toast.error('Adicione um custo estimado antes de abrir a votação. Use "Analisar com IA" se preferir.');
      } else {
        toast.error(code || 'Falha ao atualizar status');
      }
    } finally { setBusy(false); }
  }

  async function analyzeCost() {
    setBusy(true);
    try {
      await apiPost<{ estimated_cost: number; cost_breakdown: string; risk_summary: string }>(`/ai/proposals/${id}/analyze-cost`);
      toast.success('Análise gerada');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao analisar com IA');
    } finally { setBusy(false); }
  }

  async function summarize() {
    setBusy(true);
    try {
      const data = await apiPost<any>(`/ai/proposals/${id}/summarize-thread`);
      setSummary(data);
      toast.success('Discussão resumida');
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
      toast.success('Decisão e comunicado publicados');
      load();
    } finally { setBusy(false); }
  }

  if (!p) return null;

  return (
    <>
      <Link to="/board/proposals" className="inline-flex items-center gap-1 text-sm text-dusk-300 hover:text-dusk-500 mb-4"><ArrowLeft className="w-4 h-4" /> Voltar</Link>
      <PageHeader
        title={p.title}
        subtitle={`${p.author_first} ${p.author_last}${p.estimated_cost ? ` · ~${formatCurrency(p.estimated_cost)}` : ''}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {p.status === 'discussion' && <Button variant="primary" onClick={() => setStatus('voting')} leftIcon={<Play className="w-4 h-4" />} loading={busy}>Abrir votação</Button>}
            {p.status === 'voting'     && <Button variant="primary" onClick={closeDecision} leftIcon={<Check className="w-4 h-4" />} loading={busy}>Encerrar e gerar decisão</Button>}
            {p.status === 'voting' && (
              <Link
                to={`/app/proposals/${id}`}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-white/50 backdrop-blur-md border border-white/60 text-dusk-400 hover:bg-white/70 transition-all"
              >
                <Vote className="w-4 h-4" /> Votar como proprietário
              </Link>
            )}
            {(['voting','discussion'].includes(p.status)) && <Button variant="ghost" onClick={() => setStatus('rejected')} leftIcon={<X className="w-4 h-4" />}>Reprovar</Button>}
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{({ discussion: 'em discussão', voting: 'em votação', approved: 'aprovada', rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva' } as Record<string,string>)[p.status] || p.status}</Badge>
        {p.ai_drafted === 1 && <Badge tone="sage">Redigido pela IA</Badge>}
        {p.category && <Badge tone="neutral">{p.category}</Badge>}
        <Badge tone={p.voter_eligibility === 'owners_only' ? 'peach' : 'neutral'}>
          {p.voter_eligibility === 'owners_only' ? 'Só proprietários'
           : p.voter_eligibility === 'primary_contact_only' ? 'Um voto por unidade'
           : 'Todos os moradores votam'}
        </Badge>
      </div>

      <GlassCard variant="clay" className="p-7 mb-6">
        <p className="text-dusk-400 whitespace-pre-line leading-relaxed">{p.description}</p>
      </GlassCard>

      {/* Pre-vote analysis (#13) — block opening voting until estimated_cost is set. */}
      {(p.status === 'discussion' || p.cost_breakdown || p.risk_summary) && (
        <GlassCard variant={p.estimated_cost > 0 ? 'clay-sage' : 'clay'} className="p-6 mb-6">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-dusk-400" />
              <h3 className="font-display text-lg text-dusk-500">Análise pré-votação</h3>
              {p.estimated_cost > 0 && <Badge tone="sage">~{formatCurrency(p.estimated_cost)}</Badge>}
              {(!p.estimated_cost || p.estimated_cost <= 0) && p.status === 'discussion' && (
                <Badge tone="warning">Custo não definido</Badge>
              )}
            </div>
            {p.status === 'discussion' && (
              <Button size="sm" variant="ghost" onClick={analyzeCost} loading={busy} leftIcon={<Sparkles className="w-4 h-4" />}>
                {p.cost_breakdown ? 'Re-analisar com IA' : 'Analisar com IA'}
              </Button>
            )}
          </div>
          {p.cost_breakdown ? (
            <div>
              <div className="text-xs uppercase tracking-wider text-dusk-300 mb-1 font-medium">Custos</div>
              <pre className="text-sm text-dusk-400 whitespace-pre-wrap font-sans leading-relaxed">{p.cost_breakdown}</pre>
            </div>
          ) : (
            <p className="text-sm text-dusk-300">
              Os moradores precisam de uma estimativa de custo + riscos antes de votar. A IA gera tudo a partir do título e descrição — só revisar.
            </p>
          )}
          {p.risk_summary && (
            <div className="mt-4 pt-4 border-t border-white/60">
              <div className="text-xs uppercase tracking-wider text-dusk-300 mb-1 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Riscos e considerações
              </div>
              <p className="text-sm text-dusk-400 leading-relaxed whitespace-pre-line">{p.risk_summary}</p>
            </div>
          )}
        </GlassCard>
      )}

      {p.status === 'discussion' && (
        <GlassCard className="p-5 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wider text-dusk-300 font-medium">Quem vota nesta proposta?</div>
              <div className="text-sm text-dusk-400 mt-1">Defina antes de abrir a votação — não pode mudar depois.</div>
            </div>
            <select
              value={p.voter_eligibility || 'all'}
              onChange={async (e) => {
                try {
                  await apiPatch(`/proposals/${id}/eligibility`, { voter_eligibility: e.target.value });
                  load();
                } catch (err: any) { toast.error(err?.response?.data?.error || 'Falha ao atualizar'); }
              }}
              className="input max-w-xs"
            >
              <option value="all">Todos os moradores (incluindo inquilinos)</option>
              <option value="owners_only">Só proprietários (capex / despesas do condomínio)</option>
              <option value="primary_contact_only">Um voto por unidade — contato principal</option>
            </select>
          </div>
        </GlassCard>
      )}

      {p.status === 'discussion' && (
        <GlassCard className="p-5 mb-6">
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-dusk-300 font-medium">Quórum e janela</div>
            <div className="text-sm text-dusk-400 mt-1">Quórum + janela aplicados no fechamento. Quórum não batido → inconclusiva.</div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-dusk-300 uppercase tracking-wider">Quórum</label>
              <select
                value={form.quorum}
                onChange={(e) => setForm({ ...form, quorum: Number(e.target.value) })}
                className="input mt-1"
              >
                {QUORUM_OPTIONS.map((q) => (
                  <option key={q} value={q}>{q === 0 ? 'Sem quórum' : `${q}%`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-dusk-300 uppercase tracking-wider">Abertura da votação</label>
              <input
                type="datetime-local"
                value={form.opens}
                onChange={(e) => setForm({ ...form, opens: e.target.value })}
                className="input mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-dusk-300 uppercase tracking-wider">Fechamento da votação</label>
              <input
                type="datetime-local"
                value={form.closes}
                onChange={(e) => setForm({ ...form, closes: e.target.value })}
                className="input mt-1"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" size="sm" onClick={saveCompliance} loading={busy}>Salvar regras de votação</Button>
          </div>
        </GlassCard>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <GlassCard variant="clay-sage" className="p-5 text-center">
          <div className="font-display text-4xl text-sage-700">{p.votes.yes}</div>
          <div className="text-sm text-dusk-400 mt-1">Sim</div>
          {p.votes.yes_weight !== p.votes.yes && <div className="text-xs text-dusk-300 mt-1">peso {p.votes.yes_weight}</div>}
        </GlassCard>
        <GlassCard variant="clay-peach" className="p-5 text-center">
          <div className="font-display text-4xl text-peach-500">{p.votes.no}</div>
          <div className="text-sm text-dusk-400 mt-1">Não</div>
          {p.votes.no_weight !== p.votes.no && <div className="text-xs text-dusk-300 mt-1">peso {p.votes.no_weight}</div>}
        </GlassCard>
        <GlassCard className="p-5 text-center">
          <div className="font-display text-4xl text-dusk-300">{p.votes.abstain}</div>
          <div className="text-sm text-dusk-400 mt-1">Abstenção</div>
          {p.votes.abstain_weight !== p.votes.abstain && <div className="text-xs text-dusk-300 mt-1">peso {p.votes.abstain_weight}</div>}
        </GlassCard>
      </div>

      {p.quorum && (p.quorum.quorum_percent > 0 || p.status === 'voting') && (
        <GlassCard className="p-4 mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
            <div className="text-dusk-400">
              <span className="font-medium">Comparecimento:</span> {p.quorum.turnout_percent}%
              {p.quorum.quorum_percent > 0 && <span className="text-dusk-300"> / {p.quorum.quorum_percent}% exigido</span>}
              <span className="text-dusk-300"> · {p.quorum.votes_cast} de {p.quorum.eligible_voter_count} votaram</span>
            </div>
            <Badge tone={p.quorum.quorum_met ? 'sage' : 'peach'}>
              {p.quorum.quorum_met ? 'Quórum atingido' : 'Quórum ainda não atingido'}
            </Badge>
          </div>
        </GlassCard>
      )}

      {p.status === 'inconclusive' && (
        <GlassCard variant="clay-peach" className="p-5 mb-6">
          <Badge tone="peach" className="mb-2">Inconclusiva</Badge>
          <p className="text-dusk-500 text-sm">
            A janela de votação fechou sem atingir o quórum de {p.quorum_percent}%. Nenhuma decisão registrada. Você pode reabrir uma nova proposta com janela maior ou quórum mais baixo.
          </p>
        </GlassCard>
      )}

      {decision && (
        <GlassCard variant="clay-sage" className="p-7 mb-6">
          <Badge tone="dark" className="mb-3"><Sparkles className="w-3 h-3" /> Resumo da decisão</Badge>
          <h3 className="font-display text-2xl text-dusk-500">{decision.headline}</h3>
          <p className="text-dusk-400 mt-3 leading-relaxed">{decision.rationale}</p>
          {decision.next_steps?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-dusk-300 mb-1">Próximos passos</div>
              <ul className="text-sm text-dusk-400 space-y-1">{decision.next_steps.map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
        </GlassCard>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Resumo da discussão</h3>
            <Button size="sm" variant="ghost" onClick={summarize} loading={busy}>Resumir</Button>
          </div>
          {summary ? (
            <div className="space-y-3 text-sm">
              <p className="text-dusk-400 leading-relaxed">{summary.summary}</p>
              {summary.points_of_agreement?.length    > 0 && <Group label="Concordância"  items={summary.points_of_agreement}    tone="sage"    />}
              {summary.points_of_disagreement?.length > 0 && <Group label="Discordância"  items={summary.points_of_disagreement} tone="peach"   />}
              {summary.open_questions?.length         > 0 && <Group label="Em aberto"     items={summary.open_questions}         tone="neutral" />}
            </div>
          ) : <p className="text-sm text-dusk-300">Faça uma leitura rápida dos {p.comments.length} comentários.</p>}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-lg text-dusk-500 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Versão para morador</h3>
            <Button size="sm" variant="ghost" onClick={explain} loading={busy}>Gerar</Button>
          </div>
          {explainer ? <p className="text-sm text-dusk-400 leading-relaxed whitespace-pre-line">{explainer}</p> : <p className="text-sm text-dusk-300">Versão em linguagem simples para usar num comunicado.</p>}
        </GlassCard>
      </div>

      <h3 className="font-display text-xl text-dusk-500 mb-4 flex items-center gap-2"><MessageCircle className="w-5 h-5" /> Discussão ({p.comments.length})</h3>
      <div className="space-y-3">
        {p.comments.map((c: any) => (
          <GlassCard key={c.id} className="p-4 flex items-start gap-3">
            <Avatar name={`${c.first_name} ${c.last_name}`} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-dusk-200">
                <span className="font-medium text-dusk-400">{c.first_name} {c.last_name}</span>
                <span>Unidade {c.unit_number}</span>
                <span className="ml-auto">{formatDate(c.created_at)}</span>
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
