import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Logo from '../components/Logo';
import GlassCard from '../components/GlassCard';
import Badge from '../components/Badge';

/**
 * /logos — prototype gallery. All 8 logos generated via Gemini 3.1 Flash Image.
 * Regenerate with: GEMINI_API_KEY=... bash scripts/gen-logos.sh
 */
const LOGOS = [
  { src: '/logos/01-wordmark-clean.png',     title: 'Wordmark',          subtitle: 'Inter Tight 600, dusk ink on cream' },
  { src: '/logos/02-mark-clay-building.png', title: 'Mark + wordmark',   subtitle: 'Sage clay building + horizontal wordmark' },
  { src: '/logos/03-monogram-c.png',         title: 'Monogram',          subtitle: 'Lowercase "c" in matte sage clay' },
  { src: '/logos/04-badge-circular.png',     title: 'Circular badge',    subtitle: 'Arched wordmark, clay mark at center' },
  { src: '/logos/05-abstract-stack.png',     title: 'Abstract stack',    subtitle: 'Cream + peach + sage floors' },
  { src: '/logos/06-glass-sphere.png',       title: 'Glass sphere',      subtitle: 'Glassmorphism + clay mark' },
  { src: '/logos/07-architectural.png',      title: 'Architectural',     subtitle: 'Line-drawn precision, warm window dots' },
  { src: '/logos/08-door-key-abstract.png',  title: 'Door + key',        subtitle: 'Abstract access metaphor, no text' },
];

export default function Logos() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-20 px-6 lg:px-10 py-4 flex items-center justify-between backdrop-blur-xl bg-cream-50/40 border-b border-white/30">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-dusk-300 hover:text-dusk-500 inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <span className="text-dusk-200">·</span>
          <Logo size={22} />
          <span className="text-xs text-dusk-200 font-mono">logo prototypes v1</span>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14">
        <Badge tone="sage" className="mb-5">logo gallery</Badge>
        <h1 className="font-display text-5xl md:text-6xl text-dusk-500 tracking-tightest leading-[1.02]">
          Eight ways to <span className="italic">sign</span> a building.
        </h1>
        <p className="mt-6 text-dusk-300 max-w-2xl text-lg leading-relaxed">
          All eight prototypes generated with Gemini 3.1 Flash Image using a consistent CondoOS prompt —
          muted sage & cream, soft claymorphism, Inter Tight wordmark, warm glow. Pick a favorite.
        </p>
        <p className="mt-2 text-xs text-dusk-200 font-mono">scripts/gen-logos.sh · 8 variants · &lt; 90s total</p>

        <div className="grid md:grid-cols-2 gap-6 mt-12">
          {LOGOS.map((l) => (
            <GlassCard key={l.src} variant="clay" hover className="p-4">
              <div className="aspect-square rounded-3xl overflow-hidden bg-cream-50 ring-1 ring-white/50">
                <img src={l.src} alt={l.title} className="w-full h-full object-contain" />
              </div>
              <div className="px-2 pt-4 pb-2 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-dusk-500 tracking-tight">{l.title}</h3>
                  <p className="text-sm text-dusk-300 mt-0.5 leading-snug">{l.subtitle}</p>
                </div>
                <span className="chip shrink-0 font-mono text-[10px]">{l.src.match(/\d+/)?.[0]}</span>
              </div>
            </GlassCard>
          ))}
        </div>

        <div className="mt-16 pt-10 border-t border-white/40">
          <h2 className="font-display text-2xl text-dusk-500 tracking-tight">How these were made</h2>
          <p className="mt-3 text-dusk-300 max-w-2xl leading-relaxed">
            Each prompt shares a <span className="font-mono text-[13px] bg-white/60 px-1.5 py-0.5 rounded">BASE_STYLE</span> fragment
            defining claymorphism, the sage+cream palette, soft rim lighting, and square composition —
            then varies just the mark. Consistent visual DNA, eight directions to explore.
          </p>
          <p className="mt-2 text-dusk-300">
            <Link to="/design" className="text-dusk-500 underline decoration-dotted underline-offset-4 hover:text-dusk-400">
              See full design system →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
