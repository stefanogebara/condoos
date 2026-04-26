import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Check, Upload, Mail, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Avatar from '../../components/Avatar';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';

interface Resident { id: number; first_name: string; last_name: string; unit_number: string; role: string; email: string; }
interface Membership { status: string; condo_name: string; condo_id: number; }
interface ImportError { row: number; error: string; email?: string; unit?: string; }
interface Invite {
  id: number;
  email: string;
  status: string;
  email_status: 'sent' | 'skipped' | 'failed' | null;
  email_sent_at: string | null;
  email_error: string | null;
  relationship: 'owner' | 'tenant' | 'occupant';
  primary_contact: number;
  voting_weight: number;
  unit_number: string;
  floor: number | null;
  building_name: string;
  created_at: string;
  claimed_by_user_id: number | null;
}

function describeImportError(e: ImportError): string {
  const details = e.unit ? ` (${e.unit})` : e.email ? ` (${e.email})` : '';
  const labels: Record<string, string> = {
    need_email_and_unit: 'Missing email or unit',
    invalid_email: 'Invalid email',
    unit_not_found: 'Unit not found',
    already_invited: 'Already invited',
  };
  return `Row ${e.row}: ${labels[e.error] || e.error}${details}`;
}

export default function Residents() {
  const [rows, setRows] = useState<Resident[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [condoName, setCondoName] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState('email,unit,relationship,primary_contact,voting_weight\nmaria@example.com,502,tenant,no,1\njoao@example.com,101,owner,yes,1\n');
  const [sendEmails, setSendEmails] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [sendingInviteId, setSendingInviteId] = useState<number | null>(null);

  const load = () => {
    apiGet<Resident[]>('/users/residents').then(setRows).catch(() => {});
    apiGet<Invite[]>('/memberships/invites').then(setInvites).catch(() => {});
    apiGet<Membership[]>('/onboarding/me').then(async (rows) => {
      const active = rows.find((r) => r.status === 'active');
      if (active) {
        setCondoName(active.condo_name);
        try {
          const info = await apiGet<{ invite_code: string }>(`/onboarding/my-invite-code`);
          setInviteCode(info.invite_code);
        } catch {}
      }
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function importCsv() {
    setImporting(true);
    setImportErrors([]);
    try {
      const res = await apiPost<{ imported_count: number; error_count: number; errors: ImportError[]; email_delivery?: Array<{ delivery: { status: string } }> }>(
        '/memberships/import-csv',
        { csv, send_emails: sendEmails },
      );
      if (res.imported_count > 0) toast.success(`${res.imported_count} invite${res.imported_count > 1 ? 's' : ''} created`);
      if (sendEmails && res.email_delivery) {
        const sent = res.email_delivery.filter((d) => d.delivery.status === 'sent').length;
        if (sent > 0) toast.success(`${sent} invite email${sent > 1 ? 's' : ''} sent`);
        if (sent < res.email_delivery.length) toast.error('Some invite emails were not sent. Check email settings.');
      }
      if (res.error_count > 0) {
        setImportErrors(res.errors || []);
        toast.error(`${res.error_count} row${res.error_count > 1 ? 's' : ''} skipped - details below`);
      } else {
        setShowImport(false);
      }
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  }

  function copy() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    toast.success('Invite code copied');
    setTimeout(() => setCopied(false), 2000);
  }

  async function sendInviteEmail(invite: Invite) {
    setSendingInviteId(invite.id);
    try {
      await apiPost(`/memberships/invites/${invite.id}/send-email`);
      toast.success(`Invite email sent to ${invite.email}`);
      load();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code === 'email_not_configured' ? 'Email delivery is not configured' : code || 'Email send failed');
    } finally {
      setSendingInviteId(null);
    }
  }

  const pendingInvites = invites.filter((i) => i.status === 'pending');

  return (
    <>
      <PageHeader
        title="Moradores"
        subtitle={`${rows.length} ${rows.length === 1 ? 'pessoa' : 'pessoas'} no ${condoName || 'seu prédio'}.`}
        actions={
          <Button onClick={() => setShowImport((x) => !x)} variant={showImport ? 'ghost' : 'primary'} leftIcon={<Upload className="w-4 h-4" />}>
            {showImport ? 'Cancelar' : 'Importar CSV'}
          </Button>
        }
      />

      {inviteCode && (
        <GlassCard variant="clay-sage" className="p-6 mb-6">
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

      {showImport && (
        <GlassCard className="p-6 mb-6 animate-fade-up">
          <h3 className="font-display text-xl text-dusk-500 tracking-tight">Bulk import resident roster</h3>
          <p className="text-sm text-dusk-300 mt-1">
            Paste a CSV below. Columns: <span className="font-mono">email,unit,relationship,primary_contact,voting_weight</span>.
            When a resident signs in with that email, they're auto-linked to their unit — no admin approval needed.
          </p>
          <textarea
            className="input mt-4 min-h-[180px] font-mono text-[13px]"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            spellCheck={false}
          />
          <label className="mt-4 flex items-start gap-3 rounded-2xl bg-white/45 border border-white/60 p-3 text-sm text-dusk-400">
            <input
              type="checkbox"
              checked={sendEmails}
              onChange={(e) => setSendEmails(e.target.checked)}
              className="mt-1"
            />
            <span>
              Email each imported resident an invite link now.
              <span className="block text-xs text-dusk-300 mt-0.5">Requires Resend env vars. Invites are still created if email is not configured.</span>
            </span>
          </label>
          {importErrors.length > 0 && (
            <div role="alert" className="mt-4 rounded-2xl border border-peach-200 bg-peach-100/70 p-4 text-sm text-dusk-500">
              <div className="font-semibold mb-2">Rows that need attention</div>
              <ul className="space-y-1">
                {importErrors.map((e, idx) => <li key={`${e.row}-${idx}`}>{describeImportError(e)}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowImport(false)} leftIcon={<X className="w-4 h-4" />}>Cancelar</Button>
            <Button variant="primary" onClick={importCsv} loading={importing} leftIcon={<Mail className="w-4 h-4" />}>
              {sendEmails ? 'Criar e enviar convites' : 'Criar convites'}
            </Button>
          </div>
        </GlassCard>
      )}

      {pendingInvites.length > 0 && (
        <div className="mb-6">
          <h3 className="font-display text-lg text-dusk-500 mb-3">Pending invites ({pendingInvites.length})</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingInvites.map((i) => (
              <GlassCard key={i.id} className="p-4 flex items-center gap-3 bg-white/40">
                <div className="w-9 h-9 rounded-xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-dusk-500 truncate">{i.email}</div>
                  <div className="text-xs text-dusk-300">
                    Unit {i.unit_number} · {i.relationship}{i.primary_contact === 1 ? ' · primary' : ''} · weight {i.voting_weight}
                  </div>
                </div>
                <Badge tone="warning">pending</Badge>
                <div className="flex flex-col items-end gap-2">
                  {i.email_status === 'sent' && <Badge tone="sage">emailed</Badge>}
                  {i.email_status === 'failed' && <Badge tone="warning">email failed</Badge>}
                  {i.email_status !== 'sent' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => sendInviteEmail(i)}
                      loading={sendingInviteId === i.id}
                    >
                      Email
                    </Button>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
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
