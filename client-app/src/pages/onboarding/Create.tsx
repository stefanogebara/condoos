import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, ArrowUp, Sparkles, Copy, Check } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiPost } from '../../lib/api';

export default function Create() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    condoName: 'Vila Nova Residences',
    address: '200 Avenida Paulista, São Paulo SP',
    buildingName: 'Main Tower',
    floors: 8,
    unitsPerFloor: 4,
    ownerUnitNumber: '801',
    seedAmenities: true,
    requireApproval: true,
    votingModel: 'one_per_unit' as 'one_per_unit' | 'weighted_by_sqft',
  });
  const up = <K extends keyof typeof form>(key: K, val: typeof form[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const totalUnits = form.floors * form.unitsPerFloor;

  async function submit() {
    setSaving(true);
    try {
      const res = await apiPost<{ condoId: number; buildingId: number; inviteCode: string }>(
        '/onboarding/create-building',
        form,
      );
      setInviteCode(res.inviteCode);
      setStep(4);
      // Refresh our JWT-bound user (role is now board_admin).
      // Easiest path: force a full page reload on "Go to dashboard".
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create building');
    } finally {
      setSaving(false);
    }
  }

  function copyCode() {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-6 lg:px-12 py-5 flex items-center justify-between">
        <Link to="/onboarding" className="flex items-center gap-4 text-dusk-300 hover:text-dusk-500">
          <ArrowLeft className="w-4 h-4" /> <Logo size={22} />
        </Link>
        <Badge tone="sage">Create a building</Badge>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl animate-fade-up">
          {/* Stepper */}
          <div className="flex items-center gap-2 mb-8 text-xs">
            {['Building', 'Structure', 'Preferences', 'Done'].map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3 | 4;
              const active = step === n;
              const done = step > n;
              return (
                <div key={label} className="flex items-center gap-2 flex-1">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold
                      ${done ? 'bg-sage-400 text-white' : active ? 'bg-dusk-400 text-cream-50' : 'bg-white/60 text-dusk-300 border border-white/60'}`}
                  >
                    {done ? '✓' : n}
                  </div>
                  <div className={`text-xs font-medium ${active ? 'text-dusk-500' : 'text-dusk-300'}`}>{label}</div>
                  {i < 3 && <div className={`flex-1 h-[1.5px] ${done ? 'bg-sage-400' : 'bg-white/70'}`} />}
                </div>
              );
            })}
          </div>

          <GlassCard variant="clay" className="p-8">
            {step === 1 && (
              <>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">What's your building called?</h1>
                <p className="text-dusk-300 mt-2 text-sm">Residents will see this name when they join.</p>
                <div className="mt-6 space-y-3">
                  <label className="block text-xs text-dusk-300 font-medium">
                    Condo / community name
                    <input className="input mt-1" value={form.condoName} onChange={(e) => up('condoName', e.target.value)} maxLength={120} />
                  </label>
                  <label className="block text-xs text-dusk-300 font-medium">
                    Address
                    <input className="input mt-1" value={form.address} onChange={(e) => up('address', e.target.value)} maxLength={240} />
                  </label>
                  <label className="block text-xs text-dusk-300 font-medium">
                    Building / tower name
                    <input className="input mt-1" value={form.buildingName} onChange={(e) => up('buildingName', e.target.value)} maxLength={60} />
                    <span className="text-[11px] text-dusk-200 mt-1 block">e.g. "Main Tower", "Block A" — you can add more later.</span>
                  </label>
                </div>
                <div className="mt-8 flex justify-end">
                  <Button
                    variant="primary"
                    onClick={() => setStep(2)}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    disabled={!form.condoName.trim() || !form.address.trim()}
                  >
                    Continue
                  </Button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Structure & your unit</h1>
                <p className="text-dusk-300 mt-2 text-sm">
                  We'll generate unit numbers like 101-{form.floors}{form.unitsPerFloor.toString().padStart(2, '0')}.
                  You can rename individual units later.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <label className="block text-xs text-dusk-300 font-medium">
                    Floors
                    <input type="number" min={1} max={80} className="input mt-1" value={form.floors} onChange={(e) => up('floors', Math.max(1, Math.min(80, parseInt(e.target.value) || 1)))} />
                  </label>
                  <label className="block text-xs text-dusk-300 font-medium">
                    Units per floor
                    <input type="number" min={1} max={40} className="input mt-1" value={form.unitsPerFloor} onChange={(e) => up('unitsPerFloor', Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))} />
                  </label>
                </div>
                <div className="mt-5 p-4 rounded-2xl bg-sage-100 border border-white/60 text-sm text-dusk-500">
                  <strong className="font-display text-lg">{totalUnits}</strong> units will be created
                  {form.floors > 1 && <> across <strong>{form.floors}</strong> floors</>}.
                </div>

                <label className="block text-xs text-dusk-300 font-medium mt-6">
                  Your unit number (you'll own this one as the board admin)
                  <input className="input mt-1" value={form.ownerUnitNumber} onChange={(e) => up('ownerUnitNumber', e.target.value.trim())} placeholder="e.g. 801 or PH-1" />
                </label>

                <div className="mt-8 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(1)} leftIcon={<ArrowLeft className="w-4 h-4" />}>Back</Button>
                  <Button variant="primary" onClick={() => setStep(3)} rightIcon={<ArrowRight className="w-4 h-4" />} disabled={!form.ownerUnitNumber.trim()}>Continue</Button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Preferences</h1>
                <p className="text-dusk-300 mt-2 text-sm">Sensible defaults — you can change these later.</p>

                <div className="mt-6 space-y-4">
                  <label className="flex items-start gap-3 p-4 rounded-2xl bg-white/60 border border-white/70 cursor-pointer hover:bg-white/80">
                    <input type="checkbox" className="mt-1" checked={form.seedAmenities} onChange={(e) => up('seedAmenities', e.target.checked)} />
                    <div>
                      <div className="text-sm font-semibold text-dusk-500">Pre-populate common amenities</div>
                      <div className="text-xs text-dusk-300 mt-0.5">Pool, fitness center, BBQ grill, party room. Edit anytime.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-4 rounded-2xl bg-white/60 border border-white/70 cursor-pointer hover:bg-white/80">
                    <input type="checkbox" className="mt-1" checked={form.requireApproval} onChange={(e) => up('requireApproval', e.target.checked)} />
                    <div>
                      <div className="text-sm font-semibold text-dusk-500">Require admin approval for new residents</div>
                      <div className="text-xs text-dusk-300 mt-0.5">Recommended. New residents go into a pending queue until a board member approves.</div>
                    </div>
                  </label>

                  <div className="p-4 rounded-2xl bg-white/60 border border-white/70">
                    <div className="text-sm font-semibold text-dusk-500">Voting model</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => up('votingModel', 'one_per_unit')}
                        className={`p-3 rounded-xl text-left border transition
                          ${form.votingModel === 'one_per_unit' ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'}`}
                      >
                        <div className="text-sm font-semibold text-dusk-500">One vote per unit</div>
                        <div className="text-xs text-dusk-300">Simple and fair.</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => up('votingModel', 'weighted_by_sqft')}
                        className={`p-3 rounded-xl text-left border transition
                          ${form.votingModel === 'weighted_by_sqft' ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'}`}
                      >
                        <div className="text-sm font-semibold text-dusk-500">Weighted by m² / sqft</div>
                        <div className="text-xs text-dusk-300">Common in Brazilian condomínios.</div>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(2)} leftIcon={<ArrowLeft className="w-4 h-4" />}>Back</Button>
                  <Button variant="primary" onClick={submit} loading={saving} rightIcon={<Sparkles className="w-4 h-4" />}>Create building</Button>
                </div>
              </>
            )}

            {step === 4 && inviteCode && (
              <>
                <div className="text-center">
                  <div className="w-14 h-14 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mx-auto">
                    <Check className="w-7 h-7" />
                  </div>
                  <h1 className="font-display text-3xl text-dusk-500 tracking-tight mt-5">You're in.</h1>
                  <p className="text-dusk-300 mt-2 text-sm">
                    <span className="font-semibold text-dusk-400">{form.condoName}</span> is live. Share this code with residents so they can join:
                  </p>
                </div>

                <div className="mt-6 p-6 rounded-3xl bg-gradient-to-br from-sage-100 to-sage-200 border border-white/60 text-center">
                  <div className="text-xs uppercase tracking-[0.16em] text-dusk-300 mb-3 font-medium">Invite code</div>
                  <div className="font-mono text-5xl font-bold text-dusk-500 tracking-[0.24em]">{inviteCode}</div>
                  <button
                    onClick={copyCode}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-dusk-500 hover:text-dusk-400 underline decoration-dotted underline-offset-4"
                  >
                    {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy code</>}
                  </button>
                </div>

                <div className="mt-6 text-xs text-dusk-300 text-center">
                  Residents visit this site, click "Join a building", and enter the code.
                </div>

                <div className="mt-8 flex justify-center">
                  <Button variant="primary" onClick={() => { window.location.href = '/board'; }} rightIcon={<ArrowUp className="w-4 h-4 rotate-45" />}>
                    Go to the board dashboard
                  </Button>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      </main>
    </div>
  );
}
