import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { DoorOpen, Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import EmptyState from '../../components/EmptyState';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { formatDateTime } from '../../lib/i18n';

interface Visitor {
  id: number;
  visitor_name: string;
  visitor_type: string;
  status: 'pending' | 'approved' | 'denied' | 'arrived' | 'completed';
  expected_at: string | null;
  notes: string | null;
  created_at: string;
}

export default function Visitors() {
  const [rows, setRows] = useState<Visitor[]>([]);
  const [form, setForm] = useState({ visitor_name: '', visitor_type: 'guest', expected_at: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = () => apiGet<Visitor[]>('/visitors').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.visitor_name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/visitors', {
        ...form,
        expected_at: form.expected_at ? new Date(form.expected_at).toISOString() : null,
      });
      toast.success('Solicitação enviada à portaria');
      setForm({ visitor_name: '', visitor_type: 'guest', expected_at: '', notes: '' });
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  const STATUS_LABEL: Record<Visitor['status'], string> = {
    pending: 'pendente', approved: 'aprovado', denied: 'negado', arrived: 'chegou', completed: 'concluído',
  };
  const TYPE_LABEL: Record<string, string> = {
    guest: 'visita', delivery: 'entrega', service: 'serviço', rideshare: 'app',
  };

  return (
    <>
      <PageHeader
        title="Visitantes"
        subtitle="Avise sobre visitas, entregas ou serviços. A portaria recebe na hora."
        actions={
          <Button onClick={() => setShowForm((x) => !x)} variant={showForm ? 'ghost' : 'primary'} leftIcon={<Plus className="w-4 h-4" />}>
            {showForm ? 'Cancelar' : 'Novo visitante'}
          </Button>
        }
      />

      {showForm && (
        <GlassCard className="p-6 mb-8 animate-fade-up">
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
            <input className="input" placeholder="Nome do visitante"   required value={form.visitor_name} onChange={(e) => setForm({ ...form, visitor_name: e.target.value })} />
            <select className="input" value={form.visitor_type} onChange={(e) => setForm({ ...form, visitor_type: e.target.value })}>
              <option value="guest">Visita</option>
              <option value="delivery">Entrega</option>
              <option value="service">Serviço</option>
              <option value="rideshare">Aplicativo</option>
            </select>
            <input className="input" type="datetime-local" value={form.expected_at} onChange={(e) => setForm({ ...form, expected_at: e.target.value })} />
            <input className="input" placeholder="Observações (opcional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saving}>Enviar solicitação</Button>
            </div>
          </form>
        </GlassCard>
      )}

      {rows.length === 0 && !showForm && (
        <EmptyState title="Nenhum visitante registrado" body="Avise antes para a portaria estar preparada." image="/images/clay-key.png" action={<Button onClick={() => setShowForm(true)} variant="primary">Adicionar visitante</Button>} />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((v) => (
          <GlassCard key={v.id} variant="clay" className="p-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-sage-200 flex items-center justify-center shrink-0">
              <DoorOpen className="w-6 h-6 text-sage-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-dusk-500">{v.visitor_name}</span>
                <Badge tone={v.status === 'approved' ? 'sage' : v.status === 'pending' ? 'warning' : 'neutral'}>{STATUS_LABEL[v.status] || v.status}</Badge>
                <Badge tone="neutral">{TYPE_LABEL[v.visitor_type] || v.visitor_type}</Badge>
              </div>
              {v.expected_at && <div className="text-sm text-dusk-300 mt-1">Previsto para {formatDateTime(v.expected_at)}</div>}
              {v.notes && <div className="text-sm text-dusk-200 mt-1 italic">"{v.notes}"</div>}
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
