import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Calendar, CheckCircle2, FileArchive, LockKeyhole, RefreshCw, ShieldCheck, Users, Wallet, Wrench } from 'lucide-react';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet } from '../../lib/api';
import { t } from '../../lib/i18n';

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

interface AgencyPortfolio {
  id: number;
  name: string;
  slug: string;
  role: string;
  totals: AgencyBuildingMetrics;
  buildings: AgencyBuilding[];
}

interface PortfolioResponse {
  agencies: AgencyPortfolio[];
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

export default function BoardAgencyPortfolio() {
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const primaryAgency = portfolio?.agencies[0] || null;
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
        <Button variant="ghost" onClick={load} loading={loading} leftIcon={<RefreshCw className="w-4 h-4" />}>
          {t('Atualizar')}
        </Button>
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
              <Badge tone="neutral">{primaryAgency.role}</Badge>
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
              {primaryAgency.buildings.map((building) => (
                <GlassCard key={building.id} className="p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h3 className="font-display text-xl text-dusk-500" data-user-content>{building.name}</h3>
                      <p className="text-sm text-dusk-300 mt-0.5" data-user-content>{building.address}</p>
                    </div>
                    {building.invite_code && <Badge tone="neutral">{t('Código')} {building.invite_code}</Badge>}
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
          </div>
        </>
      )}
    </>
  );
}
