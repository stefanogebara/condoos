import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Users, Vote, Sparkles, Calendar, Package, Waves } from 'lucide-react';
import Logo from '../components/Logo';
import Button from '../components/Button';
import GlassCard from '../components/GlassCard';
import Avatar from '../components/Avatar';

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Nav */}
      <nav className="sticky top-0 z-30 px-6 lg:px-12 py-4 flex items-center justify-between backdrop-blur-xl bg-cream-50/40 border-b border-white/30">
        <Logo />
        <div className="hidden md:flex items-center gap-1 text-sm text-dusk-300">
          <a href="#features"  className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">Features</a>
          <a href="#ai"        className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">AI co-pilot</a>
          <Link to="/design"   className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">Design</Link>
          <a href="https://github.com/stefanogebara/condoos" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full hover:bg-white/50 transition">GitHub</a>
        </div>
        <Link to="/login"><Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-4 h-4" />}>Sign in</Button></Link>
      </nav>

      {/* Hero — tighter, more confident, Inter Tight first */}
      <section className="relative px-6 lg:px-12 pt-20 pb-28">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
          <div className="relative z-10 animate-fade-up">
            <div className="inline-flex items-center gap-3 mb-10">
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

            <h1 className="font-display text-dusk-500 leading-[0.95] tracking-tightest"
                style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', fontWeight: 600 }}>
              Run your building,
              <br />
              <span className="italic text-dusk-400">softly.</span>
            </h1>

            <p className="mt-8 text-[17px] md:text-[19px] text-dusk-300 max-w-xl leading-[1.55] tracking-tight">
              Packages, visitors, amenities, voting — and an AI that turns resident
              complaints into structured proposals and meeting notes into plain-language updates.
            </p>

            <div className="mt-10 flex items-center gap-3 flex-wrap">
              <Link to="/login">
                <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                  Try the demo
                </Button>
              </Link>
              <a href="#features">
                <Button variant="ghost" size="lg">See what's inside</Button>
              </a>
            </div>

            <div className="mt-14 flex items-center gap-6 flex-wrap text-xs uppercase tracking-[0.14em] text-dusk-200 font-medium">
              <span>Claude Haiku</span>
              <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
              <span>Inter Tight</span>
              <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
              <span>Gemini Image</span>
              <span className="w-1 h-1 rounded-full bg-dusk-200/60" />
              <span>SQLite</span>
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

      {/* Pull quote — breathe */}
      <section className="relative px-6 lg:px-12 pb-24">
        <div className="max-w-4xl mx-auto text-center">
          <p className="font-display text-2xl md:text-4xl leading-[1.2] tracking-tight text-dusk-400">
            "<span className="italic text-dusk-500">Perhaps we are searching in the branches for what we only find in the roots.</span>"
          </p>
          <p className="mt-5 text-sm uppercase tracking-[0.16em] text-dusk-200 font-medium">a calmer way to run a building</p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <span className="chip mb-4"><span className="w-1.5 h-1.5 rounded-full bg-sage-400" /> everything in one OS</span>
            <h2 className="font-display text-4xl md:text-5xl text-dusk-500 tracking-tight leading-[1.05] mt-4">
              Everything a building runs on.
            </h2>
            <p className="text-dusk-300 mt-4 text-lg leading-relaxed">
              Replace spreadsheets, chat groups, and paper notices with one calm operating system.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { icon: Package,  color: 'sage',  title: 'Packages & visitors', body: 'Real-time front-desk queue. Approve guests from your phone.' },
              { icon: Waves,    color: 'peach', title: 'Amenities & bookings', body: 'Pool, gym, party room. Residents book. Conflicts prevented.' },
              { icon: Vote,     color: 'sage',  title: 'Proposals & voting',   body: 'Turn complaints into decisions. Live counts. Full transparency.' },
              { icon: Calendar, color: 'peach', title: 'Meetings',             body: 'Paste raw notes. Get summary, decisions, action items.' },
              { icon: Sparkles, color: 'sage',  title: 'AI co-pilot',          body: 'Cluster complaints, draft proposals, explain to residents.' },
              { icon: Users,    color: 'peach', title: 'Resident-first',       body: 'Plain-language updates. Nobody reads the bylaws.' },
            ].map((f, i) => (
              <GlassCard key={i} variant="clay" hover className="p-7">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 ${
                  f.color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'
                }`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-[20px] font-semibold text-dusk-500 tracking-tight leading-tight">{f.title}</h3>
                <p className="text-[15px] text-dusk-300 leading-relaxed mt-2">{f.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* AI callout — dusk landscape with glass cards */}
      <section id="ai" className="relative px-6 lg:px-12 pb-28 scroll-mt-20">
        <div className="max-w-7xl mx-auto relative overflow-hidden rounded-[40px] shadow-clay-lg">
          <img src="/images/bg-dusk.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-dusk-500/10 via-transparent to-dusk-500/30" />
          <div className="relative p-10 md:p-16 text-cream-50">
            <span className="chip bg-white/20 border-white/30 text-cream-50"><Sparkles className="w-3.5 h-3.5" /> AI co-pilot</span>
            <h2 className="font-display text-4xl md:text-[56px] mt-5 max-w-3xl tracking-tightest leading-[1.02]">
              From "the lobby AC is broken" to a board decision — in minutes.
            </h2>
            <p className="mt-5 text-cream-50/80 text-lg max-w-xl leading-relaxed">
              Six AI moments, one quiet interface. Graceful fallbacks so demos never hang.
            </p>
            <div className="mt-12 grid md:grid-cols-3 gap-5">
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-[0.12em] opacity-70 mb-3 font-medium">01 · Resident</div>
                <p className="text-cream-50/95 text-[15px] leading-relaxed italic">"The lobby AC is barely working. It was 30°C inside yesterday."</p>
              </GlassCard>
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-[0.12em] opacity-70 mb-3 font-medium">02 · AI drafts</div>
                <p className="font-semibold text-[16px]">Replace lobby AC unit</p>
                <p className="text-[13px] opacity-80 mt-2 leading-relaxed">Maintenance · ~$9,400 · 5-ton replacement quote from Cool Breeze HVAC.</p>
              </GlassCard>
              <GlassCard variant="glass-dark" className="p-6">
                <div className="text-xs uppercase tracking-[0.12em] opacity-70 mb-3 font-medium">03 · Board votes</div>
                <p className="text-[15px] leading-relaxed">Opens for voting → residents approve → AI publishes a resident-friendly announcement.</p>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 lg:px-12 py-12 border-t border-white/40 bg-cream-50/30 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-dusk-300">
          <Logo size={22} />
          <p className="font-mono text-xs text-dusk-200">© 2026 CondoOS · built for hackathons, designed for humans</p>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/design" className="hover:text-dusk-500 transition">Design system</Link>
            <a href="https://github.com/stefanogebara/condoos" target="_blank" rel="noreferrer" className="hover:text-dusk-500 transition">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
