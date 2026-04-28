import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, ArrowUp, Sparkles, Copy, Check } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiPost } from '../../lib/api';
import { track } from '../../lib/analytics';

export default function Create() {
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
    adminLivesInBuilding: true,   // unchecked = professional síndico (no unit)
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
      // Strip ownerUnitNumber when the admin doesn't live in the building —
      // backend treats it as a no-unit admin (no user_unit row, can't vote).
      const payload = form.adminLivesInBuilding
        ? form
        : { ...form, ownerUnitNumber: '' };
      const res = await apiPost<{ condoId: number; buildingId: number; inviteCode: string }>(
        '/onboarding/create-building',
        payload,
      );
      track('onboarding_create_succeeded', {
        condo_id: res.condoId,
        floors: form.floors,
        units_per_floor: form.unitsPerFloor,
        voting_model: form.votingModel,
        admin_lives_in_building: form.adminLivesInBuilding,
      });
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
        <Badge tone="sage">Montar um prédio</Badge>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl animate-fade-up">
          {/* Stepper */}
          <div className="flex items-center gap-2 mb-8 text-xs">
            {['Prédio', 'Estrutura', 'Preferências', 'Pronto'].map((label, i) => {
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
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Como o prédio se chama?</h1>
                <p className="text-dusk-300 mt-2 text-sm">Os moradores vão ver esse nome ao entrar.</p>
                <div className="mt-6 space-y-3">
                  <label className="block text-xs text-dusk-300 font-medium">
                    Nome do condomínio
                    <input className="input mt-1" value={form.condoName} onChange={(e) => up('condoName', e.target.value)} maxLength={120} />
                  </label>
                  <label className="block text-xs text-dusk-300 font-medium">
                    Endereço
                    <input className="input mt-1" value={form.address} onChange={(e) => up('address', e.target.value)} maxLength={240} />
                  </label>
                  <label className="block text-xs text-dusk-300 font-medium">
                    Nome do prédio / torre
                    <input className="input mt-1" value={form.buildingName} onChange={(e) => up('buildingName', e.target.value)} maxLength={60} />
                    <span className="text-[11px] text-dusk-200 mt-1 block">ex: "Torre Principal", "Bloco A" — você pode adicionar mais depois.</span>
                  </label>
                </div>
                <div className="mt-8 flex justify-end">
                  <Button
                    variant="primary"
                    onClick={() => setStep(2)}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    disabled={!form.condoName.trim() || !form.address.trim()}
                  >
                    Continuar
                  </Button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Estrutura e sua unidade</h1>
                <p className="text-dusk-300 mt-2 text-sm">
                  Vamos gerar números de unidade tipo 101–{form.floors}{form.unitsPerFloor.toString().padStart(2, '0')}.
                  Pode renomear cada uma depois.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <label className="block text-xs text-dusk-300 font-medium">
                    Andares
                    <input type="number" min={1} max={80} className="input mt-1" value={form.floors} onChange={(e) => up('floors', Math.max(1, Math.min(80, parseInt(e.target.value) || 1)))} />
                  </label>
                  <label className="block text-xs text-dusk-300 font-medium">
                    Unidades por andar
                    <input type="number" min={1} max={40} className="input mt-1" value={form.unitsPerFloor} onChange={(e) => up('unitsPerFloor', Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))} />
                  </label>
                </div>
                <div className="mt-5 p-4 rounded-2xl bg-sage-100 border border-white/60 text-sm text-dusk-500">
                  <strong className="font-display text-lg">{totalUnits}</strong> unidades vão ser criadas
                  {form.floors > 1 && <> em <strong>{form.floors}</strong> andares</>}.
                </div>

                <label className="mt-6 flex items-start gap-3 p-4 rounded-2xl bg-white/60 border border-white/70 cursor-pointer hover:bg-white/80">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!form.adminLivesInBuilding}
                    onChange={(e) => up('adminLivesInBuilding', !e.target.checked)}
                  />
                  <div>
                    <div className="text-sm font-semibold text-dusk-500">Sou síndico mas não moro neste prédio</div>
                    <div className="text-xs text-dusk-300 mt-0.5">
                      Para administradoras / síndicos profissionais. Você gerencia o prédio mas não vai votar nas AGOs (só proprietários votam, conforme o Código Civil).
                    </div>
                  </div>
                </label>

                {form.adminLivesInBuilding && (
                  <label className="block text-xs text-dusk-300 font-medium mt-4">
                    Sua unidade (você é o síndico, então essa é a sua)
                    <input className="input mt-1" value={form.ownerUnitNumber} onChange={(e) => up('ownerUnitNumber', e.target.value.trim())} placeholder="ex: 801 ou Cobertura-1" />
                  </label>
                )}

                <div className="mt-8 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(1)} leftIcon={<ArrowLeft className="w-4 h-4" />}>Voltar</Button>
                  <Button
                    variant="primary"
                    onClick={() => setStep(3)}
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    disabled={form.adminLivesInBuilding && !form.ownerUnitNumber.trim()}
                  >
                    Continuar
                  </Button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Preferências</h1>
                <p className="text-dusk-300 mt-2 text-sm">Padrões sensatos — pode mudar depois.</p>

                <div className="mt-6 space-y-4">
                  <label className="flex items-start gap-3 p-4 rounded-2xl bg-white/60 border border-white/70 cursor-pointer hover:bg-white/80">
                    <input type="checkbox" className="mt-1" checked={form.seedAmenities} onChange={(e) => up('seedAmenities', e.target.checked)} />
                    <div>
                      <div className="text-sm font-semibold text-dusk-500">Pré-cadastrar áreas comuns</div>
                      <div className="text-xs text-dusk-300 mt-0.5">Piscina, academia, churrasqueira, salão de festas. Edita quando quiser.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-4 rounded-2xl bg-white/60 border border-white/70 cursor-pointer hover:bg-white/80">
                    <input type="checkbox" className="mt-1" checked={form.requireApproval} onChange={(e) => up('requireApproval', e.target.checked)} />
                    <div>
                      <div className="text-sm font-semibold text-dusk-500">Exigir aprovação do síndico para novos moradores</div>
                      <div className="text-xs text-dusk-300 mt-0.5">Recomendado. Novos moradores ficam em fila até o síndico aprovar.</div>
                    </div>
                  </label>

                  <div className="p-4 rounded-2xl bg-white/60 border border-white/70">
                    <div className="text-sm font-semibold text-dusk-500">Modelo de votação</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => up('votingModel', 'one_per_unit')}
                        className={`p-3 rounded-xl text-left border transition
                          ${form.votingModel === 'one_per_unit' ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'}`}
                      >
                        <div className="text-sm font-semibold text-dusk-500">Um voto por unidade</div>
                        <div className="text-xs text-dusk-300">Simples e justo.</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => up('votingModel', 'weighted_by_sqft')}
                        className={`p-3 rounded-xl text-left border transition
                          ${form.votingModel === 'weighted_by_sqft' ? 'bg-sage-100 border-sage-300' : 'bg-white/60 border-white/70 hover:bg-white/80'}`}
                      >
                        <div className="text-sm font-semibold text-dusk-500">Ponderado por m²</div>
                        <div className="text-xs text-dusk-300">Comum em condomínios brasileiros.</div>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(2)} leftIcon={<ArrowLeft className="w-4 h-4" />}>Voltar</Button>
                  <Button variant="primary" onClick={submit} loading={saving} rightIcon={<Sparkles className="w-4 h-4" />}>Criar prédio</Button>
                </div>
              </>
            )}

            {step === 4 && inviteCode && (
              <>
                <div className="text-center">
                  <div className="w-14 h-14 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mx-auto">
                    <Check className="w-7 h-7" />
                  </div>
                  <h1 className="font-display text-3xl text-dusk-500 tracking-tight mt-5">Tudo pronto.</h1>
                  <p className="text-dusk-300 mt-2 text-sm">
                    <span className="font-semibold text-dusk-400">{form.condoName}</span> está no ar. Compartilhe este código com os moradores para entrarem:
                  </p>
                </div>

                <div className="mt-6 p-6 rounded-3xl bg-gradient-to-br from-sage-100 to-sage-200 border border-white/60 text-center">
                  <div className="text-xs uppercase tracking-[0.16em] text-dusk-300 mb-3 font-medium">Código de convite</div>
                  <div className="font-mono text-5xl font-bold text-dusk-500 tracking-[0.24em]">{inviteCode}</div>
                  <button
                    onClick={copyCode}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-dusk-500 hover:text-dusk-400 underline decoration-dotted underline-offset-4"
                  >
                    {copied ? <><Check className="w-4 h-4" /> Copiado!</> : <><Copy className="w-4 h-4" /> Copiar código</>}
                  </button>
                </div>

                <div className="mt-6 text-xs text-dusk-300 text-center">
                  Moradores acessam este site, clicam em "Entrar num prédio" e digitam o código.
                </div>

                <div className="mt-8 flex justify-center">
                  <Button variant="primary" onClick={() => { window.location.href = '/board'; }} rightIcon={<ArrowUp className="w-4 h-4 rotate-45" />}>
                    Ir ao painel do síndico
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
