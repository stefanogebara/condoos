import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, LogIn, ArrowRight, Clock } from 'lucide-react';
import Logo from '../../components/Logo';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Membership {
  id: number;
  status: 'pending' | 'active' | 'revoked' | 'moved_out';
  relationship: 'owner' | 'tenant' | 'occupant';
  unit_number: string;
  building_name: string;
  condo_name: string;
  condo_address: string;
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Membership[]>('/onboarding/me')
      .then((rows) => {
        setMemberships(rows);
        // If user already has an active membership, skip onboarding.
        if (rows.some((r) => r.status === 'active')) {
          navigate(user?.role === 'board_admin' ? '/board' : '/app', { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, navigate]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-dusk-300">Loading…</div>;
  }

  const pending = memberships.find((m) => m.status === 'pending');

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-6 lg:px-12 py-5 flex items-center justify-between">
        <Link to="/"><Logo /></Link>
        <span className="text-sm text-dusk-300">Welcome, {user?.first_name} · <button onClick={() => { localStorage.clear(); window.location.href = '/login'; }} className="text-dusk-400 hover:text-dusk-500">Sign out</button></span>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl animate-fade-up">
          <div className="text-center mb-10">
            <Badge tone="sage" className="mb-4">Step 1 of 2</Badge>
            <h1 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-tight">
              Let's find your building.
            </h1>
            <p className="mt-4 text-dusk-300 text-lg max-w-xl mx-auto">
              If your building is already on CondoOS, join with the code your board sent you.
              Otherwise, create a new one — you'll be the first admin.
            </p>
          </div>

          {pending && (
            <GlassCard variant="clay-peach" className="p-6 mb-8 text-center">
              <Clock className="w-6 h-6 mx-auto mb-3 text-peach-500" />
              <div className="font-display text-xl text-dusk-500">Waiting for approval</div>
              <p className="text-dusk-400 text-sm mt-2">
                You claimed <span className="font-semibold">Unit {pending.unit_number}</span> at {pending.condo_name} as {pending.relationship}.
                The board will review your request shortly.
              </p>
            </GlassCard>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            <Link to="/onboarding/join">
              <GlassCard variant="clay" hover className="p-8 h-full">
                <div className="w-14 h-14 rounded-2xl bg-sage-200 text-sage-700 flex items-center justify-center mb-5">
                  <LogIn className="w-7 h-7" />
                </div>
                <h2 className="font-display text-2xl text-dusk-500 tracking-tight">Join a building</h2>
                <p className="text-sm text-dusk-300 mt-2 leading-relaxed">
                  I have a 6-character invite code from my board. Enter it, pick my unit, and claim my spot.
                </p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-dusk-500">
                  Enter a code <ArrowRight className="w-4 h-4" />
                </div>
              </GlassCard>
            </Link>

            <Link to="/onboarding/create">
              <GlassCard variant="clay-sage" hover className="p-8 h-full">
                <div className="w-14 h-14 rounded-2xl bg-dusk-400/90 text-cream-50 flex items-center justify-center mb-5">
                  <Plus className="w-7 h-7" />
                </div>
                <h2 className="font-display text-2xl text-dusk-500 tracking-tight">Create a new building</h2>
                <p className="text-sm text-dusk-300 mt-2 leading-relaxed">
                  My condo isn't set up yet. Walk me through naming the building, adding units, and generating an invite code.
                </p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-dusk-500">
                  Start the wizard <ArrowRight className="w-4 h-4" />
                </div>
              </GlassCard>
            </Link>
          </div>

          <div className="mt-10 text-center text-xs text-dusk-200">
            <Building2 className="w-3.5 h-3.5 inline-block mr-1 align-[-2px]" />
            Just exploring? <Link to="/login" className="underline hover:text-dusk-400">Sign in as the demo admin or resident</Link>.
          </div>
        </div>
      </main>
    </div>
  );
}
