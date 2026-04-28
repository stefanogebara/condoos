import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import LandingPage from './pages/Landing';
import LoginPage from './pages/Login';
import DesignSystemPage from './pages/DesignSystem';
import LogosPage from './pages/Logos';
import OnboardingHome from './pages/onboarding/Onboarding';
import OnboardingCreate from './pages/onboarding/Create';
import OnboardingJoin from './pages/onboarding/Join';
import ResidentApp from './pages/resident/ResidentApp';
import BoardApp from './pages/board/BoardApp';
import ConciergeApp from './pages/concierge/ConciergeApp';
import { exposeInternalPages } from './lib/appConfig';

type Role = 'resident' | 'board_admin' | 'concierge';

// Staff users (board_admin, concierge) don't have user_unit rows, so the
// hasActiveMembership check would always fail and bounce them to onboarding.
// They get in based on having users.condominium_id set — which the backend
// also treats as enough to access scoped routes.
function isStaffRole(role: string | undefined): boolean {
  return role === 'board_admin' || role === 'concierge';
}
function landingPath(role: string): string {
  if (role === 'board_admin') return '/board';
  if (role === 'concierge') return '/concierge';
  return '/app';
}

function RequireAuth({ role, children }: { role?: Role; children: React.ReactNode }) {
  const { user, loading, hasActiveMembership } = useAuth();
  if (loading || (user && hasActiveMembership === null)) return <div className="min-h-screen flex items-center justify-center text-dusk-300">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasActiveMembership && !isStaffRole(user.role)) return <Navigate to="/onboarding" replace />;
  if (role && user.role !== role) {
    return <Navigate to={landingPath(user.role)} replace />;
  }
  return <>{children}</>;
}

function RequireSignedIn({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RootRoute() {
  const { user, loading, hasActiveMembership } = useAuth();
  if (loading || (user && hasActiveMembership === null)) return null;
  if (!user) return <LandingPage />;
  if (!hasActiveMembership && !isStaffRole(user.role)) return <Navigate to="/onboarding" replace />;
  return <Navigate to={landingPath(user.role)} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/login" element={<LoginPage />} />
        {exposeInternalPages && <Route path="/design" element={<DesignSystemPage />} />}
        {exposeInternalPages && <Route path="/logos"  element={<LogosPage />} />}

        <Route path="/onboarding"        element={<RequireSignedIn><OnboardingHome /></RequireSignedIn>} />
        <Route path="/onboarding/create" element={<RequireSignedIn><OnboardingCreate /></RequireSignedIn>} />
        <Route path="/onboarding/join"   element={<RequireSignedIn><OnboardingJoin /></RequireSignedIn>} />

        <Route path="/app/*" element={<RequireAuth role="resident"><ResidentApp /></RequireAuth>} />
        <Route path="/board/*" element={<RequireAuth role="board_admin"><BoardApp /></RequireAuth>} />
        <Route path="/concierge/*" element={<RequireAuth role="concierge"><ConciergeApp /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
