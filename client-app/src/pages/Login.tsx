import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import toast from 'react-hot-toast';
import { Building2, ArrowRight, Shield, User, Plus, LogIn, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';
import { track } from '../lib/analytics';
import Logo from '../components/Logo';
import Button from '../components/Button';
import GlassCard from '../components/GlassCard';

type Intent = 'create' | 'join' | 'demo' | null;

const intentCopy: Record<Exclude<Intent, null>, { badge: string; icon: typeof Plus; title: string; subtitle: string }> = {
  create: {
    badge: 'Sou síndico',
    icon: Plus,
    title: 'Vamos montar seu prédio',
    subtitle: 'Entre com o Google e em poucos cliques seu condomínio está no ar — com código de convite pronto pros moradores.',
  },
  join: {
    badge: 'Tenho um código',
    icon: LogIn,
    title: 'Entrar no seu prédio',
    subtitle: 'Faça login com Google. Em seguida, você insere o código que o síndico mandou e escolhe sua unidade.',
  },
  demo: {
    badge: 'Demo',
    icon: Sparkles,
    title: 'Explorar o CondoOS',
    subtitle: 'Use uma das contas de demo abaixo para ver o sistema por dentro — síndico ou morador.',
  },
};

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);

  // Read intent + invite code from the URL once. The hero CTAs on the landing
  // forward both — so by the time we route after login we know exactly where
  // the user wants to land.
  const { intent, inviteCode } = useMemo(() => {
    if (typeof window === 'undefined') return { intent: null as Intent, inviteCode: '' };
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('intent');
    const validIntent: Intent = raw === 'create' || raw === 'join' || raw === 'demo' ? raw : null;
    return { intent: validIntent, inviteCode: params.get('code') || '' };
  }, []);

  useEffect(() => {
    track('login_viewed', { intent: intent || 'none', has_code: !!inviteCode });
    // Detect if Google sign-in is configured on the server.
    const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (envClientId) {
      setGoogleClientId(envClientId);
    }
    apiGet<{ google_client_id: string | null; google_enabled: boolean; demo_enabled?: boolean }>('/auth/config')
      .then((cfg) => {
        if (!envClientId && cfg.google_enabled && cfg.google_client_id) setGoogleClientId(cfg.google_client_id);
        setDemoEnabled(!!cfg.demo_enabled);
      })
      .catch(() => {});
  }, [intent, inviteCode]);

  // Where a freshly-authenticated user lands.
  //   - If they already have an active membership → straight to their dashboard
  //     regardless of intent (a returning síndico clicking "Sou síndico" on the
  //     marketing page shouldn't be sent through the create wizard again).
  //   - Otherwise route by intent. No intent → choose-your-path /onboarding.
  async function routeAfterLogin(u: { role: string; first_name: string }) {
    // Staff (board_admin / concierge) skip the membership check — they don't
    // own a unit, but their condominium_id is set when they're created.
    if (u.role === 'concierge') {
      navigate('/concierge');
      return;
    }

    let hasActive = false;
    try {
      const memberships = await apiGet<Array<{ status: string }>>('/onboarding/me');
      hasActive = memberships.some((m) => m.status === 'active');
    } catch { /* treat as no membership */ }

    if (hasActive || u.role === 'board_admin') {
      navigate(u.role === 'board_admin' ? '/board' : '/app');
      return;
    }

    if (intent === 'create') {
      navigate('/onboarding/create');
    } else if (intent === 'join') {
      navigate(inviteCode ? `/onboarding/join?code=${encodeURIComponent(inviteCode)}` : '/onboarding/join');
    } else {
      navigate('/onboarding');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(`Bem-vindo de volta, ${u.first_name}`);
      await routeAfterLogin(u);
    } catch (err: any) {
      toast.error(err?.response?.data?.error === 'invalid_credentials' ? 'Email ou senha incorretos' : 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  function quickLogin(kind: 'admin' | 'resident') {
    const creds = kind === 'admin'
      ? { e: 'admin@condoos.dev',    p: 'admin123'   }
      : { e: 'resident@condoos.dev', p: 'resident123' };
    setEmail(creds.e); setPassword(creds.p);
    setLoading(true);
    login(creds.e, creds.p)
      .then(async (u) => { toast.success(`Olá, ${u.first_name}`); await routeAfterLogin(u); })
      .catch(() => toast.error('Falha ao entrar'))
      .finally(() => setLoading(false));
  }

  async function handleGoogleSuccess(credential: string | undefined) {
    if (!credential) return toast.error('Nenhuma credencial do Google recebida');
    setLoading(true);
    try {
      const u = await loginWithGoogle(credential);
      toast.success(`Olá, ${u.first_name}`);
      await routeAfterLogin(u);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Falha ao entrar com Google');
    } finally {
      setLoading(false);
    }
  }

  const intentBanner = intent ? intentCopy[intent] : null;

  const form = (
    <div className="relative min-h-screen grid lg:grid-cols-2">
      {/* Left: dusk landscape with quote */}
      <div className="relative hidden lg:flex items-end overflow-hidden">
        <img src="/images/bg-dusk.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-dusk-500/60 via-dusk-400/10 to-transparent" />
        <div className="relative p-12 text-cream-50 max-w-lg">
          <Link to="/"><Logo size={32} /></Link>
          <h2 className="font-display text-4xl mt-16 leading-tight">
            Um lugar tranquilo para o prédio pensar.
          </h2>
          <p className="mt-4 text-cream-50/80 text-base">
            {demoEnabled
              ? 'Entre com Google, com uma conta demo ou manualmente. Sem cartão, sem setup.'
              : 'Entre com Google ou com as credenciais que o seu prédio te forneceu.'}
          </p>
          <div className="mt-8 flex gap-2">
            <span className="chip bg-white/15 text-cream-50 border-white/25">claymorphism</span>
            <span className="chip bg-white/15 text-cream-50 border-white/25">glassmorphism</span>
            <span className="chip bg-white/15 text-cream-50 border-white/25">com IA</span>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="relative flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md animate-fade-up">
          <Link to="/" className="lg:hidden inline-block mb-8"><Logo size={28} /></Link>

          {intentBanner ? (
            <GlassCard variant="clay-sage" className="p-5 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center shrink-0">
                  <intentBanner.icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-dusk-300 font-semibold mb-1">{intentBanner.badge}</div>
                  <h1 className="font-display text-2xl text-dusk-500 leading-tight tracking-tight">{intentBanner.title}</h1>
                  <p className="text-sm text-dusk-300 mt-2 leading-relaxed">{intentBanner.subtitle}</p>
                  {intent === 'join' && inviteCode && (
                    <p className="text-xs text-sage-700 mt-2 font-mono">Código detectado: <strong>{inviteCode}</strong></p>
                  )}
                </div>
              </div>
            </GlassCard>
          ) : (
            <>
              <h1 className="font-display text-4xl text-dusk-500 mb-2">Bem-vindo de volta</h1>
              <p className="text-dusk-300 mb-8">Entre no seu prédio.</p>
            </>
          )}

          {demoEnabled && (
            <GlassCard className="p-4 mb-6">
              <div className="text-xs uppercase tracking-wider text-dusk-200 mb-3 px-1">Demo com 1 clique</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => quickLogin('admin')}
                  disabled={loading}
                  className="group relative flex items-center gap-3 p-3 rounded-2xl bg-white/50 hover:bg-white/70 border border-white/60 transition text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-xl bg-sage-200 flex items-center justify-center text-sage-700 shrink-0"><Shield className="w-5 h-5" /></div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-dusk-500 truncate">Síndico</div>
                    <div className="text-xs text-dusk-200 truncate">admin@condoos.dev</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => quickLogin('resident')}
                  disabled={loading}
                  className="group relative flex items-center gap-3 p-3 rounded-2xl bg-white/50 hover:bg-white/70 border border-white/60 transition text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-xl bg-peach-100 flex items-center justify-center text-peach-500 shrink-0"><User className="w-5 h-5" /></div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-dusk-500 truncate">Morador</div>
                    <div className="text-xs text-dusk-200 truncate">resident@condoos.dev</div>
                  </div>
                </button>
              </div>
            </GlassCard>
          )}

          {googleClientId && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-dusk-100/40" />
                <span className="text-xs text-dusk-200">ou entre com</span>
                <div className="flex-1 h-px bg-dusk-100/40" />
              </div>
              <div className="flex justify-center mb-4">
                <GoogleLogin
                  onSuccess={(c) => handleGoogleSuccess(c.credential)}
                  onError={() => toast.error('Login com Google cancelado')}
                  shape="pill"
                  theme="outline"
                  size="large"
                  text="continue_with"
                  width="340"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-dusk-100/40" />
            <span className="text-xs text-dusk-200">ou manualmente</span>
            <div className="flex-1 h-px bg-dusk-100/40" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input type="email"    className="input" placeholder="voce@predio.com.br" value={email}    onChange={(e) => setEmail(e.target.value)}    required />
            <input type="password" className="input" placeholder="senha"              value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Button type="submit" variant="primary" size="lg" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />} className="w-full">
              Entrar
            </Button>
          </form>

          <p className="mt-8 text-xs text-dusk-200 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" />
            Pine Ridge Towers · Miami FL
          </p>
        </div>
      </div>
    </div>
  );

  // Only wrap in GoogleOAuthProvider when we actually have a client ID,
  // otherwise the SDK throws on mount.
  if (googleClientId) {
    return <GoogleOAuthProvider clientId={googleClientId}>{form}</GoogleOAuthProvider>;
  }
  return form;
}
