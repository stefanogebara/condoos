import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import toast from 'react-hot-toast';
import { Building2, ArrowRight, Shield, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { apiGet } from '../lib/api';
import Logo from '../components/Logo';
import Button from '../components/Button';
import GlassCard from '../components/GlassCard';

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    // Detect if Google sign-in is configured on the server.
    const envClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (envClientId) {
      setGoogleClientId(envClientId);
    } else {
      apiGet<{ google_client_id: string | null; google_enabled: boolean }>('/auth/config')
        .then((cfg) => { if (cfg.google_enabled && cfg.google_client_id) setGoogleClientId(cfg.google_client_id); })
        .catch(() => {});
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.first_name}`);
      navigate(u.role === 'board_admin' ? '/board' : '/app');
    } catch (err: any) {
      toast.error(err?.response?.data?.error === 'invalid_credentials' ? 'Invalid credentials' : 'Sign in failed');
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
      .then((u) => { toast.success(`Welcome, ${u.first_name}`); navigate(u.role === 'board_admin' ? '/board' : '/app'); })
      .catch(() => toast.error('Login failed'))
      .finally(() => setLoading(false));
  }

  async function handleGoogleSuccess(credential: string | undefined) {
    if (!credential) return toast.error('No Google credential received');
    setLoading(true);
    try {
      const u = await loginWithGoogle(credential);
      toast.success(`Welcome, ${u.first_name}`);
      navigate(u.role === 'board_admin' ? '/board' : '/app');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  const form = (
    <div className="relative min-h-screen grid lg:grid-cols-2">
      {/* Left: dusk landscape with quote */}
      <div className="relative hidden lg:flex items-end overflow-hidden">
        <img src="/images/bg-dusk.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-dusk-500/60 via-dusk-400/10 to-transparent" />
        <div className="relative p-12 text-cream-50 max-w-lg">
          <Link to="/"><Logo size={32} /></Link>
          <h2 className="font-display text-4xl mt-16 leading-tight">
            A calm, soft place for a building to think.
          </h2>
          <p className="mt-4 text-cream-50/80 text-base">
            Sign in with a demo account, Google, or manually. No account needed for the demo.
          </p>
          <div className="mt-8 flex gap-2">
            <span className="chip bg-white/15 text-cream-50 border-white/25">claymorphism</span>
            <span className="chip bg-white/15 text-cream-50 border-white/25">glassmorphism</span>
            <span className="chip bg-white/15 text-cream-50 border-white/25">AI-powered</span>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="relative flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md animate-fade-up">
          <Link to="/" className="lg:hidden inline-block mb-8"><Logo size={28} /></Link>
          <h1 className="font-display text-4xl text-dusk-500 mb-2">Welcome back</h1>
          <p className="text-dusk-300 mb-8">Sign in to your building.</p>

          <GlassCard className="p-4 mb-6">
            <div className="text-xs uppercase tracking-wider text-dusk-200 mb-3 px-1">One-click demo</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => quickLogin('admin')}
                disabled={loading}
                className="group relative flex items-center gap-3 p-3 rounded-2xl bg-white/50 hover:bg-white/70 border border-white/60 transition text-left disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-xl bg-sage-200 flex items-center justify-center text-sage-700 shrink-0"><Shield className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-dusk-500 truncate">Board admin</div>
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
                  <div className="text-sm font-semibold text-dusk-500 truncate">Resident</div>
                  <div className="text-xs text-dusk-200 truncate">resident@condoos.dev</div>
                </div>
              </button>
            </div>
          </GlassCard>

          {googleClientId && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-dusk-100/40" />
                <span className="text-xs text-dusk-200">or continue with</span>
                <div className="flex-1 h-px bg-dusk-100/40" />
              </div>
              <div className="flex justify-center mb-4">
                <GoogleLogin
                  onSuccess={(c) => handleGoogleSuccess(c.credential)}
                  onError={() => toast.error('Google sign-in was cancelled')}
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
            <span className="text-xs text-dusk-200">or manually</span>
            <div className="flex-1 h-px bg-dusk-100/40" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input type="email"    className="input" placeholder="you@building.dev" value={email}    onChange={(e) => setEmail(e.target.value)}    required />
            <input type="password" className="input" placeholder="password"         value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Button type="submit" variant="primary" size="lg" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />} className="w-full">
              Sign in
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
