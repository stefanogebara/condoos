import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Check } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Avatar from '../../components/Avatar';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';

interface Resident { id: number; first_name: string; last_name: string; unit_number: string; role: string; email: string; }
interface Membership { status: string; condo_name: string; condo_id: number; }

export default function Residents() {
  const [rows, setRows] = useState<Resident[]>([]);
  const [condoName, setCondoName] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiGet<Resident[]>('/users/residents').then(setRows).catch(() => {});
    apiGet<Membership[]>('/onboarding/me').then(async (rows) => {
      const active = rows.find((r) => r.status === 'active');
      if (active) {
        setCondoName(active.condo_name);
        // Re-fetch the condo by pulling /auth/config-style — easiest: hit by-code won't work,
        // so we expose code via a new onboarding GET. For now, derive by name lookup.
        try {
          const info = await apiGet<{ invite_code: string }>(`/onboarding/my-invite-code`);
          setInviteCode(info.invite_code);
        } catch {}
      }
    }).catch(() => {});
  }, []);

  function copy() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    toast.success('Invite code copied');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <PageHeader
        title="Residents"
        subtitle={`${rows.length} ${rows.length === 1 ? 'person' : 'people'} in ${condoName || 'your building'}.`}
      />

      {inviteCode && (
        <GlassCard variant="clay-sage" className="p-6 mb-8">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <Badge tone="dark" className="mb-2">Invite code</Badge>
              <div className="flex items-center gap-3">
                <div className="font-mono text-2xl font-bold text-dusk-500 tracking-[0.24em]">{inviteCode}</div>
                <button onClick={copy} className="text-sm text-dusk-400 hover:text-dusk-500 inline-flex items-center gap-1 underline decoration-dotted underline-offset-4">
                  {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
                </button>
              </div>
            </div>
            <div className="text-sm text-dusk-400 max-w-md">
              Share this code with anyone who should join the building. They visit <span className="font-mono">/onboarding/join</span>, enter it, pick their unit.
            </div>
          </div>
        </GlassCard>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r) => (
          <GlassCard key={r.id} variant="clay" className="p-5 flex items-center gap-4">
            <Avatar name={`${r.first_name} ${r.last_name}`} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-dusk-500 truncate">{r.first_name} {r.last_name}</div>
              <div className="text-xs text-dusk-200 truncate">{r.email}</div>
              <div className="mt-2 flex items-center gap-2">
                {r.unit_number && <Badge tone="neutral">Unit {r.unit_number}</Badge>}
                {r.role === 'board_admin' && <Badge tone="sage">Board</Badge>}
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
