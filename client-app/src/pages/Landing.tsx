import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Users, Vote, Sparkles, Calendar, Package, DoorOpen } from 'lucide-react';
import Logo from '../components/Logo';
import Button from '../components/Button';
import GlassCard from '../components/GlassCard';
import Avatar from '../components/Avatar';

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Nav */}
      <nav className="sticky top-0 z-30 px-6 lg:px-12 py-5 flex items-center justify-between backdrop-blur-xl bg-cream-50/30 border-b border-white/30">
        <Logo />
        <div className="hidden md:flex items-center gap-2 text-sm text-dusk-300">
          <a className="px-3 py-1.5 rounded-full hover:bg-white/40 transition">Home</a>
          <a className="px-3 py-1.5 rounded-full hover:bg-white/40 transition">Features</a>
          <a className="px-3 py-1.5 rounded-full hover:bg-white/40 transition">For Boards</a>
          <a className="px-3 py-1.5 rounded-full hover:bg-white/40 transition">For Residents</a>
        </div>
        <Link to="/login"><Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-4 h-4" />}>Sign in</Button></Link>
      </nav>

      {/* Hero */}
      <section className="relative px-6 lg:px-12 pt-16 pb-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
          <div className="relative z-10 animate-fade-up">
            <div className="inline-flex items-center gap-3 mb-8">
              <div className="flex -space-x-2">
                <Avatar name="Maya Chen" size="sm" />
                <Avatar name="Jordan Martins" size="sm" />
                <Avatar name="Taylor Khan" size="sm" />
              </div>
              <span className="chip">
                <span className="w-1.5 h-1.5 rounded-full bg-sage-400" />
                trusted by 500+ condominiums
              </span>
            </div>
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight text-dusk-500">
              Run your building,<br />
              <span className="italic text-dusk-400">softly.</span>
            </h1>
            <p className="mt-7 text-lg text-dusk-300 max-w-xl leading-relaxed">
              Packages, visitors, amenities, announcements, voting — and an AI that turns resident complaints into structured proposals and meeting notes into plain-language updates.
            </p>
            <div className="mt-10 flex items-center gap-3 flex-wrap">
              <Link to="/login"><Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>Try the demo</Button></Link>
              <Button variant="ghost" size="lg">See features</Button>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-3 max-w-md">
              {[
                { n: '01', label: 'Sign in' },
                { n: '02', label: 'Explore' },
                { n: '03', label: 'Decide' },
              ].map((s) => (
                <GlassCard key={s.n} className="p-4 text-center">
                  <div className="text-xs uppercase tracking-widest text-dusk-200 mb-1">{s.n}</div>
                  <div className="font-semibold text-dusk-400">{s.label}</div>
                </GlassCard>
              ))}
            </div>
          </div>

          {/* Hero image + floating glass cards */}
          <div className="relative flex items-center justify-center animate-fade-up">
            <div className="relative w-full max-w-[560px] aspect-[4/3] flex items-center justify-center">
              <img
                src="/images/hero-clay-building.jpg"
                alt="CondoOS"
                className="w-full h-full object-contain animate-float-slow drop-shadow-[0_30px_40px_rgba(110,80,60,0.25)]"
              />
              <GlassCard className="absolute top-6 -left-2 p-3 px-4 hidden md:flex items-center gap-3 w-56">
                <div className="w-9 h-9 rounded-xl bg-sage-200 flex items-center justify-center text-sage-700"><Package className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">2 packages waiting</div>
                  <div className="text-sm font-semibold text-dusk-500">Unit 704 · Maya</div>
                </div>
              </GlassCard>
              <GlassCard className="absolute bottom-10 -right-2 p-3 px-4 hidden md:flex items-center gap-3 w-60">
                <div className="w-9 h-9 rounded-xl bg-peach-100 flex items-center justify-center text-peach-500"><Vote className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">Proposal passing</div>
                  <div className="text-sm font-semibold text-dusk-500">Replace lobby AC · 4-1</div>
                </div>
              </GlassCard>
              <GlassCard className="absolute bottom-0 left-6 p-3 px-4 hidden lg:flex items-center gap-3 w-52">
                <div className="w-9 h-9 rounded-xl bg-dusk-100 flex items-center justify-center text-dusk-400"><Sparkles className="w-4 h-4" /></div>
                <div>
                  <div className="text-xs text-dusk-200">AI drafted</div>
                  <div className="text-sm font-semibold text-dusk-500">3 new proposals</div>
                </div>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative px-6 lg:px-12 pb-24">
        <div className="max-w-7xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl text-dusk-500 mb-3">Everything a building runs on.</h2>
          <p className="text-dusk-300 mb-10 max-w-xl">Replace spreadsheets, chat groups, and paper notices with one calm operating system.</p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: Package,  color: 'sage',  title: 'Packages & visitors', body: 'Real-time front-desk queue. Approve guests from your phone.' },
              { icon: DoorOpen, color: 'peach', title: 'Amenities & bookings', body: 'Pool, gym, party room. Residents book. Conflicts prevented.' },
              { icon: Vote,     color: 'sage',  title: 'Proposals & voting',  body: 'Turn complaints into decisions. Live counts. Full transparency.' },
              { icon: Calendar, color: 'peach', title: 'Meetings',            body: 'Paste raw notes. Get summary, decisions, action items.' },
              { icon: Sparkles, color: 'sage',  title: 'AI co-pilot',         body: 'Cluster complaints, draft proposals, explain to residents.' },
              { icon: Users,    color: 'peach', title: 'Resident-first',      body: 'Plain-language updates. Nobody reads the bylaws.' },
            ].map((f, i) => (
              <GlassCard key={i} variant="clay" hover className="p-7">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${
                  f.color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'
                }`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-xl text-dusk-500 mb-1">{f.title}</h3>
                <p className="text-sm text-dusk-300 leading-relaxed">{f.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* AI callout — dusk landscape with glass cards */}
      <section className="relative px-6 lg:px-12 pb-24">
        <div className="max-w-7xl mx-auto relative overflow-hidden rounded-[40px] shadow-clay-lg">
          <img src="/images/bg-dusk.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="relative p-10 md:p-16 text-cream-50">
            <span className="chip bg-white/20 border-white/30 text-cream-50">AI co-pilot</span>
            <h2 className="font-display text-3xl md:text-5xl mt-4 max-w-2xl leading-tight">
              From "the lobby AC is broken" to a board decision — in minutes.
            </h2>
            <div className="mt-10 grid md:grid-cols-3 gap-5">
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-wider opacity-70 mb-2">Step 1 · Resident</div>
                <p className="text-cream-50/90">"The lobby AC is barely working. It was 30°C inside yesterday."</p>
              </GlassCard>
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-wider opacity-70 mb-2">Step 2 · AI drafts</div>
                <p className="font-semibold">Replace lobby AC unit</p>
                <p className="text-sm opacity-80 mt-1">Maintenance · ~$9,400 · 5-ton replacement quote from Cool Breeze HVAC.</p>
              </GlassCard>
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-wider opacity-70 mb-2">Step 3 · Board votes</div>
                <p>Opens for voting → residents approve → AI publishes a resident-friendly announcement.</p>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 lg:px-12 py-10 border-t border-white/40 bg-cream-50/30 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-dusk-300">
          <Logo size={22} />
          <p>© 2026 CondoOS — built for hackathons, designed for humans.</p>
        </div>
      </footer>
    </div>
  );
}
