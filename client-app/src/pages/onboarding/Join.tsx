import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Clock, Key, Home, Users } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiGet, apiPost } from '../../lib/api';
import { track } from '../../lib/analytics';

interface UnitOpt { id: number; floor: number | null; number: string; claims: number; }
interface CondoInfo {
  condo: { id: number; name: string; address: string; building_name: string; require_approval: boolean };
  units: UnitOpt[];
}

export default function Join() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code')?.toUpperCase() || '');
  const [condoInfo, setCondoInfo] = useState<CondoInfo | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [relationship, setRelationship] = useState<'owner' | 'tenant' | 'occupant'>('tenant');
  const [busy, setBusy] = useState(false);

  async function lookup() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const info = await apiGet<CondoInfo>(`/onboarding/by-code/${encodeURIComponent(code.trim())}`);
      setCondoInfo(info);
      setStep(2);
    } catch (err: any) {
      toast.error(err?.response?.data?.error === 'unknown_code' ? "That code doesn't match any building" : 'Lookup failed');
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!condoInfo || !selectedUnitId) return;
    setBusy(true);
    try {
      const res = await apiPost<{ status: 'pending' | 'active' }>('/onboarding/join', {
        code: code.trim(),
        unit_id: selectedUnitId,
        relationship,
        primary_contact: true,
      });
      track('onboarding_join_succeeded', {
        membership_status: res.status,
        relationship,
        condo_name: condoInfo?.condo?.name,
      });
      if (res.status === 'active') {
        toast.success('You\'re in!');
        window.location.href = '/app';
      } else {
        setStep(3);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Join failed');
    } finally { setBusy(false); }
  }

  const selectedUnit = condoInfo?.units.find((u) => u.id === selectedUnitId);

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-6 lg:px-12 py-5 flex items-center justify-between">
        <Link to="/onboarding" className="flex items-center gap-4 text-dusk-300 hover:text-dusk-500">
          <ArrowLeft className="w-4 h-4" /> <Logo size={22} />
        </Link>
        <Badge tone="peach">Join a building</Badge>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl animate-fade-up">
          <GlassCard variant="clay" className="p-8">
            {step === 1 && (
              <>
                <div className="w-14 h-14 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center mx-auto mb-5">
                  <Key className="w-7 h-7" />
                </div>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight text-center">Enter your invite code</h1>
                <p className="text-dusk-300 mt-2 text-sm text-center">A 6-character code your board sent you.</p>
                <div className="mt-6 max-w-xs mx-auto">
                  <input
                    className="input text-center font-mono text-2xl tracking-[0.3em] uppercase"
                    maxLength={12}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    autoFocus
                  />
                </div>
                <div className="mt-8 flex justify-center">
                  <Button variant="primary" onClick={lookup} loading={busy} rightIcon={<ArrowRight className="w-4 h-4" />} disabled={code.trim().length < 4}>Continue</Button>
                </div>
                <p className="mt-8 text-xs text-dusk-200 text-center">
                  Don't have a code? <Link to="/onboarding/create" className="underline hover:text-dusk-400">Create your own building</Link> instead.
                </p>
              </>
            )}

            {step === 2 && condoInfo && (
              <>
                <div className="mb-6 p-4 rounded-2xl bg-sage-100 border border-white/70">
                  <Badge tone="sage" className="mb-1">Building found</Badge>
                  <div className="font-display text-2xl text-dusk-500">{condoInfo.condo.name}</div>
                  <div className="text-xs text-dusk-300 mt-0.5">{condoInfo.condo.address} · {condoInfo.condo.building_name}</div>
                </div>

                <h2 className="font-display text-xl text-dusk-500 tracking-tight flex items-center gap-2"><Home className="w-5 h-5" /> Pick your unit</h2>
                <p className="text-xs text-dusk-300 mt-1 mb-4">Units with claimants are marked — you can still select them if you're moving in / sharing.</p>

                <div className="max-h-72 overflow-auto -mx-1 pr-2 grid grid-cols-3 md:grid-cols-4 gap-2">
                  {condoInfo.units.map((u) => {
                    const active = selectedUnitId === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setSelectedUnitId(u.id)}
                        className={`p-3 rounded-2xl text-left text-sm transition border
                          ${active ? 'bg-dusk-400 text-cream-50 border-dusk-400 shadow-clay' :
                                    'bg-white/60 border-white/70 hover:bg-white/80 text-dusk-500'}`}
                      >
                        <div className="font-mono font-semibold">{u.number}</div>
                        <div className={`text-[11px] ${active ? 'text-cream-50/70' : 'text-dusk-300'}`}>
                          {u.floor !== null ? `Floor ${u.floor}` : 'Special'}{u.claims > 0 && ` · ${u.claims} here`}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <h2 className="font-display text-xl text-dusk-500 tracking-tight mt-8 flex items-center gap-2"><Users className="w-5 h-5" /> How are you connected?</h2>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { k: 'owner', label: 'Owner', hint: 'I own this unit' },
                    { k: 'tenant', label: 'Tenant', hint: 'I rent this unit' },
                    { k: 'occupant', label: 'Occupant', hint: 'Family / other' },
                  ].map((r) => (
                    <button
                      key={r.k}
                      type="button"
                      onClick={() => setRelationship(r.k as any)}
                      className={`p-3 rounded-2xl text-center text-sm transition border
                        ${relationship === r.k ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'}`}
                    >
                      <div className="font-semibold text-dusk-500">{r.label}</div>
                      <div className="text-[11px] text-dusk-300">{r.hint}</div>
                    </button>
                  ))}
                </div>

                <div className="mt-8 flex justify-between items-center">
                  <Button variant="ghost" onClick={() => { setStep(1); setCondoInfo(null); setSelectedUnitId(null); }} leftIcon={<ArrowLeft className="w-4 h-4" />}>Back</Button>
                  <Button variant="primary" onClick={submit} loading={busy} rightIcon={<ArrowRight className="w-4 h-4" />} disabled={!selectedUnitId}>
                    {condoInfo.condo.require_approval ? 'Request to join' : 'Join now'}
                  </Button>
                </div>
              </>
            )}

            {step === 3 && condoInfo && selectedUnit && (
              <div className="text-center py-4">
                <div className="w-14 h-14 rounded-2xl bg-peach-100 text-peach-500 flex items-center justify-center mx-auto">
                  <Clock className="w-7 h-7" />
                </div>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight mt-5">Request sent</h1>
                <p className="text-dusk-300 mt-3 text-sm max-w-md mx-auto">
                  You claimed <span className="font-semibold text-dusk-500">Unit {selectedUnit.number}</span> at {condoInfo.condo.name} as <span className="font-semibold text-dusk-500">{relationship}</span>.
                  The board will review your request. You'll get access as soon as they approve.
                </p>
                <Button variant="ghost" onClick={() => navigate('/onboarding')} className="mt-8">Back to onboarding</Button>
              </div>
            )}
          </GlassCard>
        </div>
      </main>
    </div>
  );
}
