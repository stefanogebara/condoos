import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  Package,
  ReceiptText,
  Waves,
  Vote,
  ArrowRight,
  Sparkles,
  Megaphone,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet, apiPost } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, t } from '../../lib/i18n';

interface Pkg { id: number; carrier: string; description: string; status: string; arrived_at: string; }
interface Visitor { id: number; visitor_name: string; visitor_type: string; status: string; expected_at: string; }
interface Reservation { id: number; amenity_name: string; starts_at: string; }
interface Proposal { id: number; title: string; status: string; votes: { yes: number; no: number; abstain: number; total: number }; }
interface Announcement { id: number; title: string; body: string; created_at: string; source: string; }
interface DashboardQuickAction { label: string; path: string; body?: Record<string, unknown>; success_label?: string; }
interface DashboardAction {
  id: string;
  source: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  detail: string;
  href: string;
  cta: string;
  icon: string;
  quick_actions?: DashboardQuickAction[];
}
interface DashboardPayload {
  actions: DashboardAction[];
  unread_count: number;
}

const PROPOSAL_STATUS: Record<string, string> = {
  discussion: 'em discussão',
  voting: 'em votação',
  approved: 'aprovada',
  rejected: 'reprovada',
  completed: 'concluída',
  inconclusive: 'inconclusiva',
};

const ACTION_ICONS: Record<string, any> = {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  Package,
  ReceiptText,
  Vote,
};

export default function Overview() {
  const { user } = useAuth();
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const loadDashboard = () => apiGet<DashboardPayload>('/dashboard/actions').then((next) => {
      if (alive) setDashboard(next);
    });
    const loads = [
      apiGet<Pkg[]>('/packages').then(setPkgs),
      apiGet<Visitor[]>('/visitors').then(setVisitors),
      apiGet<Reservation[]>('/amenities/reservations').then(setReservations),
      apiGet<Proposal[]>('/proposals').then(setProposals),
      apiGet<Announcement[]>('/announcements').then(setAnns),
      loadDashboard(),
    ];
    Promise.allSettled(loads).then((results) => {
      if (!alive) return;
      setLoadError(results.some((r) => r.status === 'rejected')
        ? t('Alguns dados do painel não puderam ser carregados. Atualize ou entre novamente se persistir.')
        : null);
    });
    return () => { alive = false; };
  }, []);

  const waiting = pkgs.filter((p) => p.status === 'waiting');
  const pendingVisitors = visitors.filter((v) => v.status === 'pending' || v.status === 'approved');
  const openProposals = proposals.filter((p) => p.status === 'voting' || p.status === 'discussion');
  const futureReservations = reservations.filter((r) => new Date(r.starts_at) > new Date());
  const actionItems = dashboard?.actions || [];

  async function runQuickAction(action: DashboardAction, quick: DashboardQuickAction) {
    try {
      await apiPost(quick.path, quick.body);
      toast.success(t(quick.success_label || 'Done'));
      const next = await apiGet<DashboardPayload>('/dashboard/actions');
      setDashboard(next);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('Falha'));
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <>
      <PageHeader
        title={<>{t(greeting)}, {user?.first_name}.</>}
        subtitle={t('Aqui está o que está rolando no seu prédio hoje.')}
      />
      {loadError && (
        <GlassCard variant="clay-peach" className="p-4 mb-6 text-sm text-dusk-500">
          {loadError}
        </GlassCard>
      )}

      <GlassCard variant="clay-sage" className="p-5 mb-8">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-xl text-dusk-500">{t('Today in your unit')}</h2>
            <p className="text-sm text-dusk-300 mt-1">{t('Fast actions so you do not have to hunt through menus.')}</p>
          </div>
          {actionItems.length === 0 && (
            <Badge tone="sage"><CheckCircle2 className="w-3 h-3" /> {t('Nothing urgent')}</Badge>
          )}
        </div>
        {actionItems.length === 0 ? (
          <div className="rounded-2xl bg-white/60 border border-white/70 p-4 text-sm text-dusk-300">
            {t('Nothing needs your attention right now.')}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {actionItems.map((item) => {
              const Icon = ACTION_ICONS[item.icon] || AlertTriangle;
              const tone = item.priority === 'urgent' || item.priority === 'high'
                ? 'warning'
                : item.priority === 'normal'
                  ? 'peach'
                  : 'sage';
              return (
                <div key={item.id} className="rounded-2xl bg-white/60 border border-white/70 p-4 transition">
                  <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                    tone === 'sage' ? 'bg-sage-200 text-sage-700' : tone === 'warning' ? 'bg-peach-100 text-peach-600' : 'bg-peach-100 text-peach-500'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-dusk-500 truncate">{t(item.title)}</div>
                    <div className="text-xs text-dusk-300 mt-0.5 truncate">{t(item.detail)}</div>
                  </div>
                  <Link to={item.href} className="text-xs font-semibold text-dusk-400 shrink-0 inline-flex items-center gap-1 hover:text-dusk-500">
                    {t(item.cta)} <ArrowRight className="w-3 h-3" />
                  </Link>
                  </div>
                  {item.quick_actions && item.quick_actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.quick_actions.map((quick) => (
                        <Button
                          key={quick.label}
                          type="button"
                          size="sm"
                          variant={quick.label === 'Reject' ? 'ghost' : 'primary'}
                          onClick={() => runQuickAction(item, quick)}
                        >
                          {t(quick.label)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Top stats — 2-up on mobile so the 4 cards don't eat half the
          viewport before showing actual content (audit M15). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        <StatCard icon={Package}  color="sage"  label="Encomendas aguardando" value={waiting.length}          to="/app/packages" />
        <StatCard icon={DoorOpen} color="peach" label="Próximas visitas"      value={pendingVisitors.length}  to="/app/visitors" />
        <StatCard icon={Waves}    color="sage"  label="Suas reservas"         value={futureReservations.length} to="/app/amenities" />
        <StatCard icon={Vote}     color="peach" label="Propostas abertas"     value={openProposals.length}    to="/app/proposals" />
      </div>

      {/* Hero clay building panel */}
      <GlassCard variant="clay-sage" className="p-8 mb-8 relative overflow-hidden">
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div>
            <Badge tone="dark" className="mb-3">Pine Ridge Towers</Badge>
            <h2 className="font-display text-3xl text-dusk-500 leading-tight">{t('Seu prédio, num panorama.')}</h2>
            <p className="mt-3 text-dusk-300 max-w-md">{t('Um toque para retirar uma encomenda, aprovar uma visita, reservar a piscina ou opinar numa proposta.')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/app/suggest"><Button variant="primary" size="sm" leftIcon={<Sparkles className="w-4 h-4" />}>{t('Sugerir algo')}</Button></Link>
              <Link to="/app/amenities"><Button variant="ghost" size="sm">{t('Reservar área comum')}</Button></Link>
            </div>
          </div>
          <div className="flex justify-center">
            <img src="/images/hero-clay-building.jpg" alt="" className="max-h-52 object-contain animate-float-slow drop-shadow-xl" />
          </div>
        </div>
      </GlassCard>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Latest announcements */}
        <div className="lg:col-span-2 space-y-4">
          <SectionHeader title="Últimos comunicados" link="/app/announcements" />
          {anns.slice(0, 3).map((a) => (
            <GlassCard key={a.id} className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 data-user-content className="font-semibold text-dusk-500">{t(a.title)}</h3>
                    {a.source !== 'manual' && <Badge tone="sage">{t('Redigido pela IA')}</Badge>}
                  </div>
                  <p data-user-content className="text-sm text-dusk-300 mt-1 line-clamp-2">{t(a.body)}</p>
                  <div className="text-xs text-dusk-200 mt-2">{formatDate(a.created_at)}</div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>

        {/* Hot proposals */}
        <div className="space-y-4">
          <SectionHeader title="Em votação" link="/app/proposals" />
          {openProposals.slice(0, 3).map((p) => (
            <Link key={p.id} to={`/app/proposals/${p.id}`}>
              <GlassCard variant="clay" hover className="p-5">
                <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{t(PROPOSAL_STATUS[p.status] || p.status)}</Badge>
                <h3 data-user-content className="font-semibold text-dusk-500 mt-2 line-clamp-2">{t(p.title)}</h3>
                {p.status === 'voting' && (
                  <div className="mt-3 flex items-center gap-1 text-xs">
                    <div className="flex-1 h-1.5 rounded-full bg-white/60 overflow-hidden flex">
                      <div className="h-full bg-sage-400" style={{ width: `${p.votes.total ? (p.votes.yes / p.votes.total) * 100 : 0}%` }} />
                      <div className="h-full bg-peach-400" style={{ width: `${p.votes.total ? (p.votes.no / p.votes.total) * 100 : 0}%` }} />
                    </div>
                    <span className="text-dusk-200">{p.votes.yes}–{p.votes.no}</span>
                  </div>
                )}
              </GlassCard>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

function StatCard({ icon: Icon, color, label, value, to }: { icon: any; color: 'sage' | 'peach'; label: string; value: number; to: string }) {
  return (
    <Link to={to}>
      <GlassCard variant="clay" hover className="p-5 h-full">
        <div className="flex items-start justify-between">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <ArrowRight className="w-4 h-4 text-dusk-200" />
        </div>
        <div className="mt-4 font-display text-3xl text-dusk-500">{value}</div>
        <div className="text-xs text-dusk-300 mt-0.5">{t(label)}</div>
      </GlassCard>
    </Link>
  );
}

function SectionHeader({ title, link }: { title: string; link: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display text-xl text-dusk-500">{t(title)}</h2>
      <Link to={link} className="text-xs text-dusk-300 hover:text-dusk-500 inline-flex items-center gap-1">
        {t('Ver tudo')} <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
