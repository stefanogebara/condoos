import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Home, Package, DoorOpen, Waves, Megaphone, Vote, Calendar, Sparkles } from 'lucide-react';
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

const NAV: NavItem[] = [
  { to: '/app',               label: 'Overview',      icon: Home },
  { to: '/app/packages',      label: 'Packages',      icon: Package },
  { to: '/app/visitors',      label: 'Visitors',      icon: DoorOpen },
  { to: '/app/amenities',     label: 'Amenities',     icon: Waves },
  { to: '/app/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/app/proposals',     label: 'Proposals',     icon: Vote },
  { to: '/app/meetings',      label: 'Meetings',      icon: Calendar },
  { to: '/app/suggest',       label: 'Suggest',       icon: Sparkles },
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
          <Route path="meetings"     element={<Meetings />} />
          <Route path="suggest"      element={<Suggest />} />
          <Route path="*"            element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  );
}
