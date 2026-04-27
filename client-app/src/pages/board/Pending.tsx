import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, Clock } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Avatar from '../../components/Avatar';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import { apiGet, apiPost } from '../../lib/api';
import { formatDate } from '../../lib/i18n';

interface PendingRequest {
  id: number;
  relationship: 'owner' | 'tenant' | 'occupant';
  primary_contact: number;
  created_at: string;
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  unit_id: number;
  unit_number: string;
  floor: number | null;
  building_name: string;
}

export default function Pending() {
  const [rows, setRows] = useState<PendingRequest[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => apiGet<PendingRequest[]>('/memberships/pending').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  async function act(id: number, action: 'approve' | 'deny') {
    setBusyId(id);
    try {
      await apiPost(`/memberships/${id}/${action}`);
      toast.success(action === 'approve' ? 'Resident approved' : 'Request denied');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || `${action} failed`);
    } finally { setBusyId(null); }
  }

  return (
    <>
      <PageHeader
        title="Pending approvals"
        subtitle="People who requested to join your building. Approve to grant them access; deny to reject."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing pending"
          body="You'll see new residents here when they join with your invite code. Share the code in the Residents page."
          image="/images/clay-key.png"
        />
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <GlassCard key={r.id} variant="clay" className="p-5 flex items-start gap-4">
              <Avatar name={`${r.first_name} ${r.last_name}`} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-lg text-dusk-500">{r.first_name} {r.last_name}</span>
                  <Badge tone="warning"><Clock className="w-3 h-3" /> pending</Badge>
                  <Badge tone="neutral">{r.relationship}</Badge>
                  {r.primary_contact === 1 && <Badge tone="sage">primary contact</Badge>}
                </div>
                <div className="text-sm text-dusk-300 mt-1">{r.email}</div>
                <div className="text-xs text-dusk-200 mt-1">
                  Claiming <span className="font-semibold text-dusk-400">Unit {r.unit_number}</span>
                  {r.floor !== null && ` · Floor ${r.floor}`} · {r.building_name} · requested {formatDate(r.created_at)}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<X className="w-3.5 h-3.5" />}
                  onClick={() => act(r.id, 'deny')}
                  loading={busyId === r.id}
                >
                  Deny
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Check className="w-3.5 h-3.5" />}
                  onClick={() => act(r.id, 'approve')}
                  loading={busyId === r.id}
                >
                  Approve
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </>
  );
}
