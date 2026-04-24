import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Home, Inbox, Vote, Calendar, Megaphone, Users, UserCheck } from 'lucide-react';
import Sidebar, { NavItem } from '../../components/Sidebar';
import BoardOverview from './BoardOverview';
import Suggestions from './Suggestions';
import BoardProposals from './BoardProposals';
import BoardProposalDetail from './BoardProposalDetail';
import BoardMeetings from './BoardMeetings';
import BoardMeetingDetail from './BoardMeetingDetail';
import BoardAnnouncements from './BoardAnnouncements';
import Residents from './Residents';
import Pending from './Pending';
import { apiGet } from '../../lib/api';

export default function BoardApp() {
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    apiGet<any[]>('/memberships/pending').then((r) => setPendingCount(r.length)).catch(() => {});
    const id = setInterval(() => {
      apiGet<any[]>('/memberships/pending').then((r) => setPendingCount(r.length)).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const nav: NavItem[] = [
    { to: '/board',               label: 'Overview',      icon: Home },
    { to: '/board/suggestions',   label: 'Suggestions',   icon: Inbox },
    { to: '/board/pending',       label: 'Pending',       icon: UserCheck, badge: pendingCount || undefined },
    { to: '/board/proposals',     label: 'Proposals',     icon: Vote },
    { to: '/board/meetings',      label: 'Meetings',      icon: Calendar },
    { to: '/board/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/board/residents',     label: 'Residents',     icon: Users },
  ];

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar items={nav} title="Board admin" />
      <main className="w-full min-w-0 flex-1 px-4 sm:px-6 lg:px-10 py-8 max-w-6xl animate-fade-up">
        <Routes>
          <Route index                   element={<BoardOverview />} />
          <Route path="suggestions"      element={<Suggestions />} />
          <Route path="pending"          element={<Pending />} />
          <Route path="proposals"        element={<BoardProposals />} />
          <Route path="proposals/:id"    element={<BoardProposalDetail />} />
          <Route path="meetings"         element={<BoardMeetings />} />
          <Route path="meetings/:id"     element={<BoardMeetingDetail />} />
          <Route path="announcements"    element={<BoardAnnouncements />} />
          <Route path="residents"        element={<Residents />} />
          <Route path="*"                element={<Navigate to="/board" replace />} />
        </Routes>
      </main>
    </div>
  );
}
