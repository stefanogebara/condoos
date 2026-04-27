import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, DoorOpen, Waves, Vote, ArrowRight, Sparkles, Megaphone } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/i18n';

interface Pkg { id: number; carrier: string; description: string; status: string; arrived_at: string; }
interface Visitor { id: number; visitor_name: string; visitor_type: string; status: string; expected_at: string; }
interface Reservation { id: number; amenity_name: string; starts_at: string; }
interface Proposal { id: number; title: string; status: string; votes: { yes: number; no: number; abstain: number; total: number }; }
interface Announcement { id: number; title: string; body: string; created_at: string; source: string; }

export default function Overview() {
  const { user } = useAuth();
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const loads = [
      apiGet<Pkg[]>('/packages').then(setPkgs),
      apiGet<Visitor[]>('/visitors').then(setVisitors),
      apiGet<Reservation[]>('/amenities/reservations').then(setReservations),
      apiGet<Proposal[]>('/proposals').then(setProposals),
      apiGet<Announcement[]>('/announcements').then(setAnns),
    ];
    Promise.allSettled(loads).then((results) => {
      if (!alive) return;
      setLoadError(results.some((r) => r.status === 'rejected')
        ? 'Some dashboard data could not be loaded. Refresh or sign in again if it persists.'
        : null);
    });
    return () => { alive = false; };
  }, []);

  const waiting = pkgs.filter((p) => p.status === 'waiting');
  const pendingVisitors = visitors.filter((v) => v.status === 'pending' || v.status === 'approved');
  const openProposals = proposals.filter((p) => p.status === 'voting' || p.status === 'discussion');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.first_name}.`}
        subtitle="Here's what's happening in your building today."
      />
      {loadError && (
        <GlassCard variant="clay-peach" className="p-4 mb-6 text-sm text-dusk-500">
          {loadError}
        </GlassCard>
      )}

      {/* Top stats */}
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Package}  color="sage"  label="Packages waiting"     value={waiting.length}          to="/app/packages" />
        <StatCard icon={DoorOpen} color="peach" label="Upcoming visitors"    value={pendingVisitors.length}  to="/app/visitors" />
        <StatCard icon={Waves}    color="sage"  label="Your reservations"    value={reservations.filter((r) => new Date(r.starts_at) > new Date()).length} to="/app/amenities" />
        <StatCard icon={Vote}     color="peach" label="Open proposals"       value={openProposals.length}    to="/app/proposals" />
      </div>

      {/* Hero clay building panel */}
      <GlassCard variant="clay-sage" className="p-8 mb-8 relative overflow-hidden">
        <div className="grid md:grid-cols-2 gap-6 items-center">
          <div>
            <Badge tone="dark" className="mb-3">Pine Ridge Towers</Badge>
            <h2 className="font-display text-3xl text-dusk-500 leading-tight">Your building, at a glance.</h2>
            <p className="mt-3 text-dusk-300 max-w-md">One tap to request a package, approve a guest, book the pool, or weigh in on a proposal.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/app/suggest"><Button variant="primary" size="sm" leftIcon={<Sparkles className="w-4 h-4" />}>Suggest something</Button></Link>
              <Link to="/app/amenities"><Button variant="ghost" size="sm">Book an amenity</Button></Link>
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
          <SectionHeader title="Latest announcements" link="/app/announcements" />
          {anns.slice(0, 3).map((a) => (
            <GlassCard key={a.id} className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-peach-100 text-peach-500 flex items-center justify-center shrink-0">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-dusk-500">{a.title}</h3>
                    {a.source !== 'manual' && <Badge tone="sage">Redigido pela IA</Badge>}
                  </div>
                  <p className="text-sm text-dusk-300 mt-1 line-clamp-2">{a.body}</p>
                  <div className="text-xs text-dusk-200 mt-2">{formatDate(a.created_at)}</div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>

        {/* Hot proposals */}
        <div className="space-y-4">
          <SectionHeader title="In the vote" link="/app/proposals" />
          {openProposals.slice(0, 3).map((p) => (
            <Link key={p.id} to={`/app/proposals/${p.id}`}>
              <GlassCard variant="clay" hover className="p-5">
                <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{p.status}</Badge>
                <h3 className="font-semibold text-dusk-500 mt-2 line-clamp-2">{p.title}</h3>
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
        <div className="text-xs text-dusk-300 mt-0.5">{label}</div>
      </GlassCard>
    </Link>
  );
}

function SectionHeader({ title, link }: { title: string; link: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display text-xl text-dusk-500">{title}</h2>
      <Link to={link} className="text-xs text-dusk-300 hover:text-dusk-500 inline-flex items-center gap-1">
        View all <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
