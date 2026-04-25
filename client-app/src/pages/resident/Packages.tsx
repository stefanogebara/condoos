import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Package, CheckCircle2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import EmptyState from '../../components/EmptyState';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';

interface Pkg {
  id: number;
  carrier: string;
  description: string;
  arrived_at: string;
  picked_up_at: string | null;
  status: 'waiting' | 'picked_up';
}

export default function Packages() {
  const [rows, setRows] = useState<Pkg[]>([]);

  const load = () => apiGet<Pkg[]>('/packages').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function pickup(id: number) {
    await apiPost(`/packages/${id}/pickup`);
    toast.success('Encomenda retirada');
    load();
  }

  const waiting = rows.filter((r) => r.status === 'waiting');
  const collected = rows.filter((r) => r.status === 'picked_up');

  return (
    <>
      <PageHeader title="Encomendas" subtitle="Tudo aguardando você na portaria." />

      {rows.length === 0 && <EmptyState title="Nenhuma encomenda ainda" body="As entregas aparecem aqui no momento que chegam." image="/images/clay-mail.png" />}

      {waiting.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mb-4">Aguardando retirada</h2>
          <div className="grid md:grid-cols-2 gap-4 mb-10">
            {waiting.map((p) => (
              <GlassCard key={p.id} variant="clay" className="p-5 flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-peach-100 flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-peach-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-dusk-500">{p.carrier}</span>
                    <Badge tone="peach">aguardando</Badge>
                  </div>
                  <div className="text-sm text-dusk-300">{p.description || '—'}</div>
                  <div className="text-xs text-dusk-200 mt-1">Chegou em {new Date(p.arrived_at).toLocaleDateString('pt-BR')}</div>
                </div>
                <Button size="sm" variant="sage" onClick={() => pickup(p.id)} leftIcon={<CheckCircle2 className="w-4 h-4" />}>
                  Retirei
                </Button>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {collected.length > 0 && (
        <>
          <h2 className="font-display text-xl text-dusk-500 mb-4">Retiradas recentes</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {collected.map((p) => (
              <GlassCard key={p.id} className="p-4 flex items-center gap-3 opacity-70">
                <CheckCircle2 className="w-4 h-4 text-sage-600" />
                <span className="text-sm font-medium text-dusk-400">{p.carrier} · {p.description || '—'}</span>
              </GlassCard>
            ))}
          </div>
        </>
      )}
    </>
  );
}
