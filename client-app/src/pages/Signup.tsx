import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Building2, KeyRound, Plus, UserPlus } from 'lucide-react';
import Logo from '../components/Logo';
import GlassCard from '../components/GlassCard';
import Button from '../components/Button';
import { useAuth } from '../lib/auth';
import { track } from '../lib/analytics';
import { t } from '../lib/i18n';

type SignupIntent = 'join' | 'create';

function signupErrorMessage(err: any): string {
  const error = err?.response?.data?.error;
  if (error === 'email_taken') return t('Esse email já tem conta. Entre com sua senha.');
  if (error === 'invalid_input') return t('Confira os dados e use uma senha com pelo menos 12 caracteres.');
  return t('Falha ao criar conta');
}

export default function Signup() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const { intent, initialCode } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('intent');
    return {
      intent: raw === 'create' ? 'create' as SignupIntent : 'join' as SignupIntent,
      initialCode: (params.get('code') || '').toUpperCase(),
    };
  }, []);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await register({
        email,
        password,
        first_name: firstName,
        last_name: lastName,
      });
      track('signup_completed', { intent, has_code: !!code.trim() });
      toast.success(t('Conta criada'));
      if (intent === 'create') {
        navigate('/onboarding/create');
      } else {
        const trimmed = code.trim().toUpperCase();
        navigate(trimmed ? `/onboarding/join?code=${encodeURIComponent(trimmed)}` : '/onboarding/join');
      }
    } catch (err: any) {
      toast.error(signupErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex items-end overflow-hidden">
        <img src="/images/bg-dusk.webp" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-dusk-500/65 via-dusk-400/10 to-transparent" />
        <div className="relative p-12 text-cream-50 max-w-lg">
          <Link to="/"><Logo size={32} /></Link>
          <h2 className="font-display text-4xl mt-16 leading-tight">
            Entre no seu prédio sem pedir ajuda na portaria.
          </h2>
          <p className="mt-4 text-cream-50/80 text-base">
            Crie sua conta, use o código do administrador e escolha sua unidade.
          </p>
        </div>
      </div>

      <div className="relative flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md animate-fade-up">
          <Link to="/" className="lg:hidden inline-block mb-8"><Logo size={28} /></Link>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-dusk-300 hover:text-dusk-500 mb-5">
            <ArrowLeft className="w-4 h-4" /> Voltar para entrar
          </Link>

          <GlassCard className="p-5 mb-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                {intent === 'create' ? <Plus className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-dusk-300 font-semibold mb-1">
                  {intent === 'create' ? 'Novo administrador' : 'Novo morador'}
                </div>
                <h1 className="font-display text-3xl text-dusk-500 leading-tight tracking-tight">
                  {intent === 'create' ? 'Crie sua conta de administrador' : 'Crie sua conta para entrar'}
                </h1>
                <p className="text-sm text-dusk-300 mt-2 leading-relaxed">
                  {intent === 'create'
                    ? 'Depois de criar sua conta, configuramos o prédio e geramos o código para moradores.'
                    : 'Depois de criar sua conta, insira o código do administrador e escolha sua unidade.'}
                </p>
              </div>
            </div>
          </GlassCard>

          <form onSubmit={submit} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <input className="input" aria-label="Nome" placeholder="Nome" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
              <input className="input" aria-label="Sobrenome" placeholder="Sobrenome" value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
            </div>
            <input type="email" className="input" aria-label="Email" placeholder="voce@predio.com.br" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <input type="password" className="input" aria-label="Senha" placeholder="senha de 12+ caracteres" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password" />
            {intent === 'join' && (
              <label className="block">
                <span className="sr-only">Código de convite</span>
                <input
                  className="input text-center font-mono uppercase tracking-[0.24em]"
                  aria-label="Código de convite"
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
              {intent === 'create' ? 'Criar conta e prédio' : 'Criar conta e entrar'}
            </Button>
          </form>

          <p className="mt-6 text-xs text-dusk-200 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" />
            Já tem conta? <Link to="/login" className="underline hover:text-dusk-400">Entrar</Link>
          </p>

          <div className="mt-5 flex items-center gap-2 text-xs text-dusk-200">
            <UserPlus className="w-3.5 h-3.5" />
            {intent === 'join' ? 'O administrador aprova seu acesso se o prédio exigir.' : 'Você pode administrar mesmo sem morar no prédio.'}
          </div>
        </div>
      </div>
    </div>
  );
}
