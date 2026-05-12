import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Mail, Plus, Save, ShieldCheck, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { formatDate, t } from '../../lib/i18n';

interface ConciergeStaff {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
}

const blankForm = {
  email: '',
  first_name: '',
  last_name: '',
  password: '',
};

export default function BoardConciergeStaff() {
  const [rows, setRows] = useState<ConciergeStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await apiGet<ConciergeStaff[]>('/concierge/staff'));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Não foi possível carregar a equipe de portaria'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.trim() || !form.first_name.trim() || !form.password.trim()) {
      toast.error(t('Preencha email, nome e senha.'));
      return;
    }
    if (form.password.length < 12) {
      toast.error(t('A senha precisa ter pelo menos 12 caracteres.'));
      return;
    }
    setSaving(true);
    try {
      await apiPost('/concierge/invite', {
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        password: form.password,
      });
      toast.success(t('Porteiro criado'));
      setForm(blankForm);
      setShowNew(false);
      load();
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code === 'email_taken' ? t('Esse email já existe') : code || t('Não foi possível criar o porteiro'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('Portaria')}
        subtitle={t('Crie usuários simples para porteiros. Ao entrar, eles vão direto para o painel de visitantes, encomendas e entregas.')}
        actions={
          <Button
            variant={showNew ? 'ghost' : 'primary'}
            onClick={() => setShowNew((x) => !x)}
            leftIcon={showNew ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          >
            {showNew ? t('Cancelar') : t('Novo porteiro')}
          </Button>
        }
      />

      <GlassCard variant="clay-sage" className="p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/60 text-sage-700 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-xl text-dusk-500">{t('Como funciona')}</h2>
            <p className="text-sm text-dusk-300 mt-1">
              {t('O administrador cria o email e uma senha temporária. O porteiro entra com esses dados e vê apenas o painel da portaria.')}
            </p>
            <p className="text-xs text-dusk-300 mt-2">
              {t('O porteiro não tem unidade, não vota e não vê o painel administrativo.')}
            </p>
          </div>
        </div>
      </GlassCard>

      {showNew && (
        <GlassCard className="p-5 mb-5 animate-fade-up">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-display text-xl text-dusk-500">{t('Novo porteiro')}</h2>
            <button onClick={() => setShowNew(false)} className="text-dusk-300 hover:text-dusk-500" aria-label={t('Cancelar')}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
            <label className="block text-xs text-dusk-300 font-medium">
              {t('Email')}
              <input className="input mt-1" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={160} required />
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {t('Senha temporária')}
              <input className="input mt-1" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={12} required />
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {t('Nombre')}
              <input className="input mt-1" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} maxLength={60} required />
            </label>
            <label className="block text-xs text-dusk-300 font-medium">
              {t('Sobrenome')}
              <input className="input mt-1" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} maxLength={60} />
            </label>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>{t('Cancelar')}</Button>
              <Button type="submit" variant="primary" loading={saving} leftIcon={<Save className="w-4 h-4" />}>{t('Criar porteiro')}</Button>
            </div>
          </form>
        </GlassCard>
      )}

      <div className="space-y-3">
        {rows.map((staff) => (
          <GlassCard key={staff.id} className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-white/70 border border-white/80 text-dusk-400 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-xl text-dusk-500 truncate">{staff.first_name} {staff.last_name}</h3>
                <Badge tone="sage">{t('Porteiro')}</Badge>
              </div>
              <div className="text-sm text-dusk-300 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {staff.email}</span>
                <span>{t('Criado')} {formatDate(staff.created_at)}</span>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {!loading && rows.length === 0 && (
        <GlassCard className="p-6 text-sm text-dusk-300 text-center">
          {t('Ainda não há porteiros criados.')}
        </GlassCard>
      )}
    </>
  );
}
