import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gavel } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';

interface Assembly {
  id: number;
  title: string;
  kind: 'ordinary' | 'extraordinary';
  status: 'draft' | 'convoked' | 'in_session' | 'closed';
  first_call_at: string;
}

export default function Assemblies() {
  const [rows, setRows] = useState<Assembly[]>([]);
  const load = useCallback(() => apiGet<Assembly[]>('/assemblies').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  // Residents only care about convoked / in-session / closed assemblies.
  const visible = rows.filter((a) => a.status !== 'draft');

  return (
    <>
      <PageHeader title="Assemblies" subtitle="AGO / AGE — grant a proxy if you can't attend, or vote live." />
      <div className="space-y-4">
        {visible.length === 0 && (
          <GlassCard className="p-8 text-center">
            <Gavel className="w-10 h-10 mx-auto text-dusk-200 mb-3" />
            <p className="text-dusk-400">Nenhuma assembleia agendada.</p>
          </GlassCard>
        )}
        {visible.map((a) => (
          <Link key={a.id} to={`/app/assemblies/${a.id}`}>
            <GlassCard variant="clay" hover className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-peach-200 text-peach-700 flex items-center justify-center shrink-0">
                <Gavel className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-lg text-dusk-500">{a.title}</h3>
                  <Badge tone={a.status === 'in_session' ? 'sage' : a.status === 'closed' ? 'dark' : 'peach'}>
                    {a.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="text-sm text-dusk-300 mt-1">{new Date(a.first_call_at).toLocaleString('pt-BR')}</div>
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}
