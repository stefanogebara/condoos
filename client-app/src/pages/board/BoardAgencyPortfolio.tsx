import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, BarChart3, Building2, Calendar, CheckCircle2, ClipboardCheck, Copy, Download, FileArchive, FileText, Gauge, KeyRound, ListChecks, LockKeyhole, PlusCircle, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, Wallet, Wrench } from 'lucide-react';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { api, apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatCurrency, formatDateTime, t } from '../../lib/i18n';
import { useAuth, type User } from '../../lib/auth';
import { capabilitiesForAgencyRole, type AgencyBuildingCapability, type AgencyRole } from '../../lib/agencyAccess';

interface AgencyBuildingMetrics {
  pending_residents: number;
  unresolved_tickets: number;
  urgent_tickets: number;
  recurring_problem_clusters: number;
  vendor_follow_up_problems: number;
  overdue_dues: number;
  pending_payment_proofs: number;
  vendor_sla_problems: number;
  proposals_missing_budget: number;
  upcoming_meetings: number;
}

type AgencyRiskFollowupStatus = 'open' | 'in_progress' | 'waiting' | 'done';
type AgencyRiskFollowupFilter = 'all' | 'overdue' | AgencyRiskFollowupStatus;

interface AgencyRiskFollowup {
  id: number;
  agency_id: number;
  condominium_id: number;
  kind: AgencyAttentionKind;
  record_id: string;
  owner_user_id: number | null;
  owner_email: string | null;
  owner_name: string | null;
  status: AgencyRiskFollowupStatus;
  due_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface AgencyRiskFollowupQueueItem extends AgencyRiskFollowup {
  condominium_name: string;
  route: string;
  overdue: boolean;
}

interface AgencyBuilding {
  id: number;
  name: string;
  address: string;
  invite_code: string | null;
  metrics: AgencyBuildingMetrics;
  scorecard: {
    health_score: number;
    risk_level: 'healthy' | 'watch' | 'critical';
    maintenance_score: number;
    finance_score: number;
    community_score: number;
    next_actions: string[];
    drilldowns: Array<{
      kind: AgencyAttentionKind;
      route: string;
      count: number;
      records: Array<{
        id: number | string;
        title: string;
        detail: string | null;
        status: string | null;
        route: string;
        occurred_at: string | null;
        amount_cents?: number | null;
        currency?: string | null;
        follow_up?: AgencyRiskFollowup | null;
      }>;
    }>;
  };
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
  | 'recurring_problem_clusters'
  | 'vendor_follow_up_problems'
  | 'vendor_sla_problems'
  | 'overdue_dues'
  | 'pending_payment_proofs'
  | 'pending_residents'
  | 'proposals_missing_budget';

const ATTENTION_SEVERITY: Record<AgencyAttentionKind, AgencyAttentionItem['severity']> = {
  urgent_tickets: 'critical',
  vendor_sla_problems: 'critical',
  recurring_problem_clusters: 'warning',
  vendor_follow_up_problems: 'warning',
  overdue_dues: 'warning',
  pending_payment_proofs: 'warning',
  pending_residents: 'info',
  proposals_missing_budget: 'info',
};

const RISK_KIND_CAPABILITY: Record<AgencyAttentionKind, AgencyBuildingCapability> = {
  urgent_tickets: 'maintenance',
  recurring_problem_clusters: 'maintenance',
  vendor_follow_up_problems: 'maintenance',
  vendor_sla_problems: 'maintenance',
  overdue_dues: 'finance',
  pending_payment_proofs: 'finance',
  pending_residents: 'building_admin',
  proposals_missing_budget: 'building_admin',
};

interface AgencyAttentionItem {
  id: string;
  kind: AgencyAttentionKind;
  severity: 'critical' | 'warning' | 'info';
  condominium_id: number;
  condominium_name: string;
  count: number;
  route: string;
}

interface AgencyTrendPoint {
  month: string;
  tickets_opened: number;
  tickets_resolved: number;
  work_orders_opened: number;
  work_orders_completed: number;
  maintenance_spend_cents: number;
  maintenance_spend: string;
  overdue_dues: number;
}

type WorkOrderStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

interface AgencyWorkOrderStory {
  id: number;
  condominium_id: number;
  condominium_name: string;
  ticket_id: number;
  ticket_title: string;
  title: string;
  scope: string | null;
  status: WorkOrderStatus;
  vendor_name: string | null;
  estimated_amount_cents: number | null;
  approved_amount_cents: number | null;
  scheduled_for: string | null;
  completed_at: string | null;
  updated_at: string;
  quote_count: number;
  selected_quote_count: number;
  route: string;
}

interface AgencyPortfolio {
  id: number;
  name: string;
  slug: string;
  role: AgencyRole | string;
  capabilities?: AgencyBuildingCapability[];
  totals: AgencyBuildingMetrics;
  permission_review: AgencyPermissionReview | null;
  attention: AgencyAttentionItem[];
  risk_followups?: AgencyRiskFollowupQueueItem[];
  trends: AgencyTrendPoint[];
  work_order_story: AgencyWorkOrderStory[];
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

interface PilotReadinessItem {
  id: string;
  ready: boolean;
  label: string;
  okDetail: string;
  reviewDetail: string;
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

function currentReportMonth() {
  return new Date().toISOString().slice(0, 7);
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

const operationalExports: Array<{ kind: AgencyExportKind; label: string; capability: AgencyBuildingCapability }> = [
  { kind: 'residents', label: 'Moradores', capability: 'building_admin' },
  { kind: 'finance', label: 'Financeiro', capability: 'finance' },
  { kind: 'tickets', label: 'Chamados', capability: 'maintenance' },
  { kind: 'work-orders', label: 'Ordens de serviço', capability: 'maintenance' },
  { kind: 'audit', label: 'Auditoria', capability: 'building_admin' },
];

const followupFilters: Array<{ value: AgencyRiskFollowupFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'overdue', label: 'Atrasados' },
  { value: 'open', label: 'Abertos' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'waiting', label: 'Aguardando' },
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
    recurring_problem_clusters: 'Problemas recorrentes',
    vendor_follow_up_problems: 'Retorno fornecedor',
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

function scoreTone(level: AgencyBuilding['scorecard']['risk_level']) {
  if (level === 'critical') return 'peach' as const;
  if (level === 'watch') return 'warning' as const;
  return 'sage' as const;
}

function scoreLabel(level: AgencyBuilding['scorecard']['risk_level']) {
  const labels: Record<AgencyBuilding['scorecard']['risk_level'], string> = {
    healthy: 'Saudável',
    watch: 'Em observação',
    critical: 'Crítico',
  };
  return t(labels[level]);
}

function workOrderStatusLabel(status: WorkOrderStatus) {
  const labels: Record<WorkOrderStatus, string> = {
    draft: 'rascunho',
    scheduled: 'agendada',
    in_progress: 'em execução',
    completed: 'concluída',
    cancelled: 'cancelada',
  };
  return t(labels[status] || status);
}

function riskFollowupStatusLabel(status: AgencyRiskFollowupStatus) {
  const labels: Record<AgencyRiskFollowupStatus, string> = {
    open: 'Aberto',
    in_progress: 'Em andamento',
    waiting: 'Aguardando',
    done: 'Concluído',
  };
  return t(labels[status] || status);
}

function riskFollowupTone(status: AgencyRiskFollowupStatus) {
  if (status === 'done') return 'sage' as const;
  if (status === 'waiting') return 'warning' as const;
  if (status === 'in_progress') return 'peach' as const;
  return 'neutral' as const;
}

function toDateInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function dateInputToIso(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function monthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
}

function storyAmount(story: AgencyWorkOrderStory) {
  const cents = story.approved_amount_cents ?? story.estimated_amount_cents;
  if (cents == null) return t('Sem valor');
  return formatCurrency(cents / 100);
}

function storyDate(story: AgencyWorkOrderStory) {
  const value = story.completed_at || story.scheduled_for || story.updated_at;
  if (!value) return t('Sem data');
  return formatDateTime(value);
}

function StoryStep({ label, done }: { label: string; done: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
      done ? 'bg-sage-100/70 border-sage-200 text-sage-700' : 'bg-white/45 border-white/70 text-dusk-300'
    }`}>
      {done ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-dusk-200" />}
      {t(label)}
    </span>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.1em] text-dusk-300">
        <span>{t(label)}</span>
        <span className="font-semibold text-dusk-500">{safeValue}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/70 overflow-hidden">
        <div
          className={`h-full rounded-full ${safeValue < 60 ? 'bg-peach-400' : safeValue < 80 ? 'bg-clay-400' : 'bg-sage-500'}`}
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

function DrilldownRecord({
  record,
  staff,
  canSave,
  saving,
  onSave,
}: {
  record: AgencyBuilding['scorecard']['drilldowns'][number]['records'][number];
  staff: AgencyStaffMember[];
  canSave: boolean;
  saving: boolean;
  onSave: (payload: {
    owner_user_id: number | null;
    status: AgencyRiskFollowupStatus;
    due_at: string | null;
    note: string | null;
  }) => Promise<void>;
}) {
  const followup = record.follow_up || null;
  const [expanded, setExpanded] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState(followup?.owner_user_id ? String(followup.owner_user_id) : '');
  const [status, setStatus] = useState<AgencyRiskFollowupStatus>(followup?.status || 'open');
  const [dueDate, setDueDate] = useState(toDateInput(followup?.due_at));
  const [note, setNote] = useState(followup?.note || '');

  useEffect(() => {
    setOwnerUserId(followup?.owner_user_id ? String(followup.owner_user_id) : '');
    setStatus(followup?.status || 'open');
    setDueDate(toDateInput(followup?.due_at));
    setNote(followup?.note || '');
  }, [record.id, followup?.id, followup?.owner_user_id, followup?.status, followup?.due_at, followup?.note]);

  const ownerOptions = useMemo(() => {
    const options = staff.map((member) => ({
      id: member.user_id,
      label: [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email,
      email: member.email,
    }));
    if (followup?.owner_user_id && !options.some((option) => option.id === followup.owner_user_id)) {
      options.push({
        id: followup.owner_user_id,
        label: followup.owner_name || followup.owner_email || t('Responsável atual'),
        email: followup.owner_email || '',
      });
    }
    return options;
  }, [staff, followup?.owner_user_id, followup?.owner_name, followup?.owner_email]);

  const followupSummary = followup
    ? [
      followup.owner_name || followup.owner_email || t('Sem responsável'),
      followup.due_at ? formatDate(followup.due_at) : t('Sem prazo'),
    ].filter(Boolean).join(' · ')
    : t('Sem acompanhamento');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      owner_user_id: ownerUserId ? Number(ownerUserId) : null,
      status,
      due_at: dateInputToIso(dueDate),
      note: note.trim() || null,
    });
    setExpanded(false);
  }

  return (
    <div className="py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-dusk-500 truncate" data-user-content>{record.title}</div>
          <div className="text-xs text-dusk-300 truncate" data-user-content>
            {[record.detail, record.status, record.occurred_at ? formatDateTime(record.occurred_at) : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <Badge tone={riskFollowupTone(followup?.status || 'open')}>
              {followup ? riskFollowupStatusLabel(followup.status) : t('Sem acompanhamento')}
            </Badge>
            <span className="text-[11px] text-dusk-300 truncate" data-user-content>{followupSummary}</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {record.amount_cents != null && (
            <span className="text-xs font-semibold text-dusk-400">
              {record.currency || ''} {(record.amount_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          {canSave && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
              {followup ? t('Editar') : t('Acompanhar')}
            </Button>
          )}
        </div>
      </div>

      {expanded && canSave && (
        <form onSubmit={submit} className="mt-3 rounded-2xl border border-white/70 bg-white/55 p-3 space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.12em] text-dusk-300">{t('Estado')}</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as AgencyRiskFollowupStatus)}
                className="mt-1 w-full rounded-2xl bg-white/70 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
              >
                {(['open', 'in_progress', 'waiting', 'done'] as AgencyRiskFollowupStatus[]).map((item) => (
                  <option key={item} value={item}>{riskFollowupStatusLabel(item)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.12em] text-dusk-300">{t('Responsável')}</span>
              <select
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
                disabled={ownerOptions.length === 0}
                className="mt-1 w-full rounded-2xl bg-white/70 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none disabled:opacity-60"
              >
                <option value="">{t('Sem responsável')}</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}{owner.email && owner.label !== owner.email ? ` · ${owner.email}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.12em] text-dusk-300">{t('Prazo')}</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="mt-1 w-full rounded-2xl bg-white/70 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-dusk-300">{t('Nota')}</span>
            <textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('Próximo passo, ligação ou decisão esperada')}
              className="mt-1 w-full rounded-2xl bg-white/70 border border-white/70 px-3 py-2 text-sm text-dusk-500 outline-none resize-none"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              {t('Cancelar')}
            </Button>
            <Button type="submit" variant="sage" size="sm" loading={saving}>
              {t('Salvar acompanhamento')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function buildPilotReadiness(
  agency: AgencyPortfolio | null,
  status: IntegrationStatus | null,
  permissionReview: AgencyPermissionReview | null,
): PilotReadinessItem[] {
  if (!agency) return [];
  const hasCriticalOps = agency.totals.urgent_tickets > 0
    || agency.totals.vendor_sla_problems > 0
    || agency.totals.vendor_follow_up_problems > 0;
  const items: PilotReadinessItem[] = [
    {
      id: 'private-access',
      ready: !!status?.private_access.required && !!status.private_access.configured,
      label: 'Acesso privado obrigatório',
      okDetail: 'Novos prédios só entram com código aprovado.',
      reviewDetail: 'Ative PRIVATE_CREATE_BUILDING_REQUIRED e emita códigos.',
    },
    {
      id: 'email',
      ready: !!status?.email.configured,
      label: 'Email transacional',
      okDetail: 'Convites e resets podem sair por email.',
      reviewDetail: 'Configure Resend e EMAIL_FROM antes do piloto.',
    },
    {
      id: 'uploads',
      ready: !!status?.uploads.configured,
      label: 'Uploads e documentos',
      okDetail: 'R2 está pronto para documentos, recibos e evidências.',
      reviewDetail: 'Configure R2 para não depender de armazenamento local.',
    },
    {
      id: 'backups',
      ready: !!status?.backups.configured,
      label: 'Backups',
      okDetail: 'Backups estão configurados.',
      reviewDetail: 'Configure backup antes de usar dados reais.',
    },
    {
      id: 'observability',
      ready: !!status?.observability.sentry_configured && !!status.observability.posthog_configured,
      label: 'Observabilidade',
      okDetail: 'Sentry/PostHog estão configurados.',
      reviewDetail: 'Configure erro e analytics para pilotos.',
    },
    {
      id: 'critical-ops',
      ready: !hasCriticalOps,
      label: 'Fila crítica',
      okDetail: 'Sem chamados urgentes, retorno parado ou SLA crítico no portfólio.',
      reviewDetail: 'Resolva chamados urgentes, retornos parados ou SLA de fornecedor antes da demo.',
    },
  ];

  if (permissionReview) {
    items.push(
      {
        id: 'agency-admins',
        ready: permissionReview.agency_admins >= 2,
        label: 'Dois admins da administradora',
        okDetail: 'Há redundância de administradores.',
        reviewDetail: 'Adicione pelo menos outro admin da administradora.',
      },
      {
        id: 'building-coverage',
        ready: permissionReview.buildings_without_direct_staff.length === 0,
        label: 'Cobertura por prédio',
        okDetail: 'Todo prédio tem responsável direto.',
        reviewDetail: 'Atribua um responsável direto a cada prédio.',
      },
    );
  }

  return items;
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
  const [followupSavingKey, setFollowupSavingKey] = useState<string | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [followupFilter, setFollowupFilter] = useState<AgencyRiskFollowupFilter>('all');
  const [followupBuildingFilter, setFollowupBuildingFilter] = useState('all');
  const [bulkFollowupSaving, setBulkFollowupSaving] = useState(false);
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
      const nextPortfolio = await apiGet<PortfolioResponse>('/agencies/portfolio');
      setPortfolio(nextPortfolio);
      setSelectedAgencyId((current) => {
        if (current && nextPortfolio.agencies.some((agency) => agency.id === current)) return current;
        return nextPortfolio.agencies[0]?.id || null;
      });
      apiGet<IntegrationStatus>('/admin/integrations/status')
        .then(setStatus)
        .catch(() => setStatus(null));
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
    recurring_problem_clusters: 0,
    vendor_follow_up_problems: 0,
    overdue_dues: 0,
    pending_payment_proofs: 0,
    vendor_sla_problems: 0,
    proposals_missing_budget: 0,
    upcoming_meetings: 0,
  }, [primaryAgency]);
  const permissionReview = primaryAgency?.permission_review || null;
  const agencyCapabilitySet = useMemo(() => {
    if (!primaryAgency) return new Set<AgencyBuildingCapability>();
    const capabilities = primaryAgency.capabilities?.length
      ? primaryAgency.capabilities
      : capabilitiesForAgencyRole(primaryAgency.role);
    return new Set(capabilities);
  }, [primaryAgency]);
  const canExportReports = agencyCapabilitySet.has('reports');
  const visibleOperationalExports = useMemo(
    () => operationalExports.filter((item) => agencyCapabilitySet.has(item.capability)),
    [agencyCapabilitySet],
  );
  const canReviewEnterprise = !!primaryAgency?.capabilities?.includes('building_admin')
    || primaryAgency?.role === 'agency_admin'
    || primaryAgency?.role === 'building_admin';
  const pilotReadiness = useMemo(
    () => buildPilotReadiness(primaryAgency, status, permissionReview),
    [primaryAgency, status, permissionReview],
  );
  const pilotReadinessReady = pilotReadiness.filter((item) => item.ready).length;
  const followupQueue = primaryAgency?.risk_followups || [];
  const filteredFollowups = useMemo(() => followupQueue.filter((item) => {
    if (followupBuildingFilter !== 'all' && String(item.condominium_id) !== followupBuildingFilter) return false;
    if (followupFilter === 'all') return true;
    if (followupFilter === 'overdue') return item.overdue;
    return item.status === followupFilter;
  }), [followupQueue, followupBuildingFilter, followupFilter]);
  const trendMax = useMemo(() => Math.max(
    1,
    ...((primaryAgency?.trends || []).flatMap((point) => [
      point.tickets_opened,
      point.tickets_resolved,
      point.work_orders_opened,
      point.work_orders_completed,
    ])),
  ), [primaryAgency?.trends]);
  const spendMax = useMemo(() => Math.max(
    1,
    ...((primaryAgency?.trends || []).map((point) => point.maintenance_spend_cents)),
  ), [primaryAgency?.trends]);

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

  useEffect(() => {
    setFollowupFilter('all');
    setFollowupBuildingFilter('all');
  }, [primaryAgency?.id]);

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

  async function downloadFile(path: string, filename: string, fallbackType = 'text/csv;charset=utf-8') {
    const response = await api.get(path, { responseType: 'blob' });
    const blob = response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: fallbackType });
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
    await downloadFile(
      `/agencies/${primaryAgency.id}/export/portfolio.csv`,
      `condoos-${primaryAgency.slug}-portfolio.csv`,
    );
    await loadAuditEvents(primaryAgency.id);
  }

  async function downloadOperationalCsv(kind: AgencyExportKind) {
    if (!primaryAgency) return;
    await downloadFile(
      `/agencies/${primaryAgency.id}/export/${kind}.csv`,
      `condoos-${primaryAgency.slug}-${kind}.csv`,
    );
    await loadAuditEvents(primaryAgency.id);
  }

  async function downloadAgencyReport() {
    if (!primaryAgency) return;
    const month = currentReportMonth();
    await downloadFile(
      `/agencies/${primaryAgency.id}/report.md?month=${encodeURIComponent(month)}`,
      `condoos-${primaryAgency.slug}-${month}-agency-report.md`,
      'text/markdown;charset=utf-8',
    );
    await loadAuditEvents(primaryAgency.id);
  }

  async function downloadAgencyReportPdf() {
    if (!primaryAgency) return;
    const month = currentReportMonth();
    await downloadFile(
      `/agencies/${primaryAgency.id}/report.pdf?month=${encodeURIComponent(month)}`,
      `condoos-${primaryAgency.slug}-${month}-agency-report.pdf`,
      'application/pdf',
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

  async function switchActiveBuilding(building: Pick<AgencyBuilding, 'id'>, route = '/board') {
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

  async function saveRiskFollowup(
    buildingId: number,
    kind: AgencyAttentionKind,
    recordId: number | string,
    payload: {
      owner_user_id: number | null;
      status: AgencyRiskFollowupStatus;
      due_at: string | null;
      note: string | null;
    },
  ) {
    if (!primaryAgency) return;
    const key = `${buildingId}:${kind}:${recordId}`;
    setFollowupSavingKey(key);
    setFollowupError(null);
    try {
      await apiPost<{ follow_up: AgencyRiskFollowup }>(`/agencies/${primaryAgency.id}/risk-followups`, {
        condominium_id: buildingId,
        kind,
        record_id: String(recordId),
        owner_user_id: payload.owner_user_id,
        status: payload.status,
        due_at: payload.due_at,
        note: payload.note,
      });
      await load();
      await loadAuditEvents(primaryAgency.id);
    } catch {
      setFollowupError(t('Não foi possível salvar o acompanhamento.'));
    } finally {
      setFollowupSavingKey(null);
    }
  }

  async function markFilteredFollowupsDone() {
    if (!primaryAgency || filteredFollowups.length === 0) return;
    setBulkFollowupSaving(true);
    setFollowupError(null);
    try {
      await Promise.all(filteredFollowups.map((item) => apiPost<{ follow_up: AgencyRiskFollowup }>(`/agencies/${primaryAgency.id}/risk-followups`, {
        condominium_id: item.condominium_id,
        kind: item.kind,
        record_id: item.record_id,
        owner_user_id: item.owner_user_id,
        status: 'done',
        due_at: item.due_at,
        note: item.note,
      })));
      await load();
      await loadAuditEvents(primaryAgency.id);
    } catch {
      setFollowupError(t('Não foi possível concluir os acompanhamentos filtrados.'));
    } finally {
      setBulkFollowupSaving(false);
    }
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
              <Metric icon={RefreshCw} label={t('Recorrentes')} value={totals.recurring_problem_clusters} urgent />
              <Metric icon={ClipboardCheck} label={t('Retornos')} value={totals.vendor_follow_up_problems} urgent />
              <Metric icon={Wallet} label={t('Cobranças em atraso')} value={totals.overdue_dues} urgent />
              <Metric icon={Wrench} label={t('SLA fornecedor')} value={totals.vendor_sla_problems} urgent />
              <Metric icon={ShieldCheck} label={t('Urgentes')} value={totals.urgent_tickets} urgent />
              <Metric icon={FileArchive} label={t('Comprovantes')} value={totals.pending_payment_proofs} />
              <Metric icon={Wallet} label={t('Propostas sem orçamento')} value={totals.proposals_missing_budget} />
              <Metric icon={Calendar} label={t('Reuniões')} value={totals.upcoming_meetings} />
            </div>
          </GlassCard>

          <div className="grid lg:grid-cols-[1.15fr,0.85fr] gap-5 mb-6">
            <GlassCard className="p-5 overflow-hidden">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-dusk-300 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> {t('Tendência de 6 meses')}
                  </div>
                  <h2 className="font-display text-2xl text-dusk-500 mt-1">{t('Ritmo operacional')}</h2>
                  <p className="text-sm text-dusk-300 mt-1">
                    {t('Visão por mês dos chamados, ordens e gasto de manutenção.')}
                  </p>
                </div>
                <Badge tone="neutral">{primaryAgency.trends?.length || 0} {t('meses')}</Badge>
              </div>
              {(primaryAgency.trends || []).length === 0 ? (
                <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-4 text-sm text-dusk-300">
                  {t('Sem histórico suficiente para tendência.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {(primaryAgency.trends || []).map((point) => (
                    <div key={point.month} className="grid grid-cols-[54px,1fr] items-center gap-3">
                      <div className="text-xs font-medium text-dusk-300 uppercase">{monthLabel(point.month)}</div>
                      <div className="rounded-2xl bg-white/55 border border-white/70 p-2.5">
                        <div className="grid grid-cols-5 gap-2 items-end">
                          {[
                            { label: 'Chamados abertos', value: point.tickets_opened, color: 'bg-peach-300' },
                            { label: 'Resolvidos', value: point.tickets_resolved, color: 'bg-sage-400' },
                            { label: 'Ordens abertas', value: point.work_orders_opened, color: 'bg-dusk-300' },
                            { label: 'Ordens concluídas', value: point.work_orders_completed, color: 'bg-sage-600' },
                            { label: 'Gasto manutenção', value: point.maintenance_spend_cents, color: 'bg-clay-400', spend: true },
                          ].map((bar) => (
                            <div key={bar.label} className="min-w-0">
                              <div className="h-10 flex items-end">
                                <div
                                  className={`w-full rounded-full ${bar.color}`}
                                  style={{ height: `${bar.value > 0 ? Math.max(8, Math.round(((bar.spend ? bar.value / spendMax : bar.value / trendMax) || 0) * 40)) : 3}px` }}
                                  title={`${t(bar.label)}: ${bar.spend ? point.maintenance_spend : bar.value}`}
                                />
                              </div>
                              <div className="text-[10px] text-dusk-300 mt-1 truncate">{t(bar.label)}</div>
                              <div className="text-xs font-semibold text-dusk-500 truncate">
                                {bar.spend ? point.maintenance_spend : bar.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard className="p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-dusk-300 flex items-center gap-2">
                    <ListChecks className="w-4 h-4" /> {t('História de obra')}
                  </div>
                  <h2 className="font-display text-2xl text-dusk-500 mt-1">{t('Chamado até conclusão')}</h2>
                  <p className="text-sm text-dusk-300 mt-1">
                    {t('Mostra o caminho que uma administradora consegue explicar: chamado, cotação, agendamento e fechamento.')}
                  </p>
                </div>
              </div>
              {(primaryAgency.work_order_story || []).length === 0 ? (
                <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-4 text-sm text-dusk-300">
                  {t('Nenhuma ordem de serviço ainda.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {(primaryAgency.work_order_story || []).map((story) => (
                    <div key={story.id} className="rounded-3xl border border-white/70 bg-white/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone={story.status === 'completed' ? 'sage' : story.status === 'cancelled' ? 'warning' : 'peach'}>
                              {workOrderStatusLabel(story.status)}
                            </Badge>
                            <span className="text-xs text-dusk-300" data-user-content>{story.condominium_name}</span>
                          </div>
                          <h3 className="font-semibold text-dusk-500 mt-2 truncate" data-user-content>{story.title}</h3>
                          <p className="text-xs text-dusk-300 mt-1 truncate" data-user-content>{story.ticket_title}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => switchActiveBuilding({ id: story.condominium_id }, story.route)}
                          loading={switchingBuildingId === story.condominium_id}
                        >
                          {t('Abrir chamados')}
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <StoryStep label="Chamado aberto" done />
                        <StoryStep label="Fornecedor definido" done={!!story.vendor_name || story.quote_count > 0} />
                        <StoryStep label="Ordem agendada" done={!!story.scheduled_for || story.status === 'in_progress' || story.status === 'completed'} />
                        <StoryStep label="Comprovado" done={story.status === 'completed'} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-dusk-300">
                        <div className="rounded-2xl bg-white/55 px-2.5 py-2">
                          <div className="uppercase tracking-[0.1em] text-[10px]">{t('Fornecedor')}</div>
                          <div className="font-medium text-dusk-500 truncate" data-user-content>{story.vendor_name || t('Sem fornecedor')}</div>
                        </div>
                        <div className="rounded-2xl bg-white/55 px-2.5 py-2">
                          <div className="uppercase tracking-[0.1em] text-[10px]">{t('Valor')}</div>
                          <div className="font-medium text-dusk-500 truncate">{storyAmount(story)}</div>
                        </div>
                        <div className="rounded-2xl bg-white/55 px-2.5 py-2">
                          <div className="uppercase tracking-[0.1em] text-[10px]">{t('Quando')}</div>
                          <div className="font-medium text-dusk-500 truncate">{storyDate(story)}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-dusk-300">
                        {story.quote_count} {t(story.quote_count === 1 ? 'cotação' : 'cotações')}
                        {story.selected_quote_count > 0 && ` · ${story.selected_quote_count} ${t('selecionada')}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

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
                  <div className="mt-4 rounded-3xl border border-white/70 bg-white/55 p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-sage-100/80 border border-sage-200 flex items-center justify-center">
                          <Gauge className="w-5 h-5 text-sage-700" />
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.14em] text-dusk-300">{t('Saúde operacional')}</div>
                          <div className="font-display text-3xl text-dusk-500 leading-none mt-1">
                            {building.scorecard.health_score}<span className="text-base text-dusk-300">/100</span>
                          </div>
                        </div>
                      </div>
                      <Badge tone={scoreTone(building.scorecard.risk_level)}>
                        {scoreLabel(building.scorecard.risk_level)}
                      </Badge>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-3 mt-4">
                      <ScoreBar label="Manutenção" value={building.scorecard.maintenance_score} />
                      <ScoreBar label="Financeiro" value={building.scorecard.finance_score} />
                      <ScoreBar label="Comunidade" value={building.scorecard.community_score} />
                    </div>
                    <div className="mt-4">
                      <div className="text-xs uppercase tracking-[0.12em] text-dusk-300 mb-2">{t('Próximas ações')}</div>
                      <div className="space-y-1.5">
                        {building.scorecard.next_actions.slice(0, 3).map((action) => (
                          <div key={action} className="flex items-start gap-2 text-sm text-dusk-400">
                            <CheckCircle2 className="w-4 h-4 text-sage-700 mt-0.5 shrink-0" />
                            <span>{t(action)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {building.scorecard.drilldowns.length > 0 && (
                      <div className="mt-4 border-t border-white/70 pt-4">
                        <div className="text-xs uppercase tracking-[0.12em] text-dusk-300 mb-2">{t('Registros que explicam o risco')}</div>
                        {followupError && (
                          <div className="mb-3 rounded-2xl bg-peach-100/70 border border-peach-200 text-sm text-peach-600 px-3 py-2">
                            {followupError}
                          </div>
                        )}
                        <div className="space-y-3">
                          {building.scorecard.drilldowns.slice(0, 3).map((drilldown) => (
                            <div key={drilldown.kind} className="border-b border-white/60 pb-3 last:border-b-0 last:pb-0">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Badge tone={attentionTone(ATTENTION_SEVERITY[drilldown.kind] || 'info')}>{drilldown.count}</Badge>
                                  <span className="text-sm font-semibold text-dusk-500 truncate">{attentionLabel(drilldown.kind)}</span>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => switchActiveBuilding({ id: building.id }, drilldown.route)}
                                  loading={switchingBuildingId === building.id}
                                >
                                  {t('Abrir lista')}
                                </Button>
                              </div>
                              <div className="mt-1 divide-y divide-white/55">
                                {drilldown.records.length === 0 ? (
                                  <div className="text-sm text-dusk-300 py-2">{t('Sem registros recentes.')}</div>
                                ) : (
                                  drilldown.records.map((record) => (
                                    <DrilldownRecord
                                      key={`${drilldown.kind}:${record.id}`}
                                      record={record}
                                      staff={staff}
                                      canSave={agencyCapabilitySet.has(RISK_KIND_CAPABILITY[drilldown.kind])}
                                      saving={followupSavingKey === `${building.id}:${drilldown.kind}:${record.id}`}
                                      onSave={(payload) => saveRiskFollowup(building.id, drilldown.kind, record.id, payload)}
                                    />
                                  ))
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-4 gap-2 mt-4">
                    <Metric icon={AlertTriangle} label={t('Chamados')} value={building.metrics.unresolved_tickets} urgent />
                    <Metric icon={RefreshCw} label={t('Recorrentes')} value={building.metrics.recurring_problem_clusters} urgent />
                    <Metric icon={ClipboardCheck} label={t('Retornos')} value={building.metrics.vendor_follow_up_problems} urgent />
                    <Metric icon={Wallet} label={t('Atrasos')} value={building.metrics.overdue_dues} urgent />
                    <Metric icon={Users} label={t('Pendentes')} value={building.metrics.pending_residents} />
                    <Metric icon={Wrench} label={t('SLA')} value={building.metrics.vendor_sla_problems} urgent />
                  </div>
                </GlassCard>
              ))}
            </div>

            <div className="space-y-5">
              <GlassCard className="p-5 h-fit">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-sage-700" />
                    <h2 className="font-display text-xl text-dusk-500">{t('Acompanhamentos')}</h2>
                  </div>
                  <Badge tone={followupQueue.some((item) => item.overdue) ? 'warning' : 'sage'}>
                    {filteredFollowups.length}/{followupQueue.length}
                  </Badge>
                </div>
                <p className="text-sm text-dusk-300 mb-4">
                  {t('Riscos com dono e prazo para acompanhar esta semana.')}
                </p>
                {followupQueue.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-1.5 flex-wrap" aria-label={t('Filtrar acompanhamentos por estado')}>
                      {followupFilters.map((filter) => (
                        <button
                          key={filter.value}
                          type="button"
                          onClick={() => setFollowupFilter(filter.value)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            followupFilter === filter.value
                              ? 'bg-dusk-400 text-cream-50 border-dusk-400'
                              : 'bg-white/55 text-dusk-300 border-white/70 hover:bg-white/75'
                          }`}
                        >
                          {t(filter.label)}
                        </button>
                      ))}
                    </div>
                    {primaryAgency.buildings.length > 1 && (
                      <select
                        value={followupBuildingFilter}
                        onChange={(event) => setFollowupBuildingFilter(event.target.value)}
                        className="w-full rounded-2xl bg-white/60 border border-white/70 px-3 py-2 text-sm text-dusk-400 outline-none"
                        aria-label={t('Filtrar acompanhamentos por prédio')}
                      >
                        <option value="all">{t('Todos os prédios')}</option>
                        {primaryAgency.buildings.map((building) => (
                          <option key={building.id} value={building.id}>{building.name}</option>
                        ))}
                      </select>
                    )}
                    {filteredFollowups.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={markFilteredFollowupsDone}
                        loading={bulkFollowupSaving}
                        leftIcon={<CheckCircle2 className="w-4 h-4" />}
                      >
                        {t('Marcar filtrados como concluídos')}
                      </Button>
                    )}
                  </div>
                )}
                {followupQueue.length === 0 ? (
                  <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-4 text-sm text-dusk-300">
                    {t('Sem acompanhamentos abertos.')}
                  </div>
                ) : filteredFollowups.length === 0 ? (
                  <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-4 text-sm text-dusk-300">
                    {t('Nenhum acompanhamento corresponde aos filtros.')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredFollowups.slice(0, 8).map((item) => (
                      <div key={item.id} className="rounded-2xl border border-white/70 bg-white/60 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge tone={item.overdue ? 'warning' : riskFollowupTone(item.status)}>
                                {item.overdue ? t('Atrasado') : riskFollowupStatusLabel(item.status)}
                              </Badge>
                              <span className="font-medium text-dusk-500">{attentionLabel(item.kind)}</span>
                            </div>
                            <div className="text-xs text-dusk-300 mt-1 truncate" data-user-content>
                              {item.condominium_name}
                            </div>
                            <div className="text-xs text-dusk-300 mt-1 truncate" data-user-content>
                              {[item.owner_name || item.owner_email || t('Sem responsável'), item.due_at ? formatDate(item.due_at) : t('Sem prazo')]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                            {item.note && (
                              <div className="text-xs text-dusk-300 mt-1 line-clamp-2" data-user-content>{item.note}</div>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => switchActiveBuilding({ id: item.condominium_id }, item.route)}
                            loading={switchingBuildingId === item.condominium_id}
                          >
                            {t('Ver')}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {filteredFollowups.length > 8 && (
                      <div className="text-xs text-dusk-300 px-1">
                        {t('Mostrando os 8 acompanhamentos mais urgentes. Ajuste os filtros ou exporte o relatório para ver mais.')}
                      </div>
                    )}
                  </div>
                )}
              </GlassCard>

              {canReviewEnterprise && (
                <>
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

                  <GlassCard className="p-5 h-fit">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="w-5 h-5 text-sage-700" />
                        <h2 className="font-display text-xl text-dusk-500">{t('Checklist de piloto privado')}</h2>
                      </div>
                      <Badge tone={pilotReadinessReady === pilotReadiness.length ? 'sage' : 'warning'}>
                        {pilotReadinessReady}/{pilotReadiness.length}
                      </Badge>
                    </div>
                    <p className="text-sm text-dusk-300 mb-4">
                      {t('Use esta lista antes de apresentar para uma administradora real.')}
                    </p>
                    <div className="space-y-2">
                      {pilotReadiness.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-white/70 bg-white/60 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-dusk-500">{t(item.label)}</div>
                              <div className="text-xs text-dusk-300 mt-1">
                                {t(item.ready ? item.okDetail : item.reviewDetail)}
                              </div>
                            </div>
                            <Badge tone={item.ready ? 'sage' : 'warning'}>
                              {item.ready ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                              {item.ready ? t('Pronto') : t('Revisar')}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </>
              )}

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
                  {canExportReports && (
                    <>
                      <Button variant="sage" onClick={downloadAgencyReportPdf} leftIcon={<FileText className="w-4 h-4" />}>
                        {t('Relatório mensal em PDF')}
                      </Button>
                      <Button variant="sage" onClick={downloadAgencyReport} leftIcon={<Download className="w-4 h-4" />}>
                        {t('Relatório mensal da administradora')}
                      </Button>
                      <Button variant="ghost" onClick={downloadPortfolioCsv} leftIcon={<Download className="w-4 h-4" />}>
                        {t('Resumo do portfólio')}
                      </Button>
                    </>
                  )}
                  {visibleOperationalExports.map((item) => (
                    <Button key={item.kind} variant="ghost" onClick={() => downloadOperationalCsv(item.kind)} leftIcon={<Download className="w-4 h-4" />}>
                      {t(item.label)}
                    </Button>
                  ))}
                  {!canExportReports && visibleOperationalExports.length === 0 && (
                    <div className="rounded-2xl border border-white/70 bg-white/50 px-3 py-3 text-sm text-dusk-300">
                      {t('Sua função não tem exportações liberadas.')}
                    </div>
                  )}
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
