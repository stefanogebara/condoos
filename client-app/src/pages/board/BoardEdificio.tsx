// Admin "Edifício" page — manage blocks (buildings) and the units inside each.
//
// Scope (v1, per the checklist):
// - rename a unit
// - add a unit to an existing block (with optional floor)
// - remove a unit (blocked by backend if there are active/pending claims)
// - rename a block
// - delete an empty block
// - add a new block (no auto-generated units; admin adds them manually
//   once the block exists, OR uses the onboarding wizard for batch create)
//
// Re-parenting units between blocks is out of scope for v1.
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Plus, Trash2, Pencil, Check, X, AlertTriangle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';

interface Building {
  id: number;
  name: string;
  floors: number;
  unit_count: number;
}

interface Unit {
  id: number;
  number: string;
  floor: number | null;
  active_claims: number;
}

export default function BoardEdificio() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [unitsByBuilding, setUnitsByBuilding] = useState<Record<number, Unit[]>>({});
  const [loading, setLoading] = useState(true);
  const [showNewBlock, setShowNewBlock] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const list = await apiGet<Building[]>('/buildings');
      setBuildings(list);
      const map: Record<number, Unit[]> = {};
      await Promise.all(list.map(async (b) => {
        try {
          map[b.id] = await apiGet<Unit[]>(`/buildings/${b.id}/units`);
        } catch { map[b.id] = []; }
      }));
      setUnitsByBuilding(map);
    } finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  const totalUnits = buildings.reduce((s, b) => s + b.unit_count, 0);

  return (
    <>
      <PageHeader
        title="Edifício"
        subtitle={loading ? 'Carregando…' : `${buildings.length} ${buildings.length === 1 ? 'bloco' : 'blocos'} · ${totalUnits} ${totalUnits === 1 ? 'unidade' : 'unidades'}`}
        actions={
          <Button
            onClick={() => setShowNewBlock((x) => !x)}
            variant={showNewBlock ? 'ghost' : 'primary'}
            leftIcon={showNewBlock ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showNewBlock ? 'Cancelar' : 'Novo bloco'}
          </Button>
        }
      />

      {showNewBlock && (
        <NewBlockForm onCreated={() => { setShowNewBlock(false); loadAll(); }} />
      )}

      <div className="space-y-4">
        {buildings.map((b) => (
          <BlockCard
            key={b.id}
            building={b}
            units={unitsByBuilding[b.id] || []}
            onChanged={loadAll}
          />
        ))}
      </div>

      {!loading && buildings.length === 0 && (
        <GlassCard className="p-6 text-sm text-dusk-300 text-center">
          Nenhum bloco cadastrado ainda. Use "Novo bloco" para começar.
        </GlassCard>
      )}
    </>
  );
}

function NewBlockForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', floors: 4, units_per_floor: 0 });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await apiPost('/buildings', form);
      toast.success('Bloco criado');
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao criar bloco');
    } finally { setSaving(false); }
  }

  return (
    <GlassCard className="p-5 mb-4 animate-fade-up">
      <h3 className="font-display text-lg text-dusk-500 mb-3">Novo bloco</h3>
      <form onSubmit={submit} className="grid md:grid-cols-3 gap-3">
        <label className="block text-xs text-dusk-300 font-medium md:col-span-1">
          Nome
          <input
            className="input mt-1"
            placeholder="ex: Torre B, Cobertura"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Andares
          <input
            type="number" min={1} max={120} className="input mt-1"
            value={form.floors}
            onChange={(e) => setForm({ ...form, floors: Math.max(1, Math.min(120, parseInt(e.target.value) || 1)) })}
          />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Unidades por andar (auto-gerar)
          <input
            type="number" min={0} max={80} className="input mt-1"
            value={form.units_per_floor}
            onChange={(e) => setForm({ ...form, units_per_floor: Math.max(0, Math.min(80, parseInt(e.target.value) || 0)) })}
          />
          <span className="text-[11px] text-dusk-200 mt-1 block">0 = começar vazio e adicionar manualmente.</span>
        </label>
        <div className="md:col-span-3 flex justify-end">
          <Button type="submit" variant="primary" loading={saving}>Criar bloco</Button>
        </div>
      </form>
    </GlassCard>
  );
}

function BlockCard({
  building,
  units,
  onChanged,
}: { building: Building; units: Unit[]; onChanged: () => void }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(building.name);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [savingName, setSavingName] = useState(false);

  async function saveName() {
    if (!name.trim() || name.trim() === building.name) {
      setEditingName(false);
      setName(building.name);
      return;
    }
    setSavingName(true);
    try {
      await apiPatch(`/buildings/${building.id}`, { name: name.trim() });
      toast.success('Bloco renomeado');
      setEditingName(false);
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao renomear');
    } finally { setSavingName(false); }
  }

  async function deleteBlock() {
    if (building.unit_count > 0) {
      toast.error('Remova as unidades antes de apagar o bloco.');
      return;
    }
    if (!confirm(`Apagar o bloco "${building.name}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await apiDelete(`/buildings/${building.id}`);
      toast.success('Bloco apagado');
      onChanged();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code === 'building_has_units' ? 'O bloco ainda tem unidades.' : code || 'Falha ao apagar');
    }
  }

  return (
    <GlassCard variant="clay" className="p-5">
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="w-10 h-10 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {editingName ? (
            <>
              <input
                className="input flex-1 max-w-xs"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
              />
              <Button size="sm" variant="primary" onClick={saveName} loading={savingName} leftIcon={<Check className="w-3 h-3" />}>Salvar</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setName(building.name); }} leftIcon={<X className="w-3 h-3" />}>Cancelar</Button>
            </>
          ) : (
            <>
              <h3 className="font-display text-xl text-dusk-500">{building.name}</h3>
              <button onClick={() => setEditingName(true)} className="text-dusk-300 hover:text-dusk-500" title="Renomear bloco" aria-label={`Renomear ${building.name}`}>
                <Pencil className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <Badge tone="neutral">{building.unit_count} {building.unit_count === 1 ? 'unidade' : 'unidades'}</Badge>
        <Badge tone="neutral">{building.floors} {building.floors === 1 ? 'andar' : 'andares'}</Badge>
        <button
          onClick={deleteBlock}
          className="text-dusk-300 hover:text-peach-600 transition"
          title="Apagar bloco (só se não tiver unidades)"
          aria-label={`Apagar bloco ${building.name}`}
          disabled={building.unit_count > 0}
        >
          <Trash2 className={`w-4 h-4 ${building.unit_count > 0 ? 'opacity-30' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {units.map((u) => (
          <UnitTile key={u.id} unit={u} buildingId={building.id} onChanged={onChanged} />
        ))}
        {showAddUnit ? (
          <NewUnitInline buildingId={building.id} onDone={() => { setShowAddUnit(false); onChanged(); }} />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddUnit(true)}
            className="p-3 rounded-2xl border border-dashed border-dusk-200 text-sm text-dusk-400 hover:bg-white/40 hover:text-dusk-500 transition flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Adicionar unidade
          </button>
        )}
      </div>
    </GlassCard>
  );
}

function UnitTile({
  unit,
  buildingId,
  onChanged,
}: { unit: Unit; buildingId: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(unit.number);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = number.trim();
    if (!trimmed || trimmed === unit.number) {
      setEditing(false);
      setNumber(unit.number);
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/units/${unit.id}`, { number: trimmed });
      toast.success(`Unidade renomeada para ${trimmed}`);
      setEditing(false);
      onChanged();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code === 'duplicate_number' ? 'Já existe outra unidade com esse número neste bloco.' : code || 'Falha ao salvar');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (unit.active_claims > 0) {
      toast.error('A unidade tem morador(es). Remova os vínculos antes de apagar.');
      return;
    }
    if (!confirm(`Apagar a unidade ${unit.number}?`)) return;
    setBusy(true);
    try {
      await apiDelete(`/units/${unit.id}`);
      toast.success('Unidade apagada');
      onChanged();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code === 'unit_has_active_claims' ? 'A unidade tem morador(es). Remova os vínculos antes de apagar.' : code || 'Falha ao apagar');
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="p-2 rounded-2xl bg-white/70 border border-dusk-200">
        <input
          className="w-full bg-transparent border-0 outline-none font-mono font-semibold text-dusk-500 text-sm"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          maxLength={20}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setNumber(unit.number); } }}
        />
        <div className="flex gap-1 mt-1">
          <button onClick={save} disabled={busy} className="text-sage-700 hover:text-sage-800 text-[11px]" title="Salvar">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setEditing(false); setNumber(unit.number); }} className="text-dusk-300 hover:text-dusk-500 text-[11px]" title="Cancelar">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-2xl bg-white/60 border border-white/70 group">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="font-mono font-semibold text-dusk-500 text-sm truncate">{unit.number}</div>
          <div className="text-[11px] text-dusk-300 mt-0.5">
            {unit.floor !== null ? `Andar ${unit.floor}` : 'Especial'}
            {unit.active_claims > 0 && (
              <span className="ml-1 text-sage-700">· {unit.active_claims} morador{unit.active_claims > 1 ? 'es' : ''}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition gap-0.5">
          <button onClick={() => setEditing(true)} className="text-dusk-300 hover:text-dusk-500" title="Renomear" aria-label={`Renomear ${unit.number}`}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className={`${unit.active_claims > 0 ? 'text-dusk-200' : 'text-dusk-300 hover:text-peach-600'}`}
            title={unit.active_claims > 0 ? 'Tem morador vinculado' : 'Apagar'}
            aria-label={`Apagar ${unit.number}`}
          >
            {unit.active_claims > 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewUnitInline({ buildingId, onDone }: { buildingId: number; onDone: () => void }) {
  const [number, setNumber] = useState('');
  const [floor, setFloor] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = number.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await apiPost(`/buildings/${buildingId}/units`, {
        number: trimmed,
        floor: floor.trim() ? Math.max(0, parseInt(floor) || 0) : null,
      });
      toast.success(`Unidade ${trimmed} adicionada`);
      onDone();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code === 'duplicate_number' ? 'Já existe outra unidade com esse número neste bloco.' : code || 'Falha ao adicionar');
    } finally { setBusy(false); }
  }

  return (
    <div className="p-3 rounded-2xl bg-sage-100 border border-sage-300">
      <input
        className="w-full bg-transparent border-0 outline-none font-mono font-semibold text-dusk-500 text-sm"
        placeholder="Nº (ex: 1502)"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        maxLength={20}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onDone(); }}
      />
      <input
        className="w-full bg-transparent border-0 outline-none text-[11px] text-dusk-400 mt-1"
        placeholder="Andar"
        value={floor}
        onChange={(e) => setFloor(e.target.value.replace(/[^\d]/g, ''))}
        maxLength={3}
      />
      <div className="flex gap-1 mt-1">
        <button onClick={save} disabled={busy || !number.trim()} className="text-sage-700 hover:text-sage-800 disabled:opacity-30" title="Salvar">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDone} className="text-dusk-300 hover:text-dusk-500" title="Cancelar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
