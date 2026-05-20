export type AgencyRole =
  | 'agency_admin'
  | 'building_admin'
  | 'finance_manager'
  | 'maintenance_manager'
  | 'concierge_supervisor';

export type AgencyBuildingCapability =
  | 'building_admin'
  | 'finance'
  | 'maintenance'
  | 'concierge'
  | 'documents'
  | 'reports';

export interface AgencyAccessPortfolio {
  id: number;
  role: AgencyRole | string;
  capabilities?: AgencyBuildingCapability[];
  buildings: Array<{ id: number }>;
}

export interface BoardAccessContext {
  scoped: boolean;
  loading: boolean;
  activeAgency: AgencyAccessPortfolio | null;
  capabilities: Set<AgencyBuildingCapability>;
}

export const ALL_BOARD_CAPABILITIES: AgencyBuildingCapability[] = [
  'building_admin',
  'finance',
  'maintenance',
  'concierge',
  'documents',
  'reports',
];

const ROLE_CAPABILITIES: Record<AgencyRole, AgencyBuildingCapability[]> = {
  agency_admin: ALL_BOARD_CAPABILITIES,
  building_admin: ALL_BOARD_CAPABILITIES,
  finance_manager: ['finance', 'documents', 'reports'],
  maintenance_manager: ['maintenance', 'documents', 'reports'],
  concierge_supervisor: ['concierge'],
};

function isAgencyRole(value: string): value is AgencyRole {
  return value in ROLE_CAPABILITIES;
}

export function capabilitiesForAgencyRole(role: string): AgencyBuildingCapability[] {
  return isAgencyRole(role) ? [...ROLE_CAPABILITIES[role]] : [];
}

export function boardAccessContext(
  portfolios: AgencyAccessPortfolio[] | null | undefined,
  activeCondominiumId: number | null | undefined,
  loading = false,
): BoardAccessContext {
  if (loading && portfolios == null) {
    return {
      scoped: true,
      loading,
      activeAgency: null,
      capabilities: new Set(),
    };
  }

  const agencies = portfolios || [];
  if (agencies.length === 0) {
    return {
      scoped: false,
      loading,
      activeAgency: null,
      capabilities: new Set(ALL_BOARD_CAPABILITIES),
    };
  }

  const activeAgency = agencies.find((agency) =>
    agency.buildings.some((building) => building.id === activeCondominiumId),
  ) || agencies[0] || null;
  const rawCapabilities = activeAgency?.capabilities?.length
    ? activeAgency.capabilities
    : capabilitiesForAgencyRole(activeAgency?.role || '');

  return {
    scoped: true,
    loading,
    activeAgency,
    capabilities: new Set(rawCapabilities),
  };
}

export function canUseBoardCapability(
  access: BoardAccessContext,
  capability?: AgencyBuildingCapability,
): boolean {
  if (!capability) return true;
  if (!access.scoped) return true;
  return access.capabilities.has(capability);
}

export function firstAllowedBoardPath(access: BoardAccessContext): string {
  if (!access.scoped || access.capabilities.has('building_admin')) return '/board';
  if (access.capabilities.has('maintenance')) return '/board/tickets';
  if (access.capabilities.has('finance')) return '/board/financas';
  if (access.capabilities.has('documents')) return '/board/documents';
  if (access.capabilities.has('reports')) return '/board/reports';
  return '/board/portfolio';
}
