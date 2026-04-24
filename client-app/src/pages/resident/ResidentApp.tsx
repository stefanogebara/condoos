import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Home, Package, DoorOpen, Waves, Megaphone, Vote, Calendar, Sparkles, Gavel, SlidersHorizontal } from 'lucide-react';
import Sidebar, { NavItem } from '../../components/Sidebar';
import Overview from './Overview';
import Packages from './Packages';
import Visitors from './Visitors';
import Amenities from './Amenities';
import Announcements from './Announcements';
import Proposals from './Proposals';
import ProposalDetail from './ProposalDetail';
import Meetings from './Meetings';
import Suggest from './Suggest';
import Assemblies from './Assemblies';
import AssemblyDetail from './AssemblyDetail';
import Settings from './Settings';

const NAV: NavItem[] = [
  { to: '/app',               label: 'Overview',      icon: Home },
  { to: '/app/packages',      label: 'Packages',      icon: Package },
  { to: '/app/visitors',      label: 'Visitors',      icon: DoorOpen },
  { to: '/app/amenities',     label: 'Amenities',     icon: Waves },
  { to: '/app/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/app/proposals',     label: 'Proposals',     icon: Vote },
  { to: '/app/assemblies',    label: 'Assemblies',    icon: Gavel },
  { to: '/app/meetings',      label: 'Meetings',      icon: Calendar },
  { to: '/app/suggest',       label: 'Suggest',       icon: Sparkles },
  { to: '/app/settings',      label: 'Settings',      icon: SlidersHorizontal },
];

export default function ResidentApp() {
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar items={NAV} title="Resident" />
      <main className="w-full min-w-0 flex-1 px-4 sm:px-6 lg:px-10 py-8 max-w-6xl animate-fade-up">
        <Routes>
          <Route index               element={<Overview />} />
          <Route path="packages"     element={<Packages />} />
          <Route path="visitors"     element={<Visitors />} />
          <Route path="amenities"    element={<Amenities />} />
          <Route path="announcements"element={<Announcements />} />
          <Route path="proposals"    element={<Proposals />} />
          <Route path="proposals/:id"element={<ProposalDetail />} />
          <Route path="assemblies"   element={<Assemblies />} />
          <Route path="assemblies/:id" element={<AssemblyDetail />} />
          <Route path="meetings"     element={<Meetings />} />
          <Route path="suggest"      element={<Suggest />} />
          <Route path="settings"     element={<Settings />} />
          <Route path="*"            element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  );
}
