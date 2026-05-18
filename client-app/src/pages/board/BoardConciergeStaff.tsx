import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Clipboard, KeyRound, Mail, Plus, RotateCcw, Save, ShieldCheck, X } from 'lucide-react';
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

interface AccessInstructions {
  email: string;
  password: string;
  loginUrl: string;
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
  const [createdAccess, setCreatedAccess] = useState<AccessInstructions | null>(null);
  const [resetStaffId, setResetStaffId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resettingId, setResettingId] = useState<number | null>(null);

  function loginUrl() {
    return `${window.location.origin}/login`;
  }

  function buildInstructions(access: AccessInstructions) {
    return [
      t('Acesso de portaria CondoOS'),
      `${t('Login')}: ${access.loginUrl}`,
      `${t('Email')}: ${access.email}`,
      `${t('Senha temporária')}: ${access.password}`,
      '',
      t('Entre com esses dados. O painel abrirá direto na portaria.'),
    ].join('\n');
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('Instruções copiadas'));
    } catch {
      toast.error(t('Não foi possível copiar'));
    }
  }

  function copyInstructions(access: AccessInstructions) {
    copyText(buildInstructions(access));
  }

  function copyLoginLink(staff: ConciergeStaff) {
    copyText([
      t('Acesso de portaria CondoOS'),
      `${t('Login')}: ${loginUrl()}`,
      `${t('Email')}: ${staff.email}`,
      '',
      t('Use a senha temporária que o administrador definiu. Se ela foi perdida, redefina a senha aqui no painel.'),
    ].join('\n'));
  }

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
      const email = form.email.trim();
      const firstName = form.first_name.trim();
      const lastName = form.last_name.trim();
      const password = form.password;
      await apiPost('/concierge/invite', {
        email,
        first_name: firstName,
        last_name: lastName,
        password,
      });
      setCreatedAccess({
        email,
        password,
        loginUrl: loginUrl(),
      });
      toast.success(t('Porteiro criado. Copie os dados de acesso.'));
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

  async function submitReset(e: React.FormEvent, staff: ConciergeStaff) {
    e.preventDefault();
    if (resetPassword.length < 12) {
      toast.error(t('A senha precisa ter pelo menos 12 caracteres.'));
      return;
    }
    setResettingId(staff.id);
    try {
      await apiPost(`/concierge/staff/${staff.id}/password`, { password: resetPassword });
      setCreatedAccess({
        email: staff.email,
        password: resetPassword,
        loginUrl: loginUrl(),
      });
      toast.success(t('Senha temporária redefinida. Copie os dados de acesso.'));
      setResetStaffId(null);
      setResetPassword('');
    } catch (err: any) {
      const code = err?.response?.data?.error;
      toast.error(code || t('Não foi possível redefinir a senha'));
    } finally {
      setResettingId(null);
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
              {t('O administrador cria o email e uma senha temporária. O porteiro entra com esses dados e vê apenas o painel da portaria. O app ainda não envia email automático para o porteiro.')}
            </p>
            <p className="text-xs text-dusk-300 mt-2">
              {t('Copie as instruções de acesso depois de criar ou redefinir a senha. O porteiro não tem unidade, não vota e não vê o painel administrativo.')}
            </p>
          </div>
        </div>
      </GlassCard>

      {createdAccess && (
        <GlassCard variant="clay-peach" className="p-5 mb-5 animate-fade-up" data-testid="concierge-access-instructions">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:justify-between">
            <div className="min-w-0">
              <h2 className="font-display text-xl text-dusk-500">{t('Dados de acesso prontos')}</h2>
              <p className="text-sm text-dusk-300 mt-1">
                {t('O email automático ainda não está ativo. Copie estes dados e envie ao porteiro pelo canal que você usa.')}
              </p>
              <div className="grid sm:grid-cols-3 gap-2 mt-4 text-sm">
                <div className="rounded-2xl bg-white/45 border border-white/60 p-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-dusk-300">{t('Login')}</div>
                  <div className="font-medium text-dusk-500 break-all">{createdAccess.loginUrl}</div>
                </div>
                <div className="rounded-2xl bg-white/45 border border-white/60 p-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-dusk-300">{t('Email')}</div>
                  <div className="font-medium text-dusk-500 break-all">{createdAccess.email}</div>
                </div>
                <div className="rounded-2xl bg-white/45 border border-white/60 p-3">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-dusk-300">{t('Senha temporária')}</div>
                  <div className="font-medium text-dusk-500 break-all">{createdAccess.password}</div>
                </div>
              </div>
              <p className="text-xs text-dusk-300 mt-3">
                {t('A senha aparece aqui apenas agora. Se ela for perdida, use redefinir senha.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
              <Button type="button" variant="primary" onClick={() => copyInstructions(createdAccess)} leftIcon={<Clipboard className="w-4 h-4" />}>
                {t('Copiar instruções')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreatedAccess(null)}>
                {t('Fechar')}
              </Button>
            </div>
          </div>
        </GlassCard>
      )}

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
              {t('Nome')}
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
          <GlassCard key={staff.id} className="p-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
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
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => copyLoginLink(staff)} leftIcon={<Clipboard className="w-4 h-4" />}>
                  {t('Copiar login')}
                </Button>
                <Button
                  type="button"
                  variant={resetStaffId === staff.id ? 'peach' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setResetStaffId((current) => current === staff.id ? null : staff.id);
                    setResetPassword('');
                  }}
                  leftIcon={<RotateCcw className="w-4 h-4" />}
                >
                  {t('Redefinir senha')}
                </Button>
              </div>
            </div>
            {resetStaffId === staff.id && (
              <form onSubmit={(e) => submitReset(e, staff)} className="mt-4 pt-4 border-t border-white/60 grid md:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <label className="block text-xs text-dusk-300 font-medium">
                  {t('Nova senha temporária')}
                  <input
                    className="input mt-1"
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    minLength={12}
                    required
                  />
                </label>
                <Button type="button" variant="ghost" onClick={() => { setResetStaffId(null); setResetPassword(''); }}>
                  {t('Cancelar')}
                </Button>
                <Button type="submit" variant="primary" loading={resettingId === staff.id} leftIcon={<Save className="w-4 h-4" />}>
                  {t('Guardar nova senha')}
                </Button>
              </form>
            )}
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
