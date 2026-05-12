import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AlertTriangle, Bot, Home, Inbox, Vote, Calendar, Megaphone, Users, UserCheck, Gavel, Building2, Wallet, Waves, Wrench, ShieldCheck } from 'lucide-react';
import Sidebar, { NavItem } from '../../components/Sidebar';
import WhatsAppHealthPill from '../../components/WhatsAppHealthPill';
import BoardOverview from './BoardOverview';
import Suggestions from './Suggestions';
import BoardProposals from './BoardProposals';
import BoardProposalDetail from './BoardProposalDetail';
import BoardMeetings from './BoardMeetings';
import BoardMeetingDetail from './BoardMeetingDetail';
import BoardAnnouncements from './BoardAnnouncements';
import Residents from './Residents';
import Pending from './Pending';
import BoardAssemblies from './BoardAssemblies';
import BoardAssemblyDetail from './BoardAssemblyDetail';
import BoardEdificio from './BoardEdificio';
import BoardFinancas from './BoardFinancas';
import BoardAmenities from './BoardAmenities';
import BoardServices from './BoardServices';
import BoardAgent from './BoardAgent';
import BoardTickets from './BoardTickets';
import BoardConciergeStaff from './BoardConciergeStaff';
import { apiGet } from '../../lib/api';

interface TicketSummary {
  needs_admin: number;
  blocked_no_vendor: number;
  blocked_no_response: number;
  verified_ready: number;
  awaiting_verification: number;
}

export default function BoardApp() {
  const [pendingCount, setPendingCount] = useState<number>(0);
  // Inbox badge — anything that wants an admin click: blocked-needs-admin
  // + verified-but-not-dispatched + awaiting-community-verification. Polled
  // every 30s alongside the pending memberships count to stay cheap.
  const [ticketSummary, setTicketSummary] = useState<TicketSummary | null>(null);

  useEffect(() => {
    const loadPending = () => apiGet<any[]>('/memberships/pending').then((r) => setPendingCount(r.length)).catch(() => {});
    const loadTickets = () => apiGet<TicketSummary>('/tickets/summary').then(setTicketSummary).catch(() => {});
    loadPending();
    loadTickets();
    const id = setInterval(() => {
      loadPending();
      loadTickets();
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Sidebar shows a badge with the total "needs your eyes" count. Includes
  // blocked tickets first (those literally can't progress without the admin),
  // then verified-ready (one-click dispatch away), then awaiting-verification
  // (community will probably handle but the admin should know). Awaiting-
  // verification is excluded from the alarm tone — it's informational.
  const ticketBadge = ticketSummary
    ? ticketSummary.needs_admin + ticketSummary.verified_ready
    : 0;

  const nav: NavItem[] = [
    { to: '/board',               label: 'Visão geral',   icon: Home },
    { to: '/board/suggestions',   label: 'Sugestões',     icon: Inbox },
    { to: '/board/agent',         label: 'Agente IA',     icon: Bot },
    { to: '/board/pending',       label: 'Pendentes',     icon: UserCheck, badge: pendingCount || undefined },
    { to: '/board/proposals',     label: 'Propostas',     icon: Vote },
    { to: '/board/assemblies',    label: 'Assembleias',   icon: Gavel },
    { to: '/board/meetings',      label: 'Reuniões',      icon: Calendar },
    { to: '/board/announcements', label: 'Comunicados',   icon: Megaphone },
    { to: '/board/residents',     label: 'Moradores',     icon: Users },
    { to: '/board/concierge',     label: 'Portaria',      icon: ShieldCheck },
    { to: '/board/amenities',     label: 'Áreas comuns',  icon: Waves },
    { to: '/board/edificio',      label: 'Edifício',      icon: Building2 },
    { to: '/board/services',      label: 'Operação',      icon: Wrench },
    { to: '/board/tickets',       label: 'Chamados',      icon: AlertTriangle, badge: ticketBadge || undefined },
    { to: '/board/financas',      label: 'Finanças',      icon: Wallet },
  ];

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar items={nav} title="Síndico" headerSlot={<WhatsAppHealthPill />} />
      <main className="w-full min-w-0 flex-1 px-4 sm:px-6 lg:px-10 py-8 max-w-6xl animate-fade-up">
        <Routes>
          <Route index                   element={<BoardOverview />} />
          <Route path="suggestions"      element={<Suggestions />} />
          <Route path="agent"            element={<BoardAgent />} />
          <Route path="pending"          element={<Pending />} />
          <Route path="proposals"        element={<BoardProposals />} />
          <Route path="proposals/:id"    element={<BoardProposalDetail />} />
          <Route path="meetings"         element={<BoardMeetings />} />
          <Route path="meetings/:id"     element={<BoardMeetingDetail />} />
          <Route path="assemblies"       element={<BoardAssemblies />} />
          <Route path="assemblies/:id"   element={<BoardAssemblyDetail />} />
          <Route path="announcements"    element={<BoardAnnouncements />} />
          <Route path="residents"        element={<Residents />} />
          <Route path="concierge"        element={<BoardConciergeStaff />} />
          <Route path="amenities"        element={<BoardAmenities />} />
          <Route path="edificio"         element={<BoardEdificio />} />
          <Route path="services"         element={<BoardServices />} />
          <Route path="tickets"          element={<BoardTickets />} />
          <Route path="financas"         element={<BoardFinancas />} />
          <Route path="*"                element={<Navigate to="/board" replace />} />
        </Routes>
      </main>
    </div>
  );
}
