import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Avatar from '../../components/Avatar';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';

interface Resident { id: number; first_name: string; last_name: string; unit_number: string; role: string; email: string; }

export default function Residents() {
  const [rows, setRows] = useState<Resident[]>([]);
  useEffect(() => { apiGet<Resident[]>('/users/residents').then(setRows).catch(() => {}); }, []);

  return (
    <>
      <PageHeader title="Residents" subtitle={`${rows.length} people in Pine Ridge Towers.`} />
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r) => (
          <GlassCard key={r.id} variant="clay" className="p-5 flex items-center gap-4">
            <Avatar name={`${r.first_name} ${r.last_name}`} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-dusk-500 truncate">{r.first_name} {r.last_name}</div>
              <div className="text-xs text-dusk-200 truncate">{r.email}</div>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone="neutral">Unit {r.unit_number}</Badge>
                {r.role === 'board_admin' && <Badge tone="sage">Board</Badge>}
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
