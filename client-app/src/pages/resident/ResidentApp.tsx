import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Home, Package, DoorOpen, Waves, Megaphone, Vote, Calendar, Sparkles, Gavel, SlidersHorizontal, Wallet, AlertTriangle, FileText } from 'lucide-react';
import Sidebar, { NavItem } from '../../components/Sidebar';
import { t } from '../../lib/i18n';

const Overview = lazy(() => import('./Overview'));
const Packages = lazy(() => import('./Packages'));
const Visitors = lazy(() => import('./Visitors'));
const Amenities = lazy(() => import('./Amenities'));
const Announcements = lazy(() => import('./Announcements'));
const Proposals = lazy(() => import('./Proposals'));
const ProposalDetail = lazy(() => import('./ProposalDetail'));
const Meetings = lazy(() => import('./Meetings'));
const Suggest = lazy(() => import('./Suggest'));
const Assemblies = lazy(() => import('./Assemblies'));
const AssemblyDetail = lazy(() => import('./AssemblyDetail'));
const Settings = lazy(() => import('./Settings'));
const Transparencia = lazy(() => import('./Transparencia'));
const Tickets = lazy(() => import('./Tickets'));
const Documents = lazy(() => import('./Documents'));

// Resident sidebar — same 3-section pattern as the board sidebar so
// the two surfaces feel like siblings. Sections chosen by what a
// resident actually does, not by feature category:
//
//   Dia a dia — package pickup, guest sign-in, reporting a leak,
//   reserving the BBQ, reading the latest announcement
//   Decidir   — vote, attend, suggest. Mirrors the board's "Decidir".
//   Conhecer  — read the building's docs, see where the money went,
//   tweak your own preferences. Mirrors the board's "Conhecer".
const NAV: NavItem[] = [
  // Top — home. No section header.
  { to: '/app',               label: 'Início',        icon: Home },

  // Dia a dia — daily resident actions.
  { to: '/app/packages',      label: 'Encomendas',    icon: Package, section: 'Dia a dia' },
  { to: '/app/visitors',      label: 'Visitantes',    icon: DoorOpen, section: 'Dia a dia' },
  { to: '/app/tickets',       label: 'Problemas',     icon: AlertTriangle, section: 'Dia a dia' },
  { to: '/app/amenities',     label: 'Áreas comuns',  icon: Waves, section: 'Dia a dia' },
  { to: '/app/announcements', label: 'Comunicados',   icon: Megaphone, section: 'Dia a dia' },

  // Decidir — collective decision-making. Matches the board verb.
  { to: '/app/proposals',     label: 'Propostas',     icon: Vote, section: 'Decidir' },
  { to: '/app/assemblies',    label: 'Assembleias',   icon: Gavel, section: 'Decidir' },
  { to: '/app/meetings',      label: 'Reuniões',      icon: Calendar, section: 'Decidir' },
  { to: '/app/suggest',       label: 'Sugerir',       icon: Sparkles, section: 'Decidir' },

  // Conhecer — reference & personal account.
  { to: '/app/documents',     label: 'Documentos',    icon: FileText, section: 'Conhecer' },
  { to: '/app/transparencia', label: 'Transparência', icon: Wallet, section: 'Conhecer' },
  { to: '/app/settings',      label: 'Preferências',  icon: SlidersHorizontal, section: 'Conhecer' },
];

export default function ResidentApp() {
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar items={NAV} title="Morador" />
      <main className="w-full min-w-0 flex-1 px-4 sm:px-6 lg:px-10 py-8 max-w-6xl">
        <Suspense fallback={<div className="py-16 text-center text-sm text-dusk-300">{t('Carregando...')}</div>}>
          <Routes>
            <Route index               element={<Overview />} />
            <Route path="packages"     element={<Packages />} />
            <Route path="visitors"     element={<Visitors />} />
            <Route path="tickets"      element={<Tickets />} />
            <Route path="amenities"    element={<Amenities />} />
            <Route path="announcements"element={<Announcements />} />
            <Route path="documents"    element={<Documents />} />
            <Route path="proposals"    element={<Proposals />} />
            <Route path="proposals/:id"element={<ProposalDetail />} />
            <Route path="assemblies"   element={<Assemblies />} />
            <Route path="assemblies/:id" element={<AssemblyDetail />} />
            <Route path="meetings"     element={<Meetings />} />
            <Route path="transparencia" element={<Transparencia />} />
            <Route path="suggest"      element={<Suggest />} />
            <Route path="settings"     element={<Settings />} />
            <Route path="*"            element={<Navigate to="/app" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
