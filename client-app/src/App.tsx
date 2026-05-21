import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { exposeInternalPages } from './lib/appConfig';
import { t } from './lib/i18n';

type Role = 'resident' | 'board_admin' | 'concierge';

const LandingPage = lazy(() => import('./pages/Landing'));
const LoginPage = lazy(() => import('./pages/Login'));
const SignupPage = lazy(() => import('./pages/Signup'));
const DesignSystemPage = lazy(() => import('./pages/DesignSystem'));
const LogosPage = lazy(() => import('./pages/Logos'));
const OnboardingHome = lazy(() => import('./pages/onboarding/Onboarding'));
const OnboardingCreate = lazy(() => import('./pages/onboarding/Create'));
const OnboardingJoin = lazy(() => import('./pages/onboarding/Join'));
const ResidentApp = lazy(() => import('./pages/resident/ResidentApp'));
const BoardApp = lazy(() => import('./pages/board/BoardApp'));
const ConciergeApp = lazy(() => import('./pages/concierge/ConciergeApp'));

function PageFallback() {
  return <div className="min-h-screen flex items-center justify-center text-dusk-300">{t('Carregando...')}</div>;
}

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
  if (loading || (user && hasActiveMembership === null)) return <PageFallback />;
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
  // The hero / marketing page is the front door. We used to auto-redirect
  // logged-in users straight to their dashboard (or to /onboarding if they
  // hadn't joined a building yet) — but that meant the marketing page was
  // invisible to anyone with a stored session, including admins showing
  // CondoOS to neighbours and returning visitors mid-onboarding.
  // Render Landing for everyone; logged-in users get a "go to your
  // dashboard" CTA in the Landing nav.
  return <LandingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
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
      </Suspense>
    </AuthProvider>
  );
}
