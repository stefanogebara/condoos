import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ExternalLink, Mail, Pencil, Plus, Save, Star, Trash2, Wrench, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDate } from '../../lib/i18n';

interface ServiceContact {
  id: number;
  category: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  service_scope: string | null;
  notes: string | null;
  contract_url: string | null;
  emergency_available: number;
  preferred: number;
  active: number;
  last_used_at: string | null;
  created_at: string;
}

type ServiceContactForm = Omit<ServiceContact, 'id' | 'created_at' | 'emergency_available' | 'preferred' | 'active'> & {
  emergency_available: boolean;
  preferred: boolean;
  active: boolean;
};

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
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(SERVICE_CATEGORIES.map((c) => [c.value, c.label]));

const blankForm: ServiceContactForm = {
  category: 'general_maintenance',
  company_name: '',
  contact_name: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  address: '',
  service_scope: '',
  notes: '',
  contract_url: '',
  emergency_available: false,
  preferred: true,
  active: true,
  last_used_at: '',
};

function normalize(form: ServiceContactForm) {
  return {
    category: form.category,
    company_name: form.company_name.trim(),
    contact_name: form.contact_name?.trim() || null,
    phone: form.phone?.trim() || null,
    whatsapp: form.whatsapp?.trim() || null,
    email: form.email?.trim() || null,
    website: form.website?.trim() || null,
    address: form.address?.trim() || null,
    service_scope: form.service_scope?.trim() || null,
    notes: form.notes?.trim() || null,
    contract_url: form.contract_url?.trim() || null,
    emergency_available: form.emergency_available,
    preferred: form.preferred,
    active: form.active,
    last_used_at: form.last_used_at || null,
  };
}

function hasReachableDetail(form: ServiceContactForm) {
  return [form.phone, form.whatsapp, form.email, form.website, form.address, form.notes]
    .some((value) => String(value || '').trim().length > 0);
}

export default function BoardServices() {
  const [contacts, setContacts] = useState<ServiceContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setContacts(await apiGet<ServiceContact[]>('/service-contacts?include_inactive=1'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const activeCount = contacts.filter((c) => c.active).length;
  const emergencyCount = contacts.filter((c) => c.active && c.emergency_available).length;

  return (
    <>
      <PageHeader
        title="Operação"
        subtitle={loading ? 'Carregando…' : `${activeCount} contatos ativos · ${emergencyCount} atendem emergência`}
        actions={
          <Button
            variant={showNew ? 'ghost' : 'primary'}
            onClick={() => setShowNew((x) => !x)}
            leftIcon={showNew ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showNew ? 'Cancelar' : 'Novo contato'}
          </Button>
        }
      />

      <GlassCard variant="clay" className="p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-xl text-dusk-500">Rede de serviços do condomínio</h2>
            <p className="text-sm text-dusk-300 mt-1">
              Guarde aqui eletricistas, hidráulica, elevadores, fabricantes ou instaladores da academia, piscina, segurança, limpeza e contratos importantes.
            </p>
          </div>
        </div>
      </GlassCard>

      {showNew && (
        <ServiceContactEditor
          mode="create"
          initial={blankForm}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}

      <div className="space-y-3">
        {contacts.map((contact) => (
          <ServiceContactRow key={contact.id} contact={contact} onChanged={load} />
        ))}
      </div>

      {!loading && contacts.length === 0 && (
        <GlassCard className="p-6 text-sm text-dusk-300 text-center">
          Nenhum contato operacional cadastrado ainda. Comece pelos fornecedores que você chamaria em uma emergência.
        </GlassCard>
      )}
    </>
  );
}

function ServiceContactRow({ contact, onChanged }: { contact: ServiceContact; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);

  async function deactivate() {
    if (!confirm(`Desativar "${contact.company_name}"?`)) return;
    try {
      await apiDelete(`/service-contacts/${contact.id}`);
      toast.success('Contato desativado');
      onChanged();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao desativar');
    }
  }

  if (editing) {
    return (
      <ServiceContactEditor
        mode="edit"
        id={contact.id}
        initial={{
          category: contact.category,
          company_name: contact.company_name,
          contact_name: contact.contact_name || '',
          phone: contact.phone || '',
          whatsapp: contact.whatsapp || '',
          email: contact.email || '',
          website: contact.website || '',
          address: contact.address || '',
          service_scope: contact.service_scope || '',
          notes: contact.notes || '',
          contract_url: contact.contract_url || '',
          emergency_available: !!contact.emergency_available,
          preferred: !!contact.preferred,
          active: !!contact.active,
          last_used_at: contact.last_used_at ? contact.last_used_at.slice(0, 10) : '',
        }}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onChanged(); }}
      />
    );
  }

  return (
    <GlassCard className={`p-5 ${contact.active ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-white/70 border border-white/80 text-dusk-400 flex items-center justify-center shrink-0">
          <Wrench className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-xl text-dusk-500">{contact.company_name}</h3>
            <Badge tone="neutral">{CATEGORY_LABEL[contact.category] || contact.category}</Badge>
            {contact.preferred ? <Badge tone="sage"><Star className="w-3 h-3" /> preferido</Badge> : null}
            {contact.emergency_available ? <Badge tone="warning"><AlertTriangle className="w-3 h-3" /> emergência</Badge> : null}
            {!contact.active ? <Badge tone="neutral">inativo</Badge> : null}
          </div>
          {contact.contact_name && <p className="text-sm text-dusk-400 mt-1">{contact.contact_name}</p>}
          {contact.service_scope && <p className="text-sm text-dusk-300 mt-2">{contact.service_scope}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-dusk-300">
            {contact.phone && <span className="rounded-full bg-white/60 px-3 py-1">Tel: {contact.phone}</span>}
            {contact.whatsapp && <span className="rounded-full bg-white/60 px-3 py-1">WhatsApp: {contact.whatsapp}</span>}
            {contact.email && <a className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500" href={`mailto:${contact.email}`}><Mail className="w-3 h-3" /> {contact.email}</a>}
            {contact.website && <a className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500" href={contact.website} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3" /> site</a>}
            {contact.contract_url && <a className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 hover:text-dusk-500" href={contact.contract_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3" /> contrato</a>}
            {contact.last_used_at && <span className="rounded-full bg-white/60 px-3 py-1">último uso: {formatDate(contact.last_used_at)}</span>}
          </div>
          {contact.notes && <div className="mt-3 text-xs text-dusk-300 bg-white/50 rounded-2xl p-3">{contact.notes}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="p-2 text-dusk-300 hover:text-dusk-500" title="Editar contato" aria-label={`Editar ${contact.company_name}`}>
            <Pencil className="w-4 h-4" />
          </button>
          {contact.active ? (
            <button onClick={deactivate} className="p-2 text-dusk-300 hover:text-peach-600" title="Desativar contato" aria-label={`Desativar ${contact.company_name}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

function ServiceContactEditor({
  mode,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  mode: 'create' | 'edit';
  id?: number;
  initial: ServiceContactForm;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ServiceContactForm>(initial);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim()) {
      toast.error('Informe a empresa ou fornecedor.');
      return;
    }
    if (!hasReachableDetail(form)) {
      toast.error('Inclua telefone, WhatsApp, email, site, endereço ou observação.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') await apiPost('/service-contacts', normalize(form));
      else await apiPatch(`/service-contacts/${id}`, normalize(form));
      toast.success(mode === 'create' ? 'Contato criado' : 'Contato atualizado');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao salvar contato');
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-5 mb-5 animate-fade-up">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-xl text-dusk-500">{mode === 'create' ? 'Novo contato operacional' : 'Editar contato operacional'}</h2>
        <button onClick={onCancel} className="text-dusk-300 hover:text-dusk-500" aria-label="Cancelar">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
        <label className="block text-xs text-dusk-300 font-medium">
          Tipo de serviço
          <select className="input mt-1" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {SERVICE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Empresa / fornecedor
          <input className="input mt-1" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} maxLength={140} required />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Pessoa de contato
          <input className="input mt-1" value={form.contact_name || ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} maxLength={120} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Telefone
          <input className="input mt-1" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          WhatsApp
          <input className="input mt-1" value={form.whatsapp || ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} maxLength={40} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Email
          <input className="input mt-1" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={160} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Site
          <input className="input mt-1" type="url" value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} maxLength={2048} placeholder="https://..." />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Link do contrato / garantia
          <input className="input mt-1" type="url" value={form.contract_url || ''} onChange={(e) => setForm({ ...form, contract_url: e.target.value })} maxLength={2048} placeholder="https://..." />
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          Endereço
          <input className="input mt-1" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={240} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          O que resolve
          <input className="input mt-1" value={form.service_scope || ''} onChange={(e) => setForm({ ...form, service_scope: e.target.value })} maxLength={500} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Último uso
          <input className="input mt-1" type="date" value={form.last_used_at || ''} onChange={(e) => setForm({ ...form, last_used_at: e.target.value })} />
        </label>
        <label className="block text-xs text-dusk-300 font-medium">
          Status
          <select className="input mt-1" value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
            <option value="1">Ativo</option>
            <option value="0">Inativo</option>
          </select>
        </label>
        <label className="block text-xs text-dusk-300 font-medium md:col-span-2">
          Observações
          <textarea className="input mt-1 min-h-[88px]" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={1200} />
        </label>
        <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 text-xs text-dusk-400 bg-white/60 border border-white/70 rounded-full px-3 py-1.5 cursor-pointer">
            <input type="checkbox" checked={form.emergency_available} onChange={(e) => setForm({ ...form, emergency_available: e.target.checked })} />
            Atende emergência
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-dusk-400 bg-white/60 border border-white/70 rounded-full px-3 py-1.5 cursor-pointer">
            <input type="checkbox" checked={form.preferred} onChange={(e) => setForm({ ...form, preferred: e.target.checked })} />
            Fornecedor preferido
          </label>
        </div>
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={saving} leftIcon={<Save className="w-4 h-4" />}>Salvar</Button>
        </div>
      </form>
    </GlassCard>
  );
}
