import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AlertTriangle, Bot, Home, Inbox, Vote, Calendar, Megaphone, Users, UserCheck, Gavel, Building2, Wallet, Waves, Wrench, ShieldCheck, FileText, BookOpenText, ClipboardList, Briefcase } from 'lucide-react';
import Sidebar, { NavItem } from '../../components/Sidebar';
import WhatsAppHealthPill from '../../components/WhatsAppHealthPill';
import { apiGet } from '../../lib/api';
import {
  type AgencyAccessPortfolio,
  type AgencyBuildingCapability,
  boardAccessContext,
  canUseBoardCapability,
  firstAllowedBoardPath,
} from '../../lib/agencyAccess';
import { useAuth } from '../../lib/auth';
import { t } from '../../lib/i18n';

const BoardOverview = lazy(() => import('./BoardOverview'));
const Suggestions = lazy(() => import('./Suggestions'));
const BoardProposals = lazy(() => import('./BoardProposals'));
const BoardProposalDetail = lazy(() => import('./BoardProposalDetail'));
const BoardMeetings = lazy(() => import('./BoardMeetings'));
const BoardMeetingDetail = lazy(() => import('./BoardMeetingDetail'));
const BoardAnnouncements = lazy(() => import('./BoardAnnouncements'));
const Residents = lazy(() => import('./Residents'));
const Pending = lazy(() => import('./Pending'));
const BoardAssemblies = lazy(() => import('./BoardAssemblies'));
const BoardAssemblyDetail = lazy(() => import('./BoardAssemblyDetail'));
const BoardEdificio = lazy(() => import('./BoardEdificio'));
const BoardFinancas = lazy(() => import('./BoardFinancas'));
const BoardAmenities = lazy(() => import('./BoardAmenities'));
const BoardServices = lazy(() => import('./BoardServices'));
const BoardAgent = lazy(() => import('./BoardAgent'));
const BoardTickets = lazy(() => import('./BoardTickets'));
const BoardConciergeStaff = lazy(() => import('./BoardConciergeStaff'));
const BoardDocuments = lazy(() => import('./BoardDocuments'));
const BoardMemory = lazy(() => import('./BoardMemory'));
const BoardReports = lazy(() => import('./BoardReports'));
const BoardAgencyPortfolio = lazy(() => import('./BoardAgencyPortfolio'));

interface TicketSummary {
  needs_admin: number;
  blocked_no_vendor: number;
  blocked_no_response: number;
  verified_ready: number;
  awaiting_verification: number;
}

interface PortfolioResponse {
  agencies: AgencyAccessPortfolio[];
}

type BoardNavItem = NavItem & {
  capability?: AgencyBuildingCapability;
};

function LoadingBoard() {
  return <div className="py-16 text-center text-sm text-dusk-300">{t('Carregando...')}</div>;
}

function BoardIndex({ access }: { access: ReturnType<typeof boardAccessContext> }) {
  if (access.loading) return <LoadingBoard />;
  if (access.scoped && !canUseBoardCapability(access, 'building_admin')) {
    return <Navigate to={firstAllowedBoardPath(access)} replace />;
  }
  return <BoardOverview />;
}

function ProtectedBoardRoute({
  access,
  capability,
  children,
}: {
  access: ReturnType<typeof boardAccessContext>;
  capability?: AgencyBuildingCapability;
  children: React.ReactNode;
}) {
  if (access.loading) return <LoadingBoard />;
  if (!canUseBoardCapability(access, capability)) {
    return <Navigate to={firstAllowedBoardPath(access)} replace />;
  }
  return <>{children}</>;
}

export default function BoardApp() {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState<number>(0);
  // Inbox badge — anything that wants an admin click: blocked-needs-admin
  // + verified-but-not-dispatched + awaiting-community-verification. Polled
  // every 30s alongside the pending memberships count to stay cheap.
  const [ticketSummary, setTicketSummary] = useState<TicketSummary | null>(null);
  const [agencyPortfolios, setAgencyPortfolios] = useState<AgencyAccessPortfolio[] | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiGet<PortfolioResponse>('/agencies/portfolio')
      .then((res) => {
        if (alive) setAgencyPortfolios(res.agencies || []);
      })
      .catch(() => {
        if (alive) setAgencyPortfolios([]);
      })
      .finally(() => {
        if (alive) setPortfolioLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const access = useMemo(
    () => boardAccessContext(agencyPortfolios, user?.condominium_id, portfolioLoading),
    [agencyPortfolios, user?.condominium_id, portfolioLoading],
  );

  const canUseBuildingAdmin = canUseBoardCapability(access, 'building_admin');
  const canUseMaintenance = canUseBoardCapability(access, 'maintenance');

  useEffect(() => {
    if (access.loading) return;
    const loadPending = () => {
      if (!canUseBuildingAdmin) {
        setPendingCount(0);
        return Promise.resolve();
      }
      return apiGet<any[]>('/memberships/pending').then((r) => setPendingCount(r.length)).catch(() => {});
    };
    const loadTickets = () => {
      if (!canUseMaintenance) {
        setTicketSummary(null);
        return Promise.resolve();
      }
      return apiGet<TicketSummary>('/tickets/summary').then(setTicketSummary).catch(() => {});
    };
    loadPending();
    loadTickets();
    const id = setInterval(() => {
      loadPending();
      loadTickets();
    }, 30000);
    return () => clearInterval(id);
  }, [access.loading, canUseBuildingAdmin, canUseMaintenance]);

  // Sidebar shows a badge with the total "needs your eyes" count. Includes
  // blocked tickets first (those literally can't progress without the admin),
  // then verified-ready (one-click dispatch away), then awaiting-verification
  // (community will probably handle but the admin should know). Awaiting-
  // verification is excluded from the alarm tone — it's informational.
  const ticketBadge = ticketSummary
    ? ticketSummary.needs_admin + ticketSummary.verified_ready
    : 0;

  // Sidebar layout — grouped into 3 sections so the admin can scan
  // by intent (Atender = "respond now"; Decidir = "lead the building";
  // Conhecer = "look something up"). Items must be declared in section
  // order — the Sidebar groups adjacent items, so any item with the
  // same section header has to sit next to its siblings here.
  //
  // Items without `section` (Visão geral, Portfólio) render at the top
  // without a header, giving the home views a quiet zone above the
  // grouped sections.
  const nav: NavItem[] = useMemo(() => {
    const items: BoardNavItem[] = [
      // Top — quick context. No section header.
      { to: '/board',               label: 'Visão geral',   icon: Home, capability: 'building_admin' },
      { to: '/board/portfolio',     label: 'Portfólio',     icon: Briefcase },

      // Atender — daily inbox. Things waiting on you.
      { to: '/board/tickets',       label: 'Chamados',      icon: AlertTriangle, badge: ticketBadge || undefined, capability: 'maintenance', section: 'Atender' },
      { to: '/board/suggestions',   label: 'Sugestões',     icon: Inbox, capability: 'building_admin', section: 'Atender' },
      { to: '/board/pending',       label: 'Pendentes',     icon: UserCheck, badge: pendingCount || undefined, capability: 'building_admin', section: 'Atender' },
      { to: '/board/concierge',     label: 'Portaria',      icon: ShieldCheck, capability: 'building_admin', section: 'Atender' },

      // Decidir — admin work. Propose, vote, schedule, communicate.
      { to: '/board/agent',         label: 'Agente IA',     icon: Bot, capability: 'building_admin', section: 'Decidir' },
      { to: '/board/proposals',     label: 'Propostas',     icon: Vote, capability: 'building_admin', section: 'Decidir' },
      { to: '/board/assemblies',    label: 'Assembleias',   icon: Gavel, capability: 'building_admin', section: 'Decidir' },
      { to: '/board/meetings',      label: 'Reuniões',      icon: Calendar, capability: 'building_admin', section: 'Decidir' },
      { to: '/board/announcements', label: 'Comunicados',   icon: Megaphone, capability: 'building_admin', section: 'Decidir' },
      { to: '/board/services',      label: 'Operação',      icon: Wrench, capability: 'maintenance', section: 'Decidir' },

      // Conhecer — context & reference. Read-only mostly.
      { to: '/board/residents',     label: 'Moradores',     icon: Users, capability: 'building_admin', section: 'Conhecer' },
      { to: '/board/amenities',     label: 'Áreas comuns',  icon: Waves, capability: 'building_admin', section: 'Conhecer' },
      { to: '/board/edificio',      label: 'Edifício',      icon: Building2, capability: 'building_admin', section: 'Conhecer' },
      { to: '/board/documents',     label: 'Documentos',    icon: FileText, capability: 'documents', section: 'Conhecer' },
      { to: '/board/memory',        label: 'Memória',       icon: BookOpenText, capability: 'building_admin', section: 'Conhecer' },
      { to: '/board/reports',       label: 'Relatórios',    icon: ClipboardList, capability: 'reports', section: 'Conhecer' },
      { to: '/board/financas',      label: 'Finanças',      icon: Wallet, capability: 'finance', section: 'Conhecer' },
    ];
    return items.filter((item) => canUseBoardCapability(access, item.capability));
  }, [access, pendingCount, ticketBadge]);

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar
        items={nav}
        title="Síndico"
        headerSlot={canUseMaintenance ? <WhatsAppHealthPill /> : undefined}
      />
      <main className="w-full min-w-0 flex-1 px-4 sm:px-6 lg:px-10 py-8 max-w-6xl animate-fade-up">
        <Suspense fallback={<div className="py-16 text-center text-sm text-dusk-300">{t('Carregando...')}</div>}>
          <Routes>
            <Route index                   element={<BoardIndex access={access} />} />
            <Route path="portfolio"        element={<BoardAgencyPortfolio />} />
            <Route path="suggestions"      element={<ProtectedBoardRoute access={access} capability="building_admin"><Suggestions /></ProtectedBoardRoute>} />
            <Route path="agent"            element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardAgent /></ProtectedBoardRoute>} />
            <Route path="memory"           element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardMemory /></ProtectedBoardRoute>} />
            <Route path="reports"          element={<ProtectedBoardRoute access={access} capability="reports"><BoardReports /></ProtectedBoardRoute>} />
            <Route path="pending"          element={<ProtectedBoardRoute access={access} capability="building_admin"><Pending /></ProtectedBoardRoute>} />
            <Route path="proposals"        element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardProposals /></ProtectedBoardRoute>} />
            <Route path="proposals/:id"    element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardProposalDetail /></ProtectedBoardRoute>} />
            <Route path="meetings"         element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardMeetings /></ProtectedBoardRoute>} />
            <Route path="meetings/:id"     element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardMeetingDetail /></ProtectedBoardRoute>} />
            <Route path="assemblies"       element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardAssemblies /></ProtectedBoardRoute>} />
            <Route path="assemblies/:id"   element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardAssemblyDetail /></ProtectedBoardRoute>} />
            <Route path="announcements"    element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardAnnouncements /></ProtectedBoardRoute>} />
            <Route path="residents"        element={<ProtectedBoardRoute access={access} capability="building_admin"><Residents /></ProtectedBoardRoute>} />
            <Route path="concierge"        element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardConciergeStaff /></ProtectedBoardRoute>} />
            <Route path="amenities"        element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardAmenities /></ProtectedBoardRoute>} />
            <Route path="documents"        element={<ProtectedBoardRoute access={access} capability="documents"><BoardDocuments /></ProtectedBoardRoute>} />
            <Route path="edificio"         element={<ProtectedBoardRoute access={access} capability="building_admin"><BoardEdificio /></ProtectedBoardRoute>} />
            <Route path="services"         element={<ProtectedBoardRoute access={access} capability="maintenance"><BoardServices /></ProtectedBoardRoute>} />
            <Route path="tickets"          element={<ProtectedBoardRoute access={access} capability="maintenance"><BoardTickets /></ProtectedBoardRoute>} />
            <Route path="financas"         element={<ProtectedBoardRoute access={access} capability="finance"><BoardFinancas /></ProtectedBoardRoute>} />
            <Route path="*"                element={<Navigate to="/board" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
