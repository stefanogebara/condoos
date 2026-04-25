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

function RequireAuth({ role, children }: { role?: 'resident' | 'board_admin'; children: React.ReactNode }) {
  const { user, loading, hasActiveMembership } = useAuth();
  if (loading || (user && hasActiveMembership === null)) return <div className="min-h-screen flex items-center justify-center text-dusk-300">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasActiveMembership) return <Navigate to="/onboarding" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'board_admin' ? '/board' : '/app'} replace />;
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
  if (!hasActiveMembership) return <Navigate to="/onboarding" replace />;
  return <Navigate to={user.role === 'board_admin' ? '/board' : '/app'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/design" element={<DesignSystemPage />} />
        <Route path="/logos"  element={<LogosPage />} />

        <Route path="/onboarding"        element={<RequireSignedIn><OnboardingHome /></RequireSignedIn>} />
        <Route path="/onboarding/create" element={<RequireSignedIn><OnboardingCreate /></RequireSignedIn>} />
        <Route path="/onboarding/join"   element={<RequireSignedIn><OnboardingJoin /></RequireSignedIn>} />

        <Route path="/app/*" element={<RequireAuth><ResidentApp /></RequireAuth>} />
        <Route path="/board/*" element={<RequireAuth role="board_admin"><BoardApp /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
