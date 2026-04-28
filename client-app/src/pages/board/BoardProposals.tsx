import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { formatCurrency } from '../../lib/i18n';
import { track } from '../../lib/analytics';

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

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'maintenance',    label: 'Manutenção' },
  { value: 'infrastructure', label: 'Infraestrutura' },
  { value: 'safety',         label: 'Segurança' },
  { value: 'amenity',        label: 'Áreas comuns' },
  { value: 'community',      label: 'Convivência' },
  { value: 'policy',         label: 'Convenção / regras' },
  { value: 'financial',      label: 'Financeiro' },
];

export default function BoardProposals() {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = () => apiGet<Proposal[]>('/proposals').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  const grouped = {
    voting:     rows.filter((p) => p.status === 'voting'),
    discussion: rows.filter((p) => p.status === 'discussion'),
    done:       rows.filter((p) => ['approved', 'rejected', 'completed'].includes(p.status)),
  };

  return (
    <>
      <PageHeader
        title="Propostas"
        subtitle="Todas as decisões em andamento. Abrir votação, discutir, resumir, encerrar."
        actions={
          <Button
            onClick={() => setShowForm((x) => !x)}
            variant={showForm ? 'ghost' : 'primary'}
            leftIcon={showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showForm ? 'Cancelar' : 'Nova proposta'}
          </Button>
        }
      />

      {showForm && <NewProposalForm onCreated={() => { setShowForm(false); load(); }} />}

      <Section title="Em votação"   items={grouped.voting} />
      <Section title="Em discussão" items={grouped.discussion} />
      <Section title="Encerradas"   items={grouped.done} />
    </>
  );
}

function NewProposalForm({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'maintenance',
    estimated_cost: '',
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      const cost = form.estimated_cost.trim();
      const parsedCost = cost ? Number(cost.replace(/[^\d]/g, '')) : null;
      const res = await apiPost<{ id: number }>('/proposals', {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        estimated_cost: parsedCost && parsedCost > 0 ? parsedCost : null,
      });
      track('proposal_published', { proposal_id: res.id, category: form.category, ai_drafted: false });
      toast.success('Proposta criada — em discussão');
      onCreated();
      navigate(`/board/proposals/${res.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao criar proposta');
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-6 mb-6 animate-fade-up">
      <h3 className="font-display text-xl text-dusk-500 tracking-tight">Nova proposta</h3>
      <p className="text-sm text-dusk-300 mt-1">
        Cria a proposta direto em <strong>discussão</strong>. Você define quórum + janela e abre a votação quando quiser.
      </p>

      <form onSubmit={submit} className="space-y-3 mt-5">
        <input
          className="input"
          placeholder="Título (ex: Trocar o portão da garagem)"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          maxLength={140}
          required
        />
        <textarea
          className="input min-h-[120px]"
          placeholder="Contexto, motivo, o que vai mudar. Quanto mais claro, mais fácil pros moradores votarem."
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
        />
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block text-xs text-dusk-300 font-medium">
            Categoria
            <select
              className="input mt-1"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-dusk-300 font-medium">
            Custo estimado (R$, opcional)
            <input
              className="input mt-1"
              type="text"
              inputMode="numeric"
              placeholder="ex: 47000"
              value={form.estimated_cost}
              onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" variant="primary" loading={saving} disabled={!form.title.trim() || !form.description.trim()}>
            Criar proposta
          </Button>
        </div>
      </form>
    </GlassCard>
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
                <Badge tone={p.status === 'voting' ? 'peach' : p.status === 'discussion' ? 'sage' : 'neutral'}>{({ discussion: 'em discussão', voting: 'em votação', approved: 'aprovada', rejected: 'reprovada', completed: 'concluída', inconclusive: 'inconclusiva' } as Record<string,string>)[p.status] || p.status}</Badge>
                {p.ai_drafted === 1 && <Badge tone="sage">Redigido pela IA</Badge>}
                {p.category && <Badge tone="neutral">{p.category}</Badge>}
              </div>
              <h3 className="font-display text-lg text-dusk-500">{p.title}</h3>
              <p className="text-sm text-dusk-300 mt-2 line-clamp-2">{p.description}</p>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/50 text-xs">
                <span className="text-dusk-200">por {p.author_first}</span>
                {p.status === 'voting' ? (
                  <span>
                    <span className="text-sage-700 font-semibold">{p.votes.yes}</span>
                    <span className="text-dusk-200 mx-1">·</span>
                    <span className="text-peach-500 font-semibold">{p.votes.no}</span>
                  </span>
                ) : (
                  p.estimated_cost ? <span className="text-dusk-300">~{formatCurrency(p.estimated_cost)}</span> : null
                )}
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}
