import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Building2, Calendar, CheckCircle2, Copy, Download, FileArchive, KeyRound, LockKeyhole, PlusCircle, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, Wallet, Wrench } from 'lucide-react';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { api, apiDelete, apiGet, apiPost } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useAuth, type User } from '../../lib/auth';

interface AgencyBuildingMetrics {
  pending_residents: number;
  unresolved_tickets: number;
  urgent_tickets: number;
  overdue_dues: number;
  pending_payment_proofs: number;
  vendor_sla_problems: number;
  proposals_missing_budget: number;
  upcoming_meetings: number;
}

interface AgencyBuilding {
  id: number;
  name: string;
  address: string;
  invite_code: string | null;
  metrics: AgencyBuildingMetrics;
}

interface AgencyPermissionReview {
  total_staff: number;
  agency_admins: number;
  scoped_staff: number;
  unassigned_staff: number;
  pending_invites: number;
  expired_invites: number;
  failed_invite_emails: number;
  buildings_without_direct_staff: Array<{
    id: number;
    name: string;
  }>;
}

type AgencyAttentionKind =
  | 'urgent_tickets'
  | 'vendor_sla_problems'
  | 'overdue_dues'
  | 'pending_payment_proofs'
  | 'pending_residents'
  | 'proposals_missing_budget';

interface AgencyAttentionItem {
  id: string;
  kind: AgencyAttentionKind;
  severity: 'critical' | 'warning' | 'info';
  condominium_id: number;
  condominium_name: string;
  count: number;
  route: string;
}

interface AgencyPortfolio {
  id: number;
  name: string;
  slug: string;
  role: string;
  totals: AgencyBuildingMetrics;
  permission_review: AgencyPermissionReview | null;
  attention: AgencyAttentionItem[];
  buildings: AgencyBuilding[];
}

interface PortfolioResponse {
  agencies: AgencyPortfolio[];
}

interface AgencySetupCode {
  id: number;
  label: string | null;
  agency_name: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  disabled_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  last_used_at: string | null;
  activation_count: number;
  last_activated_at: string | null;
  last_activated_condominium_id: number | null;
  last_activated_condominium_name: string | null;
  last_activated_by_email: string | null;
  status: 'active' | 'disabled' | 'expired' | 'exhausted';
  code?: string;
}

type AgencyRole = 'agency_admin' | 'building_admin' | 'finance_manager' | 'maintenance_manager' | 'concierge_supervisor';
type AgencyExportKind = 'residents' | 'finance' | 'tickets' | 'work-orders' | 'audit';

interface AgencyStaffMember {
  id: number;
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: AgencyRole;
  created_at: string;
  assigned_building_ids: number[];
}

interface AgencyStaffInvite {
  id: number;
  agency_id: number;
  agency_name: string;
  email: string;
  role: AgencyRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: number | null;
  revoked_at: string | null;
  created_by_user_id: number | null;
  email_status: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  assigned_building_ids: number[];
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  token?: string;
}

interface AgencyAuditEvent {
  id: number;
  created_at: string;
  condominium_id: number | null;
  condominium_name: string | null;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  metadata: string | null;
}

interface IntegrationStatus {
  private_access: { configured: boolean; required: boolean; active_setup_codes: number; env_setup_codes: number };
  email: { configured: boolean; provider: string; from_configured: boolean };
  google_login: { configured: boolean };
  whatsapp: { configured: boolean; provider: string; from: string | null };
  uploads: { configured: boolean; driver: string; bucket_configured: boolean };
  ai: { configured: boolean; model: string };
  backups: { configured: boolean; retention_days: number; last_attempt_at: string | null };
  observability: { sentry_configured: boolean; posthog_configured: boolean };
}

function Metric({ icon: Icon, label, value, urgent = false }: { icon: any; label: string; value: number; urgent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 bg-white/60 ${urgent && value > 0 ? 'border-peach-200' : 'border-white/70'}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-dusk-300">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`mt-1 font-display text-2xl ${urgent && value > 0 ? 'text-peach-600' : 'text-dusk-500'}`}>{value}</div>
    </div>
  );
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/60 border border-white/70 px-3 py-2">
      <span className="text-sm text-dusk-400">{label}</span>
      <Badge tone={ok ? 'sage' : 'warning'}>
        {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        {ok ? t('Configurado') : t('Revisar')}
      </Badge>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return t('Sem vencimento');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function codeTone(status: AgencySetupCode['status']) {
  if (status === 'active') return 'sage' as const;
  if (status === 'disabled' || status === 'expired') return 'warning' as const;
  return 'neutral' as const;
}

function codeStatusLabel(status: AgencySetupCode['status']) {
  const labels = {
    active: 'Ativo',
    disabled: 'Desativado',
    expired: 'Expirado',
    exhausted: 'Esgotado',
  };
  return t(labels[status]);
}

const agencyRoles: AgencyRole[] = [
  'agency_admin',
  'building_admin',
  'finance_manager',
  'maintenance_manager',
  'concierge_supervisor',
];

const operationalExports: Array<{ kind: AgencyExportKind; label: string }> = [
  { kind: 'residents', label: 'Moradores' },
  { kind: 'finance', label: 'Financeiro' },
  { kind: 'tickets', label: 'Chamados' },
  { kind: 'work-orders', label: 'Ordens de serviço' },
  { kind: 'audit', label: 'Auditoria' },
];

function agencyRoleLabel(role: AgencyRole | string) {
  const labels: Record<string, string> = {
    agency_admin: 'Admin de administradora',
    building_admin: 'Admin de edifício',
    finance_manager: 'Finanças',
    maintenance_manager: 'Manutenção',
    concierge_supervisor: 'Supervisor de portaria',
  };
  return t(labels[role] || role);
}

function attentionLabel(kind: AgencyAttentionKind) {
  const labels: Record<AgencyAttentionKind, string> = {
    urgent_tickets: 'Chamados urgentes',
    vendor_sla_problems: 'SLA de fornecedor',
    overdue_dues: 'Cobranças em atraso',
    pending_payment_proofs: 'Comprovantes pendentes',
    pending_residents: 'Moradores pendentes',
    proposals_missing_budget: 'Propostas sem orçamento',
  };
  return t(labels[kind]);
}

function attentionTone(severity: AgencyAttentionItem['severity']) {
  if (severity === 'critical') return 'peach' as const;
  if (severity === 'warning') return 'warning' as const;
  return 'sage' as const;
}

export default function BoardAgencyPortfolio() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [selectedAgencyId, setSelectedAgencyId] = useState<number | null>(null);
  const [setupCodes, setSetupCodes] = useState<AgencySetupCode[]>([]);
  const [setupCodesLoading, setSetupCodesLoading] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [setupCodeError, setSetupCodeError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', max_uses: '1', expires_at: '' });
  const [staff, setStaff] = useState<AgencyStaffMember[]>([]);
  const [staffInvites, setStaffInvites] = useState<AgencyStaffInvite[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [createdStaffInvite, setCreatedStaffInvite] = useState<AgencyStaffInvite | null>(null);
  const [copiedStaffInvite, setCopiedStaffInvite] = useState(false);
  const [switchingBuildingId, setSwitchingBuildingId] = useState<number | null>(null);
  const [auditEvents, setAuditEvents] = useState<AgencyAuditEvent[]>([]);
  const [auditEventsLoading, setAuditEventsLoading] = useState(false);
  const [staffForm, setStaffForm] = useState<{ email: string; role: AgencyRole; building_ids: number[] }>({
    email: '',
    role: 'building_admin',
    building_ids: [],
  });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [nextPortfolio, nextStatus] = await Promise.all([
        apiGet<PortfolioResponse>('/agencies/portfolio'),
        apiGet<IntegrationStatus>('/admin/integrations/status'),
      ]);
      setPortfolio(nextPortfolio);
      setStatus(nextStatus);
      setSelectedAgencyId((current) => {
        if (current && nextPortfolio.agencies.some((agency) => agency.id === current)) return current;
        return nextPortfolio.agencies[0]?.id || null;
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const primaryAgency = useMemo(() => {
    const agencies = portfolio?.agencies || [];
    return agencies.find((agency) => agency.id === selectedAgencyId) || agencies[0] || null;
  }, [portfolio, selectedAgencyId]);
  const totals = useMemo(() => primaryAgency?.totals || {
    pending_residents: 0,
    unresolved_tickets: 0,
    urgent_tickets: 0,
    overdue_dues: 0,
    pending_payment_proofs: 0,
    vendor_sla_problems: 0,
    proposals_missing_budget: 0,
    upcoming_meetings: 0,
  }, [primaryAgency]);
  const permissionReview = primaryAgency?.permission_review || null;

  async function loadSetupCodes(agencyId = primaryAgency?.id) {
    if (!agencyId || primaryAgency?.role !== 'agency_admin') {
      setSetupCodes([]);
      return;
    }
    setSetupCodesLoading(true);
    try {
      const res = await apiGet<{ setup_codes: AgencySetupCode[] }>(`/agencies/${agencyId}/setup-codes`);
      setSetupCodes(res.setup_codes);
    } catch {
      setSetupCodeError(t('Não foi possível carregar os códigos privados.'));
    } finally {
      setSetupCodesLoading(false);
    }
  }

  useEffect(() => {
    loadSetupCodes().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryAgency?.id, primaryAgency?.role]);

  async function loadAuditEvents(agencyId = primaryAgency?.id) {
    if (!agencyId) {
      setAuditEvents([]);
      return;
    }
    setAuditEventsLoading(true);
    try {
      const res = await apiGet<{ events: AgencyAuditEvent[] }>(`/agencies/${agencyId}/audit-events?limit=8`);
      setAuditEvents(res.events);
    } finally {
      setAuditEventsLoading(false);
    }
  }

  useEffect(() => {
    loadAuditEvents().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryAgency?.id]);

  async function loadStaff(agencyId = primaryAgency?.id) {
    if (!agencyId || primaryAgency?.role !== 'agency_admin') {
      setStaff([]);
      setStaffInvites([]);
      return;
    }
    setStaffLoading(true);
    setStaffError(null);
    try {
      const res = await apiGet<{ staff: AgencyStaffMember[]; invites?: AgencyStaffInvite[] }>(`/agencies/${agencyId}/staff`);
      setStaff(res.staff);
      setStaffInvites(res.invites || []);
    } catch {
      setStaffError(t('Não foi possível carregar a equipe.'));
    } finally {
      setStaffLoading(false);
    }
  }

  useEffect(() => {
    loadStaff().catch(() => {});
    setStaffForm((prev) => ({
      ...prev,
      building_ids: primaryAgency?.buildings.length === 1 ? [primaryAgency.buildings[0].id] : [],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryAgency?.id, primaryAgency?.role]);

  async function createCode(e: React.FormEvent) {
    e.preventDefault();
    if (!primaryAgency) return;
    setCreatingCode(true);
    setSetupCodeError(null);
    setCreatedCode(null);
    try {
      const expiresAt = form.expires_at ? new Date(form.expires_at).toISOString() : null;
      const res = await apiPost<{ setup_code: AgencySetupCode & { code: string } }>(`/agencies/${primaryAgency.id}/setup-codes`, {
        label: form.label || undefined,
        max_uses: Number(form.max_uses || 1),
        expires_at: expiresAt,
      });
      setCreatedCode(res.setup_code.code);
      setForm({ label: '', max_uses: '1', expires_at: '' });
      await loadSetupCodes(primaryAgency.id);
      await loadAuditEvents(primaryAgency.id);
    } catch {
      setSetupCodeError(t('Não foi possível criar o código privado.'));
    } finally {
      setCreatingCode(false);
    }
  }

  async function disableCode(codeId: number) {
    if (!primaryAgency) return;
    setSetupCodeError(null);
    await apiPost(`/agencies/${primaryAgency.id}/setup-codes/${codeId}/disable`);
    await loadSetupCodes(primaryAgency.id);
    await loadAuditEvents(primaryAgency.id);
  }

  async function copyCreatedCode() {
    if (!createdCode) return;
    await navigator.clipboard?.writeText(createdCode);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1600);
  }

  async function downloadCsv(path: string, filename: string) {
    const response = await api.get(path, { responseType: 'blob' });
    const blob = response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadPortfolioCsv() {
    if (!primaryAgency) return;
    await downloadCsv(
      `/agencies/${primaryAgency.id}/export/portfolio.csv`,
      `condoos-${primaryAgency.slug}-portfolio.csv`,
    );
    await loadAuditEvents(primaryAgency.id);
  }

  async function downloadOperationalCsv(kind: AgencyExportKind) {
    if (!primaryAgency) return;
    await downloadCsv(
      `/agencies/${primaryAgency.id}/export/${kind}.csv`,
      `condoos-${primaryAgency.slug}-${kind}.csv`,
    );
    await loadAuditEvents(primaryAgency.id);
  }

  function toggleStaffBuilding(buildingId: number) {
    setStaffForm((prev) => {
      const next = prev.building_ids.includes(buildingId)
        ? prev.building_ids.filter((id) => id !== buildingId)
        : [...prev.building_ids, buildingId];
      return { ...prev, building_ids: next };
    });
  }

  async function saveStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!primaryAgency) return;
    setStaffSaving(true);
    setStaffError(null);
    setCreatedStaffInvite(null);
    try {
      const res = await apiPost<{ staff?: AgencyStaffMember; invite?: AgencyStaffInvite }>(`/agencies/${primaryAgency.id}/staff`, {
        email: staffForm.email,
        role: staffForm.role,
        building_ids: staffForm.role === 'agency_admin' ? [] : staffForm.building_ids,
      });
      if (res.invite) setCreatedStaffInvite(res.invite);
      setStaffForm({
        email: '',
        role: 'building_admin',
        building_ids: primaryAgency.buildings.length === 1 ? [primaryAgency.buildings[0].id] : [],
      });
      await loadStaff(primaryAgency.id);
      await load();
      await loadAuditEvents(primaryAgency.id);
    } catch {
      setStaffError(t('Não foi possível salvar a equipe. Verifique se há prédios selecionados e se a permissão faz sentido.'));
    } finally {
      setStaffSaving(false);
    }
  }

  async function copyStaffInviteLink() {
    if (!createdStaffInvite?.token) return;
    const url = `${window.location.origin}/signup?intent=agency&agency_invite=${encodeURIComponent(createdStaffInvite.token)}`;
    await navigator.clipboard?.writeText(url);
    setCopiedStaffInvite(true);
    window.setTimeout(() => setCopiedStaffInvite(false), 1600);
  }

  async function switchActiveBuilding(building: AgencyBuilding, route = '/board') {
    if (!primaryAgency) return;
    if (user?.condominium_id === building.id) {
      window.location.href = route;
      return;
    }
    setSwitchingBuildingId(building.id);
    try {
      const res = await apiPost<{ user: User }>(`/agencies/${primaryAgency.id}/active-building`, {
        condominium_id: building.id,
      });
      if (res.user) localStorage.setItem('condoos_user', JSON.stringify(res.user));
      window.location.href = route;
    } catch {
      setStaffError(t('Não foi possível trocar de prédio.'));
      setSwitchingBuildingId(null);
    }
  }

  async function removeStaffMember(staffId: number) {
    if (!primaryAgency) return;
    setStaffError(null);
    try {
      await apiDelete(`/agencies/${primaryAgency.id}/staff/${staffId}`);
      await loadStaff(primaryAgency.id);
      await loadAuditEvents(primaryAgency.id);
    } catch {
      setStaffError(t('Não foi possível remover este membro da equipe.'));
    }
  }

  function buildingNames(ids: number[]) {
    const byId = new Map((primaryAgency?.buildings || []).map((building) => [building.id, building.name]));
    return ids.map((id) => byId.get(id)).filter(Boolean).join(', ');
  }

  function auditEventTarget(event: AgencyAuditEvent) {
    return [event.target_type, event.target_id].filter(Boolean).join(' #');
  }

  async function openAttentionItem(item: AgencyAttentionItem) {
    const building = primaryAgency?.buildings.find((row) => row.id === item.condominium_id);
    if (!building) return;
    await switchActiveBuilding(building, item.route);
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-8">
        <div>
          <Badge tone="sage" className="mb-3">
            <LockKeyhole className="w-3 h-3" /> {t('Modo privado B2B')}
          </Badge>
          <h1 className="font-display text-4xl text-dusk-500 tracking-tight">{t('Portfólio')}</h1>
          <p className="text-dusk-300 mt-2 max-w-2xl">
            {t('Visão executiva para administradoras: prédios, riscos operacionais, dinheiro e configuração de produção.')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {primaryAgency && (
            <Button variant="ghost" onClick={downloadPortfolioCsv} leftIcon={<Download className="w-4 h-4" />}>
              {t('Exportar CSV')}
            </Button>
          )}
          <Button variant="ghost" onClick={load} loading={loading} leftIcon={<RefreshCw className="w-4 h-4" />}>
            {t('Atualizar')}
          </Button>
        </div>
      </div>

      {!primaryAgency ? (
        <GlassCard className="p-8 text-center">
          <Building2 className="w-10 h-10 mx-auto text-sage-700 mb-3" />
          <h2 className="font-display text-2xl text-dusk-500">{t('Nenhuma administradora vinculada')}</h2>
          <p className="text-sm text-dusk-300 mt-2 max-w-xl mx-auto">
            {t('Quando um prédio for ativado com um código privado de administradora, ele aparecerá aqui com métricas de portfólio.')}
          </p>
        </GlassCard>
      ) : (
        <>
          <GlassCard variant="clay-sage" className="p-5 mb-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-[0.14em] text-dusk-300">{t('Administradora')}</div>
                <h2 className="font-display text-2xl text-dusk-500 mt-1" data-user-content>{primaryAgency.name}</h2>
                <p className="text-sm text-dusk-300 mt-1">{primaryAgency.buildings.length} {t('prédios vinculados')}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {portfolio && portfolio.agencies.length > 1 && (
                  <select
                    className="rounded-full bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-400 outline-none"
                    value={primaryAgency.id}
                    onChange={(event) => setSelectedAgencyId(Number(event.target.value))}
                    aria-label={t('Selecionar administradora')}
                  >
                    {portfolio.agencies.map((agency) => (
                      <option key={agency.id} value={agency.id}>{agency.name}</option>
                    ))}
                  </select>
                )}
                <Badge tone="neutral">{agencyRoleLabel(primaryAgency.role)}</Badge>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              <Metric icon={Users} label={t('Pendentes')} value={totals.pending_residents} />
              <Metric icon={AlertTriangle} label={t('Chamados abertos')} value={totals.unresolved_tickets} urgent />
              <Metric icon={Wallet} label={t('Cobranças em atraso')} value={totals.overdue_dues} urgent />
              <Metric icon={Wrench} label={t('SLA fornecedor')} value={totals.vendor_sla_problems} urgent />
              <Metric icon={ShieldCheck} label={t('Urgentes')} value={totals.urgent_tickets} urgent />
              <Metric icon={FileArchive} label={t('Comprovantes')} value={totals.pending_payment_proofs} />
              <Metric icon={Wallet} label={t('Propostas sem orçamento')} value={totals.proposals_missing_budget} />
              <Metric icon={Calendar} label={t('Reuniões')} value={totals.upcoming_meetings} />
            </div>
          </GlassCard>

          <div className="grid lg:grid-cols-[1fr,360px] gap-5">
            <div className="space-y-3">
              <GlassCard className="p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.14em] text-dusk-300">{t('Prioridade do portfólio')}</div>
                    <h2 className="font-display text-2xl text-dusk-500 mt-1">{t('Atenção agora')}</h2>
                  </div>
                  <Badge tone={primaryAgency.attention.length > 0 ? 'warning' : 'sage'}>
                    {primaryAgency.attention.length > 0
                      ? `${primaryAgency.attention.length} ${t('ações')}`
                      : t('Em dia')}
                  </Badge>
                </div>
                {primaryAgency.attention.length === 0 ? (
                  <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-4 text-sm text-dusk-300">
                    {t('Nenhuma ação urgente no portfólio.')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {primaryAgency.attention.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/60 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone={attentionTone(item.severity)}>{item.count}</Badge>
                            <span className="font-medium text-dusk-500">{attentionLabel(item.kind)}</span>
                          </div>
                          <div className="text-sm text-dusk-300 truncate mt-1" data-user-content>
                            {item.condominium_name}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => openAttentionItem(item)}
                          loading={switchingBuildingId === item.condominium_id}
                          leftIcon={<Building2 className="w-4 h-4" />}
                        >
                          {t('Ver')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>

              {primaryAgency.buildings.map((building) => (
                <GlassCard key={building.id} className="p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h3 className="font-display text-xl text-dusk-500" data-user-content>{building.name}</h3>
                      <p className="text-sm text-dusk-300 mt-0.5" data-user-content>{building.address}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {user?.condominium_id === building.id && <Badge tone="sage">{t('Prédio ativo')}</Badge>}
                      {building.invite_code && <Badge tone="neutral">{t('Código')} {building.invite_code}</Badge>}
                      <Button
                        type="button"
                        variant={user?.condominium_id === building.id ? 'ghost' : 'sage'}
                        onClick={() => switchActiveBuilding(building)}
                        loading={switchingBuildingId === building.id}
                        leftIcon={<Building2 className="w-4 h-4" />}
                      >
                        {t('Abrir prédio')}
                      </Button>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-4 gap-2 mt-4">
                    <Metric icon={AlertTriangle} label={t('Chamados')} value={building.metrics.unresolved_tickets} urgent />
                    <Metric icon={Wallet} label={t('Atrasos')} value={building.metrics.overdue_dues} urgent />
                    <Metric icon={Users} label={t('Pendentes')} value={building.metrics.pending_residents} />
                    <Metric icon={Wrench} label={t('SLA')} value={building.metrics.vendor_sla_problems} urgent />
                  </div>
                </GlassCard>
              ))}
            </div>

            <div className="space-y-5">
              <GlassCard className="p-5 h-fit">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck className="w-5 h-5 text-sage-700" />
                  <h2 className="font-display text-xl text-dusk-500">{t('Estado enterprise')}</h2>
                </div>
                {status ? (
                  <div className="space-y-2">
                    <StatusPill label={t('Acesso privado')} ok={status.private_access.configured} />
                    <StatusPill label={t('Email')} ok={status.email.configured} />
                    <StatusPill label={t('Google login')} ok={status.google_login.configured} />
                    <StatusPill label={t('WhatsApp')} ok={status.whatsapp.configured} />
                    <StatusPill label={t('Uploads R2')} ok={status.uploads.configured} />
                    <StatusPill label={t('IA')} ok={status.ai.configured} />
                    <StatusPill label={t('Backups')} ok={status.backups.configured} />
                    <StatusPill label={t('Sentry/PostHog')} ok={status.observability.sentry_configured && status.observability.posthog_configured} />
                  </div>
                ) : (
                  <div className="text-sm text-dusk-300">{t('Carregando...')}</div>
                )}
              </GlassCard>

              {permissionReview && (
                <GlassCard className="p-5 h-fit">
                  <div className="flex items-center gap-2 mb-2">
                    <LockKeyhole className="w-5 h-5 text-sage-700" />
                    <h2 className="font-display text-xl text-dusk-500">{t('Revisão de permissões')}</h2>
                  </div>
                  <p className="text-sm text-dusk-300 mb-4">
                    {t('Confirme que a administradora tem cobertura real por prédio antes de vender ou pilotar.')}
                  </p>
                  <div className="space-y-2">
                    <StatusPill label={t('Admins da administradora')} ok={permissionReview.agency_admins >= 2} />
                    <StatusPill label={t('Convites de equipe')} ok={permissionReview.failed_invite_emails === 0 && permissionReview.expired_invites === 0} />
                    <StatusPill label={t('Cobertura por prédio')} ok={permissionReview.buildings_without_direct_staff.length === 0} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Equipe')}</div>
                      <div className="font-display text-2xl text-dusk-500">{permissionReview.total_staff}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Escopo definido')}</div>
                      <div className="font-display text-2xl text-dusk-500">{permissionReview.scoped_staff}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Pendentes')}</div>
                      <div className="font-display text-2xl text-dusk-500">{permissionReview.pending_invites}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Falhas')}</div>
                      <div className={`font-display text-2xl ${permissionReview.failed_invite_emails > 0 ? 'text-peach-600' : 'text-dusk-500'}`}>
                        {permissionReview.failed_invite_emails}
                      </div>
                    </div>
                  </div>
                  {permissionReview.agency_admins < 2 && (
                    <div className="mt-4 rounded-2xl border border-peach-200 bg-peach-100/60 px-3 py-3 text-sm text-peach-700">
                      {t('Somente um administrador da agência. Adicione outro antes de pilotos reais.')}
                    </div>
                  )}
                  {permissionReview.buildings_without_direct_staff.length > 0 ? (
                    <div className="mt-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-dusk-300 mb-2">{t('Sem responsável direto')}</div>
                      <div className="space-y-1">
                        {permissionReview.buildings_without_direct_staff.slice(0, 4).map((building) => (
                          <div key={building.id} className="text-sm text-dusk-400 truncate" data-user-content>{building.name}</div>
                        ))}
                        {permissionReview.buildings_without_direct_staff.length > 4 && (
                          <div className="text-xs text-dusk-300">
                            +{permissionReview.buildings_without_direct_staff.length - 4} {t('mais')}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 text-sm text-sage-700">
                      {t('Todos os prédios têm pelo menos uma pessoa responsável.')}
                    </div>
                  )}
                  {permissionReview.expired_invites > 0 && (
                    <div className="mt-3 text-xs text-dusk-300">
                      {permissionReview.expired_invites} {t('convites expirados')}
                    </div>
                  )}
                </GlassCard>
              )}

              <GlassCard className="p-5 h-fit">
                <div className="flex items-center gap-2 mb-2">
                  <FileArchive className="w-5 h-5 text-sage-700" />
                  <h2 className="font-display text-xl text-dusk-500">{t('Exportações operacionais')}</h2>
                </div>
                <p className="text-sm text-dusk-300 mb-4">
                  {t('Baixe dados do portfólio respeitando os prédios permitidos para sua função.')}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button variant="ghost" onClick={downloadPortfolioCsv} leftIcon={<Download className="w-4 h-4" />}>
                    {t('Resumo do portfólio')}
                  </Button>
                  {operationalExports.map((item) => (
                    <Button key={item.kind} variant="ghost" onClick={() => downloadOperationalCsv(item.kind)} leftIcon={<Download className="w-4 h-4" />}>
                      {t(item.label)}
                    </Button>
                  ))}
                </div>
              </GlassCard>

              <GlassCard className="p-5 h-fit">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-5 h-5 text-sage-700" />
                  <h2 className="font-display text-xl text-dusk-500">{t('Auditoria recente')}</h2>
                </div>
                <p className="text-sm text-dusk-300 mb-4">
                  {t('Últimas ações sensíveis visíveis para sua administradora e seus prédios permitidos.')}
                </p>
                {auditEventsLoading ? (
                  <div className="text-sm text-dusk-300">{t('Carregando...')}</div>
                ) : auditEvents.length === 0 ? (
                  <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-3 text-sm text-dusk-300">
                    {t('Nenhum evento de auditoria ainda.')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auditEvents.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-white/70 bg-white/55 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-dusk-500 truncate">{event.action}</div>
                            <div className="text-xs text-dusk-300 truncate" data-user-content>
                              {event.actor_email || t('Sistema')} · {event.condominium_name || t('Administradora')}
                            </div>
                            {auditEventTarget(event) && (
                              <div className="text-xs text-dusk-300 mt-1 truncate">{auditEventTarget(event)}</div>
                            )}
                          </div>
                          <Badge tone="neutral">{formatDate(event.created_at)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>

              {primaryAgency.role === 'agency_admin' && (
                <GlassCard className="p-5 h-fit">
                  <div className="flex items-center gap-2 mb-2">
                    <KeyRound className="w-5 h-5 text-sage-700" />
                    <h2 className="font-display text-xl text-dusk-500">{t('Códigos privados')}</h2>
                  </div>
                  <p className="text-sm text-dusk-300 mb-4">
                    {t('Emita códigos para ativar novos prédios vendidos pela administradora. O código completo aparece apenas uma vez.')}
                  </p>

                  {createdCode && (
                    <div className="rounded-2xl border border-sage-200 bg-sage-100/70 p-3 mb-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-sage-700">{t('Código criado')}</div>
                      <div className="font-mono text-sm text-dusk-500 break-all mt-1">{createdCode}</div>
                      <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={copyCreatedCode} leftIcon={<Copy className="w-4 h-4" />}>
                        {copiedCode ? t('Copiado') : t('Copiar código')}
                      </Button>
                    </div>
                  )}

                  {setupCodeError && (
                    <div className="rounded-2xl bg-peach-100/70 border border-peach-200 text-sm text-peach-600 px-3 py-2 mb-4">
                      {setupCodeError}
                    </div>
                  )}

                  <form onSubmit={createCode} className="space-y-3">
                    <label className="block">
                      <span className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Rótulo')}</span>
                      <input
                        value={form.label}
                        onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                        placeholder={t('Ex: piloto Edifício Jardins')}
                        className="mt-1 w-full rounded-2xl bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Usos')}</span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={form.max_uses}
                          onChange={(event) => setForm((prev) => ({ ...prev, max_uses: event.target.value }))}
                          className="mt-1 w-full rounded-2xl bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Vence em')}</span>
                        <input
                          type="datetime-local"
                          value={form.expires_at}
                          onChange={(event) => setForm((prev) => ({ ...prev, expires_at: event.target.value }))}
                          className="mt-1 w-full rounded-2xl bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
                        />
                      </label>
                    </div>
                    <Button type="submit" variant="sage" className="w-full" loading={creatingCode} leftIcon={<PlusCircle className="w-4 h-4" />}>
                      {t('Criar código')}
                    </Button>
                  </form>

                  <div className="mt-5 space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Códigos emitidos')}</div>
                    {setupCodesLoading ? (
                      <div className="text-sm text-dusk-300">{t('Carregando...')}</div>
                    ) : setupCodes.length === 0 ? (
                      <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-3 text-sm text-dusk-300">
                        {t('Nenhum código privado emitido ainda.')}
                      </div>
                    ) : (
                      setupCodes.map((setupCode) => (
                        <div key={setupCode.id} className="rounded-2xl border border-white/70 bg-white/55 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-dusk-500 truncate" data-user-content>
                                {setupCode.label || t('Código privado')}
                              </div>
                              <div className="text-xs text-dusk-300 mt-1">
                                {setupCode.used_count}/{setupCode.max_uses} {t('usos')} · {t('Vence')} {formatDate(setupCode.expires_at)}
                              </div>
                              <div className="text-xs text-dusk-300 mt-1">
                                {setupCode.activation_count > 0
                                  ? (
                                    <>
                                      {t('Ativou')} <span data-user-content>{setupCode.last_activated_condominium_name || t('prédio')}</span>
                                      {setupCode.last_activated_by_email && <> · <span data-user-content>{setupCode.last_activated_by_email}</span></>}
                                      {setupCode.last_activated_at && <> · {formatDate(setupCode.last_activated_at)}</>}
                                    </>
                                  )
                                  : t('Ainda não ativou nenhum prédio.')}
                              </div>
                            </div>
                            <Badge tone={codeTone(setupCode.status)}>{codeStatusLabel(setupCode.status)}</Badge>
                          </div>
                          {setupCode.status === 'active' && (
                            <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => disableCode(setupCode.id)} leftIcon={<Ban className="w-4 h-4" />}>
                              {t('Desativar')}
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </GlassCard>
              )}

              {primaryAgency.role === 'agency_admin' && (
                <GlassCard className="p-5 h-fit">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="w-5 h-5 text-sage-700" />
                    <h2 className="font-display text-xl text-dusk-500">{t('Equipe da administradora')}</h2>
                  </div>
                  <p className="text-sm text-dusk-300 mb-4">
                    {t('Adicione uma conta existente ou envie convite por email. Cada pessoa vê somente os prédios permitidos para sua função.')}
                  </p>

                  {createdStaffInvite?.token && (
                    <div className="rounded-2xl border border-sage-200 bg-sage-100/70 p-3 mb-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-sage-700">{t('Convite enviado')}</div>
                      <div className="text-sm text-dusk-400 mt-1" data-user-content>
                        {createdStaffInvite.email}
                      </div>
                      <div className="text-xs text-dusk-300 mt-1">
                        {t('Se o email não chegar, copie este link privado e envie manualmente. Ele aparece apenas agora.')}
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={copyStaffInviteLink} leftIcon={<Copy className="w-4 h-4" />}>
                        {copiedStaffInvite ? t('Copiado') : t('Copiar link do convite')}
                      </Button>
                    </div>
                  )}

                  {staffError && (
                    <div className="rounded-2xl bg-peach-100/70 border border-peach-200 text-sm text-peach-600 px-3 py-2 mb-4">
                      {staffError}
                    </div>
                  )}

                  <form onSubmit={saveStaff} className="space-y-3">
                    <label className="block">
                      <span className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Email da equipe')}</span>
                      <input
                        type="email"
                        value={staffForm.email}
                        onChange={(event) => setStaffForm((prev) => ({ ...prev, email: event.target.value }))}
                        placeholder="maria@empresa.com"
                        className="mt-1 w-full rounded-2xl bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Função')}</span>
                      <select
                        value={staffForm.role}
                        onChange={(event) => setStaffForm((prev) => ({ ...prev, role: event.target.value as AgencyRole }))}
                        className="mt-1 w-full rounded-2xl bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
                      >
                        {agencyRoles.map((role) => (
                          <option key={role} value={role}>{agencyRoleLabel(role)}</option>
                        ))}
                      </select>
                    </label>
                    {staffForm.role !== 'agency_admin' && (
                      <div>
                        <div className="text-xs uppercase tracking-[0.12em] text-dusk-300 mb-2">{t('Prédios permitidos')}</div>
                        <div className="space-y-2 max-h-44 overflow-auto pr-1">
                          {primaryAgency.buildings.map((building) => (
                            <label key={building.id} className="flex items-center gap-2 rounded-2xl bg-white/55 border border-white/70 px-3 py-2 text-sm text-dusk-400">
                              <input
                                type="checkbox"
                                checked={staffForm.building_ids.includes(building.id)}
                                onChange={() => toggleStaffBuilding(building.id)}
                              />
                              <span className="truncate" data-user-content>{building.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <Button type="submit" variant="sage" className="w-full" loading={staffSaving} leftIcon={<UserPlus className="w-4 h-4" />}>
                      {t('Adicionar ou convidar')}
                    </Button>
                  </form>

                  <div className="mt-5 space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Convites pendentes')}</div>
                    {staffLoading ? (
                      <div className="text-sm text-dusk-300">{t('Carregando...')}</div>
                    ) : staffInvites.filter((invite) => invite.status === 'pending').length === 0 ? (
                      <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-3 text-sm text-dusk-300">
                        {t('Nenhum convite pendente.')}
                      </div>
                    ) : (
                      staffInvites.filter((invite) => invite.status === 'pending').map((invite) => (
                        <div key={invite.id} className="rounded-2xl border border-white/70 bg-white/55 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-dusk-500 truncate" data-user-content>{invite.email}</div>
                              <div className="text-xs text-dusk-300 mt-1">
                                {invite.role === 'agency_admin'
                                  ? t('Todos os prédios')
                                  : buildingNames(invite.assigned_building_ids) || t('Sem prédios')}
                              </div>
                              <div className="text-xs text-dusk-300 mt-1">
                                {t('Vence')} {formatDate(invite.expires_at)} · {t('Email')} {t(invite.email_status || 'pendente')}
                              </div>
                            </div>
                            <Badge tone="warning">{agencyRoleLabel(invite.role)}</Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-5 space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-dusk-300">{t('Membros')}</div>
                    {staffLoading ? (
                      <div className="text-sm text-dusk-300">{t('Carregando...')}</div>
                    ) : staff.length === 0 ? (
                      <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-3 text-sm text-dusk-300">
                        {t('Nenhum membro de equipe vinculado ainda.')}
                      </div>
                    ) : (
                      staff.map((member) => (
                        <div key={member.id} className="rounded-2xl border border-white/70 bg-white/55 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-dusk-500 truncate" data-user-content>
                                {member.first_name} {member.last_name}
                              </div>
                              <div className="text-xs text-dusk-300 truncate" data-user-content>{member.email}</div>
                              <div className="text-xs text-dusk-300 mt-1">
                                {member.role === 'agency_admin'
                                  ? t('Todos os prédios')
                                  : buildingNames(member.assigned_building_ids) || t('Sem prédios')}
                              </div>
                            </div>
                            <Badge tone={member.role === 'agency_admin' ? 'sage' : 'neutral'}>
                              {agencyRoleLabel(member.role)}
                            </Badge>
                          </div>
                          {member.role !== 'agency_admin' && (
                            <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => removeStaffMember(member.id)} leftIcon={<Trash2 className="w-4 h-4" />}>
                              {t('Remover')}
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </GlassCard>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
