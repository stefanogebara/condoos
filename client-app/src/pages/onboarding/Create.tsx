import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, ArrowUp, Sparkles, Copy, Check, Plus, Trash2, Link as LinkIcon, MessageCircle, Mail, Dumbbell, Waves, Trophy, PartyPopper, Wrench, Phone, ShieldCheck } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Button from '../../components/Button';
import Badge from '../../components/Badge';
import { apiPost } from '../../lib/api';
import { track } from '../../lib/analytics';

interface BuildingBlock {
  name: string;
  floors: number;
  unitsPerFloor: number;
  floorUnitCounts: number[];
}
interface AmenityDraft {
  name: string;
  description: string;
  icon: string;
  capacity: number;
  open_hour: number;
  close_hour: number;
  slot_minutes: number;
  booking_window_days: number;
}
interface ServiceContactDraft {
  category: string;
  company_name: string;
  contact_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
  service_scope: string;
  notes: string;
  contract_url: string;
  emergency_available: boolean;
  preferred: boolean;
  active: boolean;
  last_used_at: string;
}

const MAX_BLOCKS = 12;     // matches backend createSchema.buildings.max(12)
const MAX_FLOORS = 80;
const MAX_UNITS_PER_FLOOR = 40;
const AMENITY_PRESETS: AmenityDraft[] = [
  { name: 'Academia', description: 'Musculação, cardio e alongamento', icon: 'Dumbbell', capacity: 20, open_hour: 5, close_hour: 23, slot_minutes: 60, booking_window_days: 14 },
  { name: 'Quadra de padel', description: 'Reserva por quadra, até quatro jogadores', icon: 'Trophy', capacity: 4, open_hour: 7, close_hour: 22, slot_minutes: 90, booking_window_days: 14 },
  { name: 'Campo de futebol', description: 'Campo reservado para um grupo', icon: 'Trophy', capacity: 14, open_hour: 8, close_hour: 22, slot_minutes: 90, booking_window_days: 14 },
  { name: 'Quadra de basquete', description: 'Meia quadra ou quadra inteira', icon: 'Trophy', capacity: 10, open_hour: 7, close_hour: 22, slot_minutes: 60, booking_window_days: 14 },
  { name: 'Quadra de tênis', description: 'Simples ou duplas', icon: 'Trophy', capacity: 4, open_hour: 7, close_hour: 22, slot_minutes: 60, booking_window_days: 14 },
  { name: 'Piscina', description: 'Piscina e deck', icon: 'Waves', capacity: 30, open_hour: 7, close_hour: 22, slot_minutes: 60, booking_window_days: 14 },
  { name: 'Salão de festas', description: 'Eventos com cozinha e mesas', icon: 'PartyPopper', capacity: 40, open_hour: 9, close_hour: 23, slot_minutes: 180, booking_window_days: 60 },
];
const AMENITY_ICONS: Record<string, any> = { Dumbbell, Waves, Trophy, PartyPopper };
const SERVICE_CATEGORIES = [
  { value: 'electrical', label: 'Elétrica' },
  { value: 'plumbing', label: 'Hidráulica' },
  { value: 'elevator', label: 'Elevadores' },
  { value: 'gym_equipment', label: 'Academia / equipamentos' },
  { value: 'pool', label: 'Piscina' },
  { value: 'cleaning', label: 'Limpeza' },
  { value: 'security', label: 'Segurança / portaria' },
  { value: 'landscaping', label: 'Jardim' },
  { value: 'internet_cctv', label: 'Internet / CFTV' },
  { value: 'pest_control', label: 'Dedetização' },
  { value: 'general_maintenance', label: 'Manutenção geral' },
  { value: 'legal_admin', label: 'Jurídico / contábil' },
  { value: 'other', label: 'Outro' },
];
const SERVICE_PRESETS: Array<Pick<ServiceContactDraft, 'category' | 'service_scope' | 'notes'>> = [
  { category: 'electrical', service_scope: 'Quadros, disjuntores, iluminação, tomadas e emergências elétricas.', notes: '' },
  { category: 'plumbing', service_scope: 'Vazamentos, bombas, caixa d’água, registros e manutenção hidráulica.', notes: '' },
  { category: 'elevator', service_scope: 'Manutenção preventiva, chamados e emergência dos elevadores.', notes: '' },
  { category: 'gym_equipment', service_scope: 'Instalação, manutenção e garantia de equipamentos da academia.', notes: 'Ex: fabricante das esteiras, instalador dos aparelhos, empresa de manutenção.' },
  { category: 'pool', service_scope: 'Tratamento químico, bombas, aquecimento, limpeza e manutenção da piscina.', notes: '' },
  { category: 'security', service_scope: 'Portaria, alarmes, câmeras, controle de acesso e ronda.', notes: '' },
  { category: 'cleaning', service_scope: 'Equipe terceirizada, limpeza pesada, pós-obra e suprimentos.', notes: '' },
  { category: 'general_maintenance', service_scope: 'Pequenos reparos, pintura, serralheria, marcenaria e apoio de obra.', notes: '' },
];

function clampInt(raw: number, min: number, max: number) {
  const next = Number.isFinite(raw) ? Math.trunc(raw) : min;
  return Math.max(min, Math.min(max, next));
}

function makeFloorUnitCounts(floors: number, fallbackUnits: number, existing: number[] = []) {
  const safeFloors = clampInt(floors, 1, MAX_FLOORS);
  const safeFallback = clampInt(fallbackUnits, 0, MAX_UNITS_PER_FLOOR);
  return Array.from({ length: safeFloors }, (_, idx) => (
    existing[idx] === undefined
      ? safeFallback
      : clampInt(existing[idx], 0, MAX_UNITS_PER_FLOOR)
  ));
}

function createBlock(name: string, floors: number, unitsPerFloor: number): BuildingBlock {
  return {
    name,
    floors,
    unitsPerFloor,
    floorUnitCounts: makeFloorUnitCounts(floors, unitsPerFloor),
  };
}

function unitsInBlock(block: BuildingBlock) {
  return makeFloorUnitCounts(block.floors, block.unitsPerFloor, block.floorUnitCounts)
    .reduce((sum, count) => sum + count, 0);
}

function normalizeBlock(block: BuildingBlock) {
  const floorUnitCounts = makeFloorUnitCounts(block.floors, block.unitsPerFloor, block.floorUnitCounts);
  const fallbackUnits = floorUnitCounts.find((count) => count > 0) || 1;
  return {
    name: block.name.trim(),
    floors: floorUnitCounts.length,
    unitsPerFloor: clampInt(block.unitsPerFloor || fallbackUnits, 1, MAX_UNITS_PER_FLOOR),
    floorUnitCounts,
  };
}

function blankServiceContact(preset?: Partial<ServiceContactDraft>): ServiceContactDraft {
  return {
    category: preset?.category || 'general_maintenance',
    company_name: preset?.company_name || '',
    contact_name: preset?.contact_name || '',
    phone: preset?.phone || '',
    whatsapp: preset?.whatsapp || '',
    email: preset?.email || '',
    website: preset?.website || '',
    address: preset?.address || '',
    service_scope: preset?.service_scope || '',
    notes: preset?.notes || '',
    contract_url: preset?.contract_url || '',
    emergency_available: preset?.emergency_available || false,
    preferred: preset?.preferred ?? true,
    active: preset?.active ?? true,
    last_used_at: preset?.last_used_at || '',
  };
}

function serviceContactHasReachableDetail(contact: ServiceContactDraft) {
  return [
    contact.phone,
    contact.whatsapp,
    contact.email,
    contact.website,
    contact.address,
    contact.notes,
  ].some((value) => value.trim().length > 0);
}

function normalizeServiceContact(contact: ServiceContactDraft) {
  return {
    category: contact.category,
    company_name: contact.company_name.trim(),
    contact_name: contact.contact_name.trim() || null,
    phone: contact.phone.trim() || null,
    whatsapp: contact.whatsapp.trim() || null,
    email: contact.email.trim() || null,
    website: contact.website.trim() || null,
    address: contact.address.trim() || null,
    service_scope: contact.service_scope.trim() || null,
    notes: contact.notes.trim() || null,
    contract_url: contact.contract_url.trim() || null,
    emergency_available: contact.emergency_available,
    preferred: contact.preferred,
    active: contact.active,
    last_used_at: contact.last_used_at || null,
  };
}

export default function Create() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [saving, setSaving] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [form, setForm] = useState({
    condoName: 'Vila Nova Residences',
    address: '200 Avenida Paulista, São Paulo SP',
    blocks: [createBlock('Torre Principal', 8, 4)] as BuildingBlock[],
    ownerUnitNumber: '801',
    adminLivesInBuilding: true,   // unchecked = professional síndico (no unit)
    seedAmenities: true,
    amenities: AMENITY_PRESETS.slice(0, 4) as AmenityDraft[],
    serviceContacts: [
      blankServiceContact({ category: 'electrical', service_scope: 'Quadros, iluminação, tomadas e emergências elétricas.', emergency_available: true }),
      blankServiceContact({ category: 'gym_equipment', service_scope: 'Fabricante, instalador ou manutenção dos equipamentos da academia.', notes: 'Preencha fabricante, instalador, garantia ou empresa que já conhece os aparelhos.' }),
    ] as ServiceContactDraft[],
    requireApproval: true,
    votingModel: 'one_per_unit' as 'one_per_unit' | 'weighted_by_sqft',
  });
  const up = <K extends keyof typeof form>(key: K, val: typeof form[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  function updateBlock(idx: number, patch: Partial<BuildingBlock>) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b, i) => {
        if (i !== idx) return b;
        const next = { ...b, ...patch };
        return {
          ...next,
          floors: clampInt(next.floors, 1, MAX_FLOORS),
          unitsPerFloor: clampInt(next.unitsPerFloor, 1, MAX_UNITS_PER_FLOOR),
          floorUnitCounts: makeFloorUnitCounts(next.floors, next.unitsPerFloor, next.floorUnitCounts),
        };
      }),
    }));
  }
  function updateBlockFloors(idx: number, floors: number) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b, i) => (
        i === idx
          ? {
              ...b,
              floors: clampInt(floors, 1, MAX_FLOORS),
              floorUnitCounts: makeFloorUnitCounts(floors, b.unitsPerFloor, b.floorUnitCounts),
            }
          : b
      )),
    }));
  }
  function applyUnitsToAllFloors(idx: number, unitsPerFloor: number) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b, i) => {
        if (i !== idx) return b;
        const safeUnits = clampInt(unitsPerFloor, 1, MAX_UNITS_PER_FLOOR);
        return {
          ...b,
          unitsPerFloor: safeUnits,
          floorUnitCounts: makeFloorUnitCounts(b.floors, safeUnits),
        };
      }),
    }));
  }
  function updateFloorUnits(blockIdx: number, floorIdx: number, units: number) {
    setForm((f) => ({
      ...f,
      blocks: f.blocks.map((b, i) => {
        if (i !== blockIdx) return b;
        const floorUnitCounts = makeFloorUnitCounts(b.floors, b.unitsPerFloor, b.floorUnitCounts);
        floorUnitCounts[floorIdx] = clampInt(units, 0, MAX_UNITS_PER_FLOOR);
        return { ...b, floorUnitCounts };
      }),
    }));
  }
  function addBlock() {
    setForm((f) => {
      if (f.blocks.length >= MAX_BLOCKS) return f;
      const nextIdx = f.blocks.length + 1;
      return {
        ...f,
        blocks: [...f.blocks, createBlock(`Bloco ${nextIdx}`, 4, 2)],
      };
    });
  }
  function removeBlock(idx: number) {
    setForm((f) => (f.blocks.length <= 1 ? f : { ...f, blocks: f.blocks.filter((_, i) => i !== idx) }));
  }
  function addAmenity(preset: AmenityDraft = AMENITY_PRESETS[0]) {
    setForm((f) => ({ ...f, seedAmenities: true, amenities: [...f.amenities, { ...preset }] }));
  }
  function updateAmenity(idx: number, patch: Partial<AmenityDraft>) {
    setForm((f) => ({
      ...f,
      amenities: f.amenities.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    }));
  }
  function removeAmenity(idx: number) {
    setForm((f) => ({ ...f, amenities: f.amenities.filter((_, i) => i !== idx) }));
  }
  function addServiceContact(preset?: Partial<ServiceContactDraft>) {
    setForm((f) => ({ ...f, serviceContacts: [...f.serviceContacts, blankServiceContact(preset)] }));
  }
  function updateServiceContact(idx: number, patch: Partial<ServiceContactDraft>) {
    setForm((f) => ({
      ...f,
      serviceContacts: f.serviceContacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  }
  function removeServiceContact(idx: number) {
    setForm((f) => ({ ...f, serviceContacts: f.serviceContacts.filter((_, i) => i !== idx) }));
  }

  const totalUnits = form.blocks.reduce((sum, b) => sum + unitsInBlock(b), 0);
  const blocksValid = form.blocks.every(
    (b) => (
      b.name.trim().length > 0
      && b.floors >= 1
      && b.unitsPerFloor >= 1
      && b.floorUnitCounts.length === b.floors
      && b.floorUnitCounts.every((count) => count >= 0 && count <= MAX_UNITS_PER_FLOOR)
      && unitsInBlock(b) > 0
    ),
  );
  const amenitiesValid = !form.seedAmenities || (
    form.amenities.length > 0
    && form.amenities.every((a) => (
      a.name.trim().length > 0
      && a.capacity >= 1
      && a.close_hour > a.open_hour
      && a.slot_minutes >= 15
      && a.slot_minutes <= (a.close_hour - a.open_hour) * 60
    ))
  );
  const serviceContactsToSave = form.serviceContacts
    .filter((c) => c.company_name.trim().length > 0);
  const serviceContactsValid = serviceContactsToSave.every((c) => (
    c.company_name.trim().length > 0
    && serviceContactHasReachableDetail(c)
    && (!c.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()))
    && (!c.website.trim() || /^https?:\/\//i.test(c.website.trim()))
    && (!c.contract_url.trim() || /^https?:\/\//i.test(c.contract_url.trim()))
  ));

  async function submit() {
    setSaving(true);
    try {
      // Legacy fields remain in the payload, but buildings[].floorUnitCounts
      // carries the real per-floor layout for new onboarding.
      const buildings = form.blocks.map(normalizeBlock);
      const first = buildings[0];
      const payload = {
        condoName: form.condoName,
        address: form.address,
        buildingName: first.name,
        floors: first.floors,
        unitsPerFloor: first.unitsPerFloor,
        floorUnitCounts: first.floorUnitCounts,
        buildings,
        ownerUnitNumber: form.adminLivesInBuilding ? form.ownerUnitNumber : '',
        seedAmenities: form.seedAmenities,
        amenities: form.seedAmenities ? form.amenities.map((a) => ({
          ...a,
          name: a.name.trim(),
          description: a.description.trim(),
          capacity: Math.max(1, Math.min(500, a.capacity || 1)),
          open_hour: Math.max(0, Math.min(23, a.open_hour || 0)),
          close_hour: Math.max(1, Math.min(24, a.close_hour || 1)),
          slot_minutes: Math.max(15, Math.min(240, Math.round((a.slot_minutes || 60) / 15) * 15)),
          booking_window_days: Math.max(1, Math.min(365, a.booking_window_days || 14)),
        })) : undefined,
        serviceContacts: serviceContactsToSave.map(normalizeServiceContact),
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
        amenity_count: form.seedAmenities ? form.amenities.length : 0,
        service_contact_count: serviceContactsToSave.length,
        voting_model: form.votingModel,
        admin_lives_in_building: form.adminLivesInBuilding,
      });
      setInviteCode(res.inviteCode);
      setStep(5);
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
        <div className="w-full max-w-3xl animate-fade-up">
          {/* Stepper */}
          <div className="flex items-center gap-1 sm:gap-2 mb-8 text-xs min-w-0 overflow-hidden">
            {['Prédio', 'Estrutura', 'Preferências', 'Operação', 'Pronto'].map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3 | 4 | 5;
              const active = step === n;
              const done = step > n;
              return (
                <div key={label} className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0
                      ${done ? 'bg-sage-400 text-white' : active ? 'bg-dusk-400 text-cream-50' : 'bg-white/60 text-dusk-300 border border-white/60'}`}
                  >
                    {done ? '✓' : n}
                  </div>
                  <div className={`hidden sm:block text-xs font-medium truncate ${active ? 'text-dusk-500' : 'text-dusk-300'}`}>{label}</div>
                  {i < 4 && <div className={`flex-1 h-[1.5px] ${done ? 'bg-sage-400' : 'bg-white/70'}`} />}
                </div>
              );
            })}
          </div>

          <GlassCard variant="clay" className="p-5 sm:p-8 overflow-hidden">
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
                            onChange={(e) => updateBlockFloors(idx, parseInt(e.target.value) || 1)}
                          />
                        </label>
                        <label className="block text-xs text-dusk-300 font-medium">
                          Unidades padrão
                          <input
                            type="number" min={1} max={MAX_UNITS_PER_FLOOR}
                            className="input mt-1"
                            value={block.unitsPerFloor}
                            onChange={(e) => applyUnitsToAllFloors(idx, parseInt(e.target.value) || 1)}
                          />
                        </label>
                      </div>
                      <div className="mt-4 rounded-2xl bg-cream-50/70 border border-white/80 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold text-dusk-500">Unidades por andar</div>
                            <div className="text-[11px] text-dusk-300">
                              Edite os andares que fogem do padrão. Use 0 para andares sem apartamentos.
                            </div>
                          </div>
                          <Badge tone={new Set(block.floorUnitCounts).size > 1 ? 'sage' : 'neutral'}>
                            {new Set(block.floorUnitCounts).size > 1 ? 'Layout personalizado' : 'Mesmo padrão'}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                          {makeFloorUnitCounts(block.floors, block.unitsPerFloor, block.floorUnitCounts).map((units, floorIdx) => (
                            <label key={floorIdx} className="block text-[11px] text-dusk-300 font-medium">
                              Andar {floorIdx + 1}
                              <input
                                type="number"
                                min={0}
                                max={MAX_UNITS_PER_FLOOR}
                                className="input mt-1"
                                value={units}
                                aria-label={`Unidades no andar ${floorIdx + 1} de ${block.name}`}
                                onChange={(e) => updateFloorUnits(idx, floorIdx, parseInt(e.target.value) || 0)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="text-[11px] text-dusk-300 mt-2">
                        {unitsInBlock(block)} unidades neste bloco
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
                  <div className="p-4 rounded-2xl bg-white/60 border border-white/70">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" className="mt-1" checked={form.seedAmenities} onChange={(e) => up('seedAmenities', e.target.checked)} />
                      <div>
                        <div className="text-sm font-semibold text-dusk-500">Criar áreas comuns reserváveis agora</div>
                        <div className="text-xs text-dusk-300 mt-0.5">
                          Academia, piscina, quadras, campo, salão de festas — cada uma com capacidade e slots próprios.
                        </div>
                      </div>
                    </label>

                    {form.seedAmenities && (
                      <div className="mt-4 space-y-3">
                        <div className="grid sm:grid-cols-2 gap-2">
                          {AMENITY_PRESETS.map((preset) => {
                            const Icon = AMENITY_ICONS[preset.icon] || Trophy;
                            return (
                              <button
                                key={preset.name}
                                type="button"
                                onClick={() => addAmenity(preset)}
                                className="p-3 rounded-2xl bg-white/70 border border-white/80 text-left hover:bg-white transition"
                              >
                                <div className="flex items-center gap-2 text-sm font-semibold text-dusk-500">
                                  <Icon className="w-4 h-4" /> {preset.name}
                                </div>
                                <div className="text-[11px] text-dusk-300 mt-1">{preset.capacity} pessoas · slots de {preset.slot_minutes} min</div>
                              </button>
                            );
                          })}
                        </div>

                        <div className="space-y-2">
                          {form.amenities.map((amenity, idx) => {
                            const Icon = AMENITY_ICONS[amenity.icon] || Trophy;
                            return (
                              <div key={`${amenity.name}-${idx}`} className="p-3 rounded-2xl bg-cream-50/70 border border-white/80">
                                <div className="flex items-start gap-2">
                                  <div className="w-9 h-9 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                                    <Icon className="w-4 h-4" />
                                  </div>
                                  <div className="grid sm:grid-cols-2 gap-2 flex-1 min-w-0">
                                    <label className="block text-[11px] text-dusk-300 font-medium">
                                      Nome
                                      <input className="input mt-1" value={amenity.name} onChange={(e) => updateAmenity(idx, { name: e.target.value })} maxLength={80} />
                                    </label>
                                    <label className="block text-[11px] text-dusk-300 font-medium">
                                      Tipo
                                      <select className="input mt-1" value={amenity.icon} onChange={(e) => updateAmenity(idx, { icon: e.target.value })}>
                                        <option value="Dumbbell">Academia</option>
                                        <option value="Waves">Piscina</option>
                                        <option value="Trophy">Quadra / campo</option>
                                        <option value="PartyPopper">Salão de festas</option>
                                      </select>
                                    </label>
                                    <label className="block text-[11px] text-dusk-300 font-medium sm:col-span-2">
                                      Descrição
                                      <input className="input mt-1" value={amenity.description} onChange={(e) => updateAmenity(idx, { description: e.target.value })} maxLength={280} />
                                    </label>
                                    <label className="block text-[11px] text-dusk-300 font-medium">
                                      Pessoas por slot
                                      <input type="number" min={1} max={500} className="input mt-1" value={amenity.capacity} onChange={(e) => updateAmenity(idx, { capacity: parseInt(e.target.value) || 1 })} />
                                    </label>
                                    <label className="block text-[11px] text-dusk-300 font-medium">
                                      Slot
                                      <select className="input mt-1" value={amenity.slot_minutes} onChange={(e) => updateAmenity(idx, { slot_minutes: parseInt(e.target.value) })}>
                                        {[30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m} min</option>)}
                                      </select>
                                    </label>
                                    <label className="block text-[11px] text-dusk-300 font-medium">
                                      Abre
                                      <input type="number" min={0} max={23} className="input mt-1" value={amenity.open_hour} onChange={(e) => updateAmenity(idx, { open_hour: parseInt(e.target.value) || 0 })} />
                                    </label>
                                    <label className="block text-[11px] text-dusk-300 font-medium">
                                      Fecha
                                      <input type="number" min={1} max={24} className="input mt-1" value={amenity.close_hour} onChange={(e) => updateAmenity(idx, { close_hour: parseInt(e.target.value) || 1 })} />
                                    </label>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeAmenity(idx)}
                                    className="p-2 text-dusk-300 hover:text-peach-600 transition"
                                    aria-label={`Remover ${amenity.name}`}
                                    title="Remover área"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => addAmenity({ name: 'Nova área', description: '', icon: 'Trophy', capacity: 4, open_hour: 8, close_hour: 22, slot_minutes: 60, booking_window_days: 14 })}
                          className="w-full p-3 rounded-2xl border border-dashed border-dusk-200 text-sm text-dusk-400 hover:bg-white/40 hover:text-dusk-500 transition flex items-center justify-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> Criar área personalizada
                        </button>
                      </div>
                    )}
                  </div>

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
                  <Button variant="primary" onClick={() => setStep(4)} disabled={!amenitiesValid} rightIcon={<ArrowRight className="w-4 h-4" />}>Continuar</Button>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h1 className="font-display text-3xl text-dusk-500 tracking-tight">Rede de operação</h1>
                <p className="text-dusk-300 mt-2 text-sm">
                  Registre os fornecedores que já conhecem o prédio: eletricista, hidráulica, elevador, academia, piscina, limpeza, segurança e outros contatos úteis.
                </p>

                <div className="mt-6 p-4 rounded-2xl bg-white/60 border border-white/70">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm font-semibold text-dusk-500">Adicionar contato por tipo</div>
                      <div className="text-xs text-dusk-300 mt-0.5">Use um modelo e preencha empresa, telefone, contrato e observações.</div>
                    </div>
                    <Badge tone="sage">{serviceContactsToSave.length} prontos para salvar</Badge>
                  </div>
                  <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {SERVICE_PRESETS.map((preset) => (
                      <button
                        key={`${preset.category}-${preset.service_scope}`}
                        type="button"
                        onClick={() => addServiceContact(preset)}
                        className="p-3 rounded-2xl bg-white/70 border border-white/80 text-left hover:bg-white transition"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-dusk-500">
                          <Wrench className="w-4 h-4" /> {SERVICE_CATEGORIES.find((c) => c.value === preset.category)?.label}
                        </div>
                        <div className="text-[11px] text-dusk-300 mt-1 line-clamp-2">{preset.service_scope}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {form.serviceContacts.map((contact, idx) => (
                    <div key={idx} className="p-4 rounded-2xl bg-cream-50/70 border border-white/80">
                      <div className="flex items-start gap-2">
                        <div className="w-9 h-9 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                          <Phone className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="grid md:grid-cols-2 gap-2">
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Tipo de serviço
                              <select
                                className="input mt-1"
                                value={contact.category}
                                onChange={(e) => updateServiceContact(idx, { category: e.target.value })}
                              >
                                {SERVICE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                              </select>
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Empresa / fornecedor
                              <input
                                className="input mt-1"
                                value={contact.company_name}
                                onChange={(e) => updateServiceContact(idx, { company_name: e.target.value })}
                                maxLength={140}
                                placeholder="ex: Fitness Pro, Elevadores Atlas"
                              />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Pessoa de contato
                              <input className="input mt-1" value={contact.contact_name} onChange={(e) => updateServiceContact(idx, { contact_name: e.target.value })} maxLength={120} />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Telefone
                              <input className="input mt-1" value={contact.phone} onChange={(e) => updateServiceContact(idx, { phone: e.target.value })} maxLength={40} placeholder="+55 11 99999-0000" />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              WhatsApp
                              <input className="input mt-1" value={contact.whatsapp} onChange={(e) => updateServiceContact(idx, { whatsapp: e.target.value })} maxLength={40} placeholder="+55 11 99999-0000" />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Email
                              <input className="input mt-1" type="email" value={contact.email} onChange={(e) => updateServiceContact(idx, { email: e.target.value })} maxLength={160} placeholder="contato@empresa.com" />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Site
                              <input className="input mt-1" type="url" value={contact.website} onChange={(e) => updateServiceContact(idx, { website: e.target.value })} maxLength={2048} placeholder="https://..." />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium">
                              Link do contrato / garantia
                              <input className="input mt-1" type="url" value={contact.contract_url} onChange={(e) => updateServiceContact(idx, { contract_url: e.target.value })} maxLength={2048} placeholder="https://..." />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium md:col-span-2">
                              Endereço
                              <input className="input mt-1" value={contact.address} onChange={(e) => updateServiceContact(idx, { address: e.target.value })} maxLength={240} />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium md:col-span-2">
                              O que essa empresa resolve
                              <input className="input mt-1" value={contact.service_scope} onChange={(e) => updateServiceContact(idx, { service_scope: e.target.value })} maxLength={500} placeholder="ex: manutenção da esteira, instalação de aparelhos, emergência elétrica" />
                            </label>
                            <label className="block text-[11px] text-dusk-300 font-medium md:col-span-2">
                              Observações importantes
                              <textarea className="input mt-1 min-h-[72px]" value={contact.notes} onChange={(e) => updateServiceContact(idx, { notes: e.target.value })} maxLength={1200} placeholder="ex: horário de atendimento, SLA, quem chama, número do contrato, restrições de acesso" />
                            </label>
                          </div>
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <label className="inline-flex items-center gap-2 text-xs text-dusk-400 bg-white/60 border border-white/70 rounded-full px-3 py-1.5 cursor-pointer">
                              <input type="checkbox" checked={contact.emergency_available} onChange={(e) => updateServiceContact(idx, { emergency_available: e.target.checked })} />
                              Atende emergência
                            </label>
                            <label className="inline-flex items-center gap-2 text-xs text-dusk-400 bg-white/60 border border-white/70 rounded-full px-3 py-1.5 cursor-pointer">
                              <input type="checkbox" checked={contact.preferred} onChange={(e) => updateServiceContact(idx, { preferred: e.target.checked })} />
                              Fornecedor preferido
                            </label>
                            {contact.emergency_available && <Badge tone="warning"><ShieldCheck className="w-3 h-3" /> emergência</Badge>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeServiceContact(idx)}
                          className="p-2 text-dusk-300 hover:text-peach-600 transition"
                          aria-label={`Remover contato ${idx + 1}`}
                          title="Remover contato"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addServiceContact()}
                    className="w-full p-3 rounded-2xl border border-dashed border-dusk-200 text-sm text-dusk-400 hover:bg-white/40 hover:text-dusk-500 transition flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Adicionar contato personalizado
                  </button>
                </div>

                {!serviceContactsValid && (
                  <div className="mt-4 p-3 rounded-2xl bg-peach-100/70 border border-peach-200 text-xs text-peach-700">
                    Cada contato salvo precisa ter empresa e pelo menos uma forma de contato ou observação. Links devem começar com http:// ou https://.
                  </div>
                )}

                <div className="mt-8 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(3)} leftIcon={<ArrowLeft className="w-4 h-4" />}>Voltar</Button>
                  <Button variant="primary" onClick={submit} loading={saving} disabled={!serviceContactsValid} rightIcon={<Sparkles className="w-4 h-4" />}>Criar prédio</Button>
                </div>
              </>
            )}

            {step === 5 && inviteCode && (
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
