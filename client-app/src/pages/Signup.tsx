import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Building2, KeyRound, Plus, UserPlus } from 'lucide-react';
import Logo from '../components/Logo';
import GlassCard from '../components/GlassCard';
import Button from '../components/Button';
import { useAuth, type User } from '../lib/auth';
import { apiGet, apiPost } from '../lib/api';
import { track } from '../lib/analytics';
import { t } from '../lib/i18n';

type SignupIntent = 'join' | 'create' | 'agency';
interface AuthConfig {
  google_client_id: string | null;
  google_enabled: boolean;
  private_create_building_required?: boolean;
}

function signupErrorMessage(err: any): string {
  const status = err?.response?.status;
  const error = err?.response?.data?.error;
  if (status === 429 || error === 'rate_limited') {
    const retry = Number(err?.response?.data?.retry_after_seconds);
    if (Number.isFinite(retry) && retry > 0) {
      const minutes = Math.max(1, Math.ceil(retry / 60));
      return t('Muitas tentativas. Tente novamente em {n} min.').replace('{n}', String(minutes));
    }
    return t('Muitas tentativas. Aguarde um momento.');
  }
  if (error === 'email_taken') return t('Esse email já tem conta. Entre com sua senha.');
  if (error === 'invalid_input') {
    const fields = err?.response?.data?.details?.fieldErrors || {};
    if (fields.password?.length) return t('Use uma senha com pelo menos 12 caracteres.');
    if (fields.email?.length) return t('Use um email válido.');
    return t('Confira os dados e use uma senha com pelo menos 12 caracteres.');
  }
  if (!err?.response) return t('Não conseguimos falar com o servidor. Tente novamente em alguns segundos.');
  return t('Falha ao criar conta');
}

export default function Signup() {
  const navigate = useNavigate();
  const { register, loginWithGoogle, user } = useAuth();
  const { intent, initialCode, agencyInvite } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('intent');
    return {
      intent: raw === 'create' ? 'create' as SignupIntent : raw === 'agency' ? 'agency' as SignupIntent : 'join' as SignupIntent,
      initialCode: (params.get('code') || '').toUpperCase(),
      agencyInvite: params.get('agency_invite') || '',
    };
  }, []);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [privateCreateBuildingRequired, setPrivateCreateBuildingRequired] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    track('signup_viewed', { intent, has_code: !!initialCode, has_agency_invite: !!agencyInvite });
    const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (envClientId) {
      setGoogleClientId(envClientId);
    }
    apiGet<AuthConfig>('/auth/config')
      .then((cfg) => {
        if (!envClientId && cfg.google_enabled && cfg.google_client_id) setGoogleClientId(cfg.google_client_id);
        setPrivateCreateBuildingRequired(!!cfg.private_create_building_required);
      })
      .catch(() => {});
  }, [intent, initialCode, agencyInvite]);

  useEffect(() => {
    if (!user || !agencyInvite || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    acceptAgencyInvite()
      .catch(() => {
        toast.error(t('Não foi possível aceitar o convite da administradora'));
        submittingRef.current = false;
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, agencyInvite]);

  function nextOnboardingPath() {
    if (intent === 'agency') return '/board/portfolio';
    if (intent === 'create') return '/onboarding/create';
    const trimmed = code.trim().toUpperCase();
    return trimmed ? `/onboarding/join?code=${encodeURIComponent(trimmed)}` : '/onboarding/join';
  }

  async function acceptAgencyInvite() {
    if (!agencyInvite) return false;
    const accepted = await apiPost<{ user?: User }>('/agencies/staff-invites/accept', { token: agencyInvite });
    if (accepted.user) localStorage.setItem('condoos_user', JSON.stringify(accepted.user));
    track('agency_staff_invite_accepted', {});
    toast.success(t('Convite aceito'));
    window.location.href = '/board/portfolio';
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || loading) return;
    if (password.length < 12) {
      toast.error(t('Use uma senha com pelo menos 12 caracteres.'));
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const user = await register({
        email: email.trim().toLowerCase(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      track('signup_completed', { intent, has_code: !!code.trim(), has_agency_invite: !!agencyInvite });
      if (await acceptAgencyInvite()) return;
      toast.success(intent === 'create' && !user.email_verified_at
        ? t('Conta criada. Confirme seu email para criar o prédio.')
        : t('Conta criada'));
      navigate(nextOnboardingPath());
    } catch (err: any) {
      toast.error(signupErrorMessage(err));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  async function handleGoogleSuccess(credential: string | undefined) {
    if (!credential) return toast.error(t('Nenhuma credencial do Google recebida'));
    if (submittingRef.current || loading) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      await loginWithGoogle(credential);
      track('signup_google_completed', { intent, has_code: !!code.trim(), has_agency_invite: !!agencyInvite });
      if (await acceptAgencyInvite()) return;
      toast.success(t('Conta criada'));
      navigate(nextOnboardingPath());
    } catch {
      toast.error(t('Falha ao entrar com Google'));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const page = (
    <div className="relative min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex items-end overflow-hidden">
        <img src="/images/bg-dusk.webp" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-dusk-500/65 via-dusk-400/10 to-transparent" />
        <div className="relative p-12 text-cream-50 max-w-lg">
          <Link to="/"><Logo size={32} /></Link>
          <h2 className="font-display text-4xl mt-16 leading-tight">
            {t('Entre no seu prédio sem pedir ajuda na portaria.')}
          </h2>
          <p className="mt-4 text-cream-50/80 text-base">
            {t(intent === 'create' && privateCreateBuildingRequired
              ? 'Ative apenas prédios aprovados com código privado CONDOS.'
              : 'Crie sua conta, use o código do administrador e escolha sua unidade.')}
          </p>
        </div>
      </div>

      <div className="relative flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md animate-fade-up">
          <Link to="/" className="lg:hidden inline-block mb-8"><Logo size={28} /></Link>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-dusk-300 hover:text-dusk-500 mb-5">
            <ArrowLeft className="w-4 h-4" /> {t('Voltar para entrar')}
          </Link>

          <GlassCard className="p-5 mb-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                {intent === 'create' ? <Plus className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-dusk-300 font-semibold mb-1">
                  {t(intent === 'create'
                    ? privateCreateBuildingRequired ? 'Acesso privado aprovado' : 'Novo administrador'
                    : intent === 'agency' ? 'Novo membro da equipe' : 'Novo morador')}
                </div>
                <h1 className="font-display text-3xl text-dusk-500 leading-tight tracking-tight">
                  {t(intent === 'create'
                    ? privateCreateBuildingRequired ? 'Crie sua conta para ativar o prédio' : 'Crie sua conta de administrador'
                    : intent === 'agency' ? 'Crie sua conta para aceitar o convite' : 'Crie sua conta para entrar')}
                </h1>
                <p className="text-sm text-dusk-300 mt-2 leading-relaxed">
                  {t(intent === 'create'
                    ? privateCreateBuildingRequired
                      ? 'Depois de criar sua conta, use o código privado da equipe CONDOS para configurar o prédio aprovado.'
                      : 'Depois de criar sua conta, configuramos o prédio e geramos o código para moradores.'
                    : intent === 'agency'
                      ? 'Depois de criar sua conta, ativamos seu acesso à administradora e aos prédios permitidos.'
                      : 'Depois de criar sua conta, insira o código do administrador e escolha sua unidade.')}
                </p>
              </div>
            </div>
          </GlassCard>

          {googleClientId && (
            <>
              <div className="mb-4 flex justify-center">
                <GoogleLogin
                  onSuccess={(c) => handleGoogleSuccess(c.credential)}
                  onError={() => toast.error(t('Login com Google cancelado'))}
                  shape="pill"
                  theme="outline"
                  size="large"
                  text="signup_with"
                  width="340"
                />
              </div>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-dusk-100/40" />
                <span className="text-xs text-dusk-200">{t('ou com email')}</span>
                <div className="flex-1 h-px bg-dusk-100/40" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="space-y-3" noValidate>
            <div className="grid sm:grid-cols-2 gap-3">
              <input className="input" aria-label={t('Nome')} placeholder={t('Nome')} value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
              <input className="input" aria-label={t('Sobrenome')} placeholder={t('Sobrenome')} value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
            </div>
            <input type="email" className="input" aria-label={t('Email')} placeholder={t('voce@predio.com.br')} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <input type="password" className="input" aria-label={t('Senha')} placeholder={t('senha de 12+ caracteres')} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password" />
            {intent === 'join' && (
              <label className="block">
                <span className="sr-only">{t('Código de convite')}</span>
                <input
                  className="input text-center font-mono uppercase tracking-[0.24em]"
                  aria-label={t('Código de convite')}
                  placeholder="ABC123"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={12}
                  autoComplete="one-time-code"
                />
              </label>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              rightIcon={<ArrowRight className="w-4 h-4" />}
              className="w-full"
            >
              {t(intent === 'create'
                ? privateCreateBuildingRequired ? 'Criar conta e continuar para ativação' : 'Criar conta e prédio'
                : intent === 'agency' ? 'Criar conta e aceitar convite' : 'Criar conta e entrar')}
            </Button>
          </form>

          <p className="mt-6 text-xs text-dusk-200 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" />
            {t('Já tem conta?')} <Link to="/login" className="underline hover:text-dusk-400">{t('Entrar')}</Link>
          </p>

          <div className="mt-5 flex items-center gap-2 text-xs text-dusk-200">
            <UserPlus className="w-3.5 h-3.5" />
            {t(intent === 'join'
              ? 'O administrador aprova seu acesso se o prédio exigir.'
              : intent === 'agency'
                ? 'Você receberá acesso somente aos prédios autorizados pela administradora.'
                : privateCreateBuildingRequired
                  ? 'Apenas prédios aprovados por CONDOS ou pela administradora podem ser ativados.'
                  : 'Você pode administrar mesmo sem morar no prédio.')}
          </div>
        </div>
      </div>
    </div>
  );

  if (googleClientId) {
    return <GoogleOAuthProvider clientId={googleClientId}>{page}</GoogleOAuthProvider>;
  }
  return page;
}
