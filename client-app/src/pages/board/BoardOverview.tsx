import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Vote, Calendar, Users, ArrowRight, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import GlassCard from '../../components/GlassCard';
import Badge from '../../components/Badge';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Proposal { id: number; title: string; status: string; votes: { yes: number; no: number; abstain: number; total: number }; }
interface Suggestion { id: number; body: string; status: string; }
interface Meeting { id: number; title: string; scheduled_for: string; status: string; }

export default function BoardOverview() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [residents, setResidents] = useState<any[]>([]);

  useEffect(() => {
    apiGet<Proposal[]>('/proposals').then(setProposals).catch(() => {});
    apiGet<Suggestion[]>('/suggestions').then(setSuggestions).catch(() => {});
    apiGet<Meeting[]>('/meetings').then(setMeetings).catch(() => {});
    apiGet<any[]>('/users/residents').then(setResidents).catch(() => {});
  }, []);

  const openSuggestions = suggestions.filter((s) => s.status === 'open');
  const openProposals = proposals.filter((p) => p.status === 'voting' || p.status === 'discussion');
  const upcoming = meetings.filter((m) => new Date(m.scheduled_for) > new Date() && m.status !== 'completed');

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.first_name}.`}
        subtitle="Everything that needs your attention at Pine Ridge Towers."
      />

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <Stat icon={Inbox}    color="peach" label="New suggestions" value={openSuggestions.length} to="/board/suggestions" />
        <Stat icon={Vote}     color="sage"  label="Active proposals" value={openProposals.length}  to="/board/proposals" />
        <Stat icon={Calendar} color="peach" label="Upcoming meetings" value={upcoming.length}     to="/board/meetings" />
        <Stat icon={Users}    color="sage"  label="Residents"         value={residents.length}    to="/board/residents" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard variant="clay-peach" className="p-7">
          <Badge tone="dark" className="mb-3"><Sparkles className="w-3 h-3" /> AI inbox</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">{openSuggestions.length} resident suggestions waiting</h2>
          <p className="text-sm text-dusk-300 mt-2">Cluster them, turn them into proposals, or dismiss. One click each.</p>
          <Link to="/board/suggestions" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            Open inbox <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>

        <GlassCard variant="clay-sage" className="p-7">
          <Badge tone="dark" className="mb-3">Meeting ready?</Badge>
          <h2 className="font-display text-2xl text-dusk-500 leading-tight">Paste raw notes. Get a recap, action items, and a resident announcement.</h2>
          <Link to="/board/meetings" className="mt-5 inline-flex items-center gap-1 font-semibold text-dusk-500">
            View meetings <ArrowRight className="w-4 h-4" />
          </Link>
        </GlassCard>
      </div>

      <h2 className="font-display text-xl text-dusk-500 mt-10 mb-4">Active proposals</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {openProposals.map((p) => (
          <Link key={p.id} to={`/board/proposals/${p.id}`}>
            <GlassCard variant="clay" hover className="p-5">
              <Badge tone={p.status === 'voting' ? 'peach' : 'sage'}>{p.status}</Badge>
              <h3 className="font-semibold text-dusk-500 mt-2">{p.title}</h3>
              {p.status === 'voting' && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-sage-700 font-semibold">{p.votes.yes} yes</span>
                  <span className="text-peach-500 font-semibold">{p.votes.no} no</span>
                  <span className="text-dusk-200">{p.votes.abstain} abstain</span>
                </div>
              )}
            </GlassCard>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({ icon: Icon, color, label, value, to }: any) {
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
