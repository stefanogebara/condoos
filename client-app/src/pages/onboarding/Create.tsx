import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, ArrowUp, Sparkles, Copy, Check, Plus, Trash2, Link as LinkIcon, MessageCircle, Mail } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiPost } from '../../lib/api';
import { track } from '../../lib/analytics';

interface BuildingBlock { name: string; floors: number; unitsPerFloor: number; }

const MAX_BLOCKS = 12;     // matches backend createSchema.buildings.max(12)
const MAX_FLOORS = 80;
const MAX_UNITS_PER_FLOOR = 40;

export default function Create() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [form, setForm] = useState({
    condoName: 'Vila Nova Residences',
    address: '200 Avenida Paulista, São Paulo SP',
    blocks: [{ name: 'Torre Principal', floors: 8, unitsPerFloor: 4 }] as BuildingBlock[],
    ownerUnitNumber: '801',
    adminLivesInBuilding: true,   // unchecked = professional síndico (no unit)
    seedAmenities: true,
    requireApproval: true,
    votingModel: 'one_per_unit' as 'one_per_unit' | 'weighted_by_sqft',
  });
  const up = <K extends keyof typeof form>(key: K, val: typeof form[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  function updateBlock(idx: number, patch: Partial<BuildingBlock>) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    }));
  }
  function addBlock() {
    setForm((f) => {
      if (f.blocks.length >= MAX_BLOCKS) return f;
      const nextIdx = f.blocks.length + 1;
      return {
        ...f,
        blocks: [...f.blocks, { name: `Bloco ${nextIdx}`, floors: 4, unitsPerFloor: 2 }],
      };
    });
  }
  function removeBlock(idx: number) {
    setForm((f) => (f.blocks.length <= 1 ? f : { ...f, blocks: f.blocks.filter((_, i) => i !== idx) }));
  }

  const totalUnits = form.blocks.reduce((sum, b) => sum + b.floors * b.unitsPerFloor, 0);
  const blocksValid = form.blocks.every(
    (b) => b.name.trim().length > 0 && b.floors >= 1 && b.unitsPerFloor >= 1,
  );

  async function submit() {
    setSaving(true);
    try {
      // Backend createSchema requires buildingName/floors/unitsPerFloor. When
      // multiple blocks are present we also send buildings[] which takes
      // precedence; for a single block the legacy fields are enough.
      const first = form.blocks[0];
      const payload = {
        condoName: form.condoName,
        address: form.address,
        buildingName: first.name,
        floors: first.floors,
        unitsPerFloor: first.unitsPerFloor,
        buildings: form.blocks.length > 1 ? form.blocks : undefined,
        ownerUnitNumber: form.adminLivesInBuilding ? form.ownerUnitNumber : '',
        seedAmenities: form.seedAmenities,
        requireApproval: form.requireApproval,
        votingModel: form.votingModel,
      };
      const res = await apiPost<{ condoId: number; buildingId: number; inviteCode: string }>(
        '/onboarding/create-building',
        payload,
      );
      track('onboarding_create_succeeded', {
        condo_id: res.condoId,
        block_count: form.blocks.length,
        total_units: totalUnits,
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

  // Deep-link contract: landing reads ?code= and forwards through the
  // "Sou morador" CTA into /onboarding/join with the code pre-filled.
  const inviteUrl = inviteCode
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://condoos.one'}/?code=${encodeURIComponent(inviteCode)}`
    : '';
  const inviteMessage = inviteCode
    ? `Você foi convidado(a) para ${form.condoName} no CondoOS. Entre por este link (o código já vem preenchido): ${inviteUrl}`
    : '';
  function copyInviteLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setLinkCopied(true);
    track('invite_link_copied', { method: 'copy' });
    setTimeout(() => setLinkCopied(false), 2000);
  }
  function shareWhatsApp() {
    if (!inviteMessage) return;
    track('invite_link_copied', { method: 'whatsapp' });
    window.open(`https://wa.me/?text=${encodeURIComponent(inviteMessage)}`, '_blank', 'noopener,noreferrer');
  }
  function shareEmail() {
    if (!inviteMessage || !inviteCode) return;
    track('invite_link_copied', { method: 'email' });
    const subject = `Convite — ${form.condoName} no CondoOS`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(inviteMessage)}`;
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
                </div>
                <p className="text-[11px] text-dusk-200 mt-3">Os blocos / torres você cadastra no próximo passo — pode ter mais de um.</p>
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
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Blocos e sua unidade</h1>
                <p className="text-dusk-300 mt-2 text-sm">
                  Cadastre cada torre ou bloco. Para um único prédio, deixe como está.
                  Vamos gerar números tipo <span className="font-mono">101</span>, <span className="font-mono">102</span>… (renomeáveis depois).
                </p>

                <div className="mt-6 space-y-3">
                  {form.blocks.map((block, idx) => (
                    <div key={idx} className="p-4 rounded-2xl bg-white/60 border border-white/70">
                      <div className="flex items-start gap-2 mb-3">
                        <label className="flex-1 block text-xs text-dusk-300 font-medium">
                          Nome do bloco
                          <input
                            className="input mt-1"
                            value={block.name}
                            onChange={(e) => updateBlock(idx, { name: e.target.value })}
                            maxLength={60}
                            placeholder="ex: Torre A, Bloco 1, Cobertura"
                          />
                        </label>
                        {form.blocks.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeBlock(idx)}
                            className="mt-5 p-2 text-dusk-300 hover:text-peach-600 transition"
                            title="Remover bloco"
                            aria-label={`Remover bloco ${block.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs text-dusk-300 font-medium">
                          Andares
                          <input
                            type="number" min={1} max={MAX_FLOORS}
                            className="input mt-1"
                            value={block.floors}
                            onChange={(e) => updateBlock(idx, { floors: Math.max(1, Math.min(MAX_FLOORS, parseInt(e.target.value) || 1)) })}
                          />
                        </label>
                        <label className="block text-xs text-dusk-300 font-medium">
                          Unidades por andar
                          <input
                            type="number" min={1} max={MAX_UNITS_PER_FLOOR}
                            className="input mt-1"
                            value={block.unitsPerFloor}
                            onChange={(e) => updateBlock(idx, { unitsPerFloor: Math.max(1, Math.min(MAX_UNITS_PER_FLOOR, parseInt(e.target.value) || 1)) })}
                          />
                        </label>
                      </div>
                      <div className="text-[11px] text-dusk-300 mt-2">
                        {block.floors * block.unitsPerFloor} unidades neste bloco
                      </div>
                    </div>
                  ))}

                  {form.blocks.length < MAX_BLOCKS && (
                    <button
                      type="button"
                      onClick={addBlock}
                      className="w-full p-3 rounded-2xl border border-dashed border-dusk-200 text-sm text-dusk-400 hover:bg-white/40 hover:text-dusk-500 transition flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Adicionar bloco
                    </button>
                  )}
                </div>

                <div className="mt-5 p-4 rounded-2xl bg-sage-100 border border-white/60 text-sm text-dusk-500">
                  <strong className="font-display text-lg">{totalUnits}</strong> unidades no total
                  {form.blocks.length > 1 && <> em <strong>{form.blocks.length}</strong> blocos</>}.
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
                    disabled={!blocksValid || (form.adminLivesInBuilding && !form.ownerUnitNumber.trim())}
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

                <div className="mt-6">
                  <div className="text-xs uppercase tracking-[0.14em] text-dusk-300 font-medium text-center mb-3">
                    Compartilhe direto com os moradores
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={copyInviteLink}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/60 border border-white/70 hover:bg-white/80 transition text-dusk-500"
                    >
                      {linkCopied
                        ? <Check className="w-5 h-5 text-sage-700" />
                        : <LinkIcon className="w-5 h-5" />}
                      <span className="text-xs font-medium">{linkCopied ? 'Copiado!' : 'Copiar link'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={shareWhatsApp}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/60 border border-white/70 hover:bg-white/80 transition text-dusk-500"
                    >
                      <MessageCircle className="w-5 h-5 text-sage-700" />
                      <span className="text-xs font-medium">WhatsApp</span>
                    </button>
                    <button
                      type="button"
                      onClick={shareEmail}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/60 border border-white/70 hover:bg-white/80 transition text-dusk-500"
                    >
                      <Mail className="w-5 h-5 text-peach-500" />
                      <span className="text-xs font-medium">Email</span>
                    </button>
                  </div>
                  <div className="text-[11px] text-dusk-300 mt-3 text-center break-all font-mono">
                    {inviteUrl}
                  </div>
                </div>

                <div className="mt-5 text-xs text-dusk-300 text-center">
                  Quem clicar no link cai direto no cadastro com o código já preenchido — não precisa digitar nada.
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
