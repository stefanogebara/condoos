import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Package, Vote, DoorOpen, Waves, Megaphone, Check, AlertCircle } from 'lucide-react';
import Logo from '../components/Logo';
import GlassCard from '../components/GlassCard';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Avatar from '../components/Avatar';

/**
 * /design — CondoOS design system reference.
 * Modern Inter/Inter Tight typography, sage+peach+cream palette,
 * claymorphism + glassmorphism surfaces. Inspired by Google Material 3 and Claude.ai.
 */
export default function DesignSystem() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-20 px-6 lg:px-10 py-4 flex items-center justify-between backdrop-blur-xl bg-cream-50/40 border-b border-white/30">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-dusk-300 hover:text-dusk-500 inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <span className="text-dusk-200">·</span>
          <Logo size={22} />
          <span className="text-xs text-dusk-200 font-mono">design system v1</span>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-14 space-y-20">
        {/* Hero */}
        <Section>
          <div className="max-w-3xl">
            <Badge tone="sage" className="mb-5">design system</Badge>
            <h1 className="font-display text-5xl md:text-6xl leading-[1.02] text-dusk-500">
              Calm surfaces, <span className="italic">soft light</span>, honest type.
            </h1>
            <p className="mt-6 text-lg text-dusk-300 leading-relaxed max-w-2xl">
              CondoOS is built on three principles: clay surfaces feel tactile, glass panels feel weightless, and type — set in Inter and Inter Tight — feels modern, warm, and quietly confident. Think Google Material 3 meets Claude.ai, with a pinch of sage and peach.
            </p>
          </div>
        </Section>

        {/* Typography */}
        <Section title="Typography" subtitle="Inter + Inter Tight. The modern UI pairing shared by Vercel, Linear, Google, and Anthropic. Negative letter-spacing on headings gives it a crisp, tight, Claude-ish silhouette.">
          <div className="grid md:grid-cols-2 gap-6">
            <GlassCard className="p-8 space-y-5">
              <Label>Display · Inter Tight 600</Label>
              <div className="font-display text-6xl leading-none text-dusk-500 tracking-tighter">Run softly.</div>
              <div className="font-display text-4xl leading-tight text-dusk-500 tracking-tight">A calm place to think.</div>
              <div className="font-display text-2xl text-dusk-500 tracking-tight">Section heading</div>
              <div className="font-display text-lg text-dusk-500 tracking-tight">Subsection heading</div>
            </GlassCard>
            <GlassCard className="p-8 space-y-5">
              <Label>Body · Inter</Label>
              <p className="text-lg text-dusk-500 leading-relaxed">
                <span className="font-semibold">Body L.</span> Used for hero paragraphs and intro copy. Tight but readable.
              </p>
              <p className="text-base text-dusk-400 leading-relaxed">
                <span className="font-semibold">Body M.</span> The default reading size for long-form content, proposal descriptions, and explanations.
              </p>
              <p className="text-sm text-dusk-400">
                <span className="font-semibold">Body S.</span> Metadata, helper text, form labels. Slightly de-emphasized.
              </p>
              <p className="text-xs font-mono text-dusk-200 tracking-wide">METADATA · FONT-MONO · 0.75REM</p>
            </GlassCard>
          </div>

          <GlassCard variant="clay-sage" className="p-8 mt-6">
            <Label>Type scale</Label>
            <div className="mt-4 space-y-2 divide-y divide-white/50">
              {[
                { name: 'display-2xl', size: '72px', weight: '600', tracking: '-0.035em', example: 'Aa' },
                { name: 'display-xl',  size: '56px', weight: '600', tracking: '-0.03em',  example: 'Aa' },
                { name: 'display-lg',  size: '40px', weight: '600', tracking: '-0.025em', example: 'Aa' },
                { name: 'display-md',  size: '30px', weight: '600', tracking: '-0.02em',  example: 'Aa' },
                { name: 'heading',     size: '20px', weight: '600', tracking: '-0.015em', example: 'Aa' },
                { name: 'body-lg',     size: '18px', weight: '400', tracking: '-0.01em',  example: 'Aa' },
                { name: 'body',        size: '16px', weight: '400', tracking: '-0.005em', example: 'Aa' },
                { name: 'label',       size: '14px', weight: '500', tracking: '0',         example: 'Aa' },
                { name: 'caption',     size: '12px', weight: '500', tracking: '0.01em',   example: 'Aa' },
              ].map((t) => (
                <div key={t.name} className="flex items-center gap-6 py-3">
                  <div className="w-40 shrink-0 font-mono text-xs text-dusk-300">{t.name}</div>
                  <div
                    className="flex-1 text-dusk-500 font-display"
                    style={{ fontSize: t.size, fontWeight: t.weight, letterSpacing: t.tracking, lineHeight: 1.1 }}
                  >
                    The quick brown fox
                  </div>
                  <div className="hidden md:block text-xs text-dusk-200 font-mono">{t.size} · {t.weight}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </Section>

        {/* Color */}
        <Section title="Color" subtitle="Muted sage for primary action and growth. Dusty peach for attention and warmth. Warm dusk for ink and decisions. Cream for surfaces.">
          <div className="grid md:grid-cols-4 gap-6">
            <Ramp name="Sage" scale={[
              ['50',  '#F3F5F0'], ['100', '#E5EADF'], ['200', '#C8D4BD'],
              ['300', '#AEBFA0'], ['400', '#94A886'], ['500', '#7A9070'], ['600', '#617558'], ['700', '#4B5C45'],
            ]} />
            <Ramp name="Peach" scale={[
              ['50',  '#FBF1EA'], ['100', '#F6E0D0'], ['200', '#EEC8AE'],
              ['300', '#E3AD8B'], ['400', '#D48E6C'], ['500', '#BF7251'],
            ]} />
            <Ramp name="Dusk" scale={[
              ['100', '#D4B8A8'], ['200', '#B89584'],
              ['300', '#8E7569'], ['400', '#6B554E'], ['500', '#4A3A36'],
            ]} />
            <Ramp name="Cream" scale={[
              ['50',  '#FAF6EF'], ['100', '#F3ECE0'], ['200', '#E8DDCB'],
            ]} />
          </div>
        </Section>

        {/* Surfaces */}
        <Section title="Surfaces" subtitle="Four card treatments. Glass for overlays on imagery. Clay for content containers. Sage + Peach variants for moments of emphasis.">
          <div className="grid md:grid-cols-2 gap-5">
            <GlassCard variant="glass" className="p-6">
              <Label>glass</Label>
              <p className="mt-3 text-dusk-400 text-sm">Frosted backdrop-filter at 24px. 55% white border. Ideal over imagery.</p>
            </GlassCard>
            <GlassCard variant="clay" className="p-6">
              <Label>clay</Label>
              <p className="mt-3 text-dusk-400 text-sm">Soft gradient, thin inner highlight, tactile drop shadow. Default content surface.</p>
            </GlassCard>
            <GlassCard variant="clay-sage" className="p-6">
              <Label>clay-sage</Label>
              <p className="mt-3 text-dusk-500 text-sm">Use for feature callouts and primary AI moments.</p>
            </GlassCard>
            <GlassCard variant="clay-peach" className="p-6">
              <Label>clay-peach</Label>
              <p className="mt-3 text-dusk-500 text-sm">Use for warmth, invitations, and attention without alarm.</p>
            </GlassCard>
          </div>

          <div className="relative mt-6 rounded-[32px] overflow-hidden">
            <img src="/images/bg-dusk.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="relative p-8 grid md:grid-cols-2 gap-5">
              <GlassCard variant="glass-dark" className="p-5">
                <Label className="opacity-70 text-cream-50">glass-dark</Label>
                <p className="mt-3 text-cream-50/90 text-sm">Frosted dark panel for AI moments over photography. Inspired by the dune-glass inspiration shots.</p>
              </GlassCard>
              <GlassCard variant="glass" className="p-5">
                <Label>glass (light) over image</Label>
                <p className="mt-3 text-dusk-500 text-sm">Same frosted card stays readable over warm dusk backdrops. 24px blur + 55% white border.</p>
              </GlassCard>
            </div>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons" subtitle="Pill-shaped. Dusk-400 ink on cream for primary. Glass ghost for secondary. Sage and peach tints for tonal actions.">
          <GlassCard className="p-8">
            <div className="grid md:grid-cols-2 gap-6">
              <Row label="Variants">
                <Button variant="primary" leftIcon={<Sparkles className="w-4 h-4" />}>Primary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="sage">Sage</Button>
                <Button variant="peach">Peach</Button>
              </Row>
              <Row label="Sizes">
                <Button variant="primary" size="sm">Small</Button>
                <Button variant="primary" size="md">Medium</Button>
                <Button variant="primary" size="lg">Large</Button>
              </Row>
              <Row label="States">
                <Button variant="primary" loading>Loading</Button>
                <Button variant="primary" disabled>Disabled</Button>
                <Button variant="primary" leftIcon={<Check className="w-4 h-4" />}>With icon</Button>
              </Row>
              <Row label="In context">
                <Button variant="primary" rightIcon={<Sparkles className="w-4 h-4" />}>Summarize thread</Button>
              </Row>
            </div>
          </GlassCard>
        </Section>

        {/* Badges */}
        <Section title="Badges & chips" subtitle="Quiet labels. Dot prefix optional. Dark badge for AI-authored content.">
          <GlassCard className="p-8 flex flex-wrap gap-2">
            <Badge tone="neutral">neutral</Badge>
            <Badge tone="sage">sage</Badge>
            <Badge tone="peach">peach</Badge>
            <Badge tone="warning"><AlertCircle className="w-3 h-3" /> warning</Badge>
            <Badge tone="dark"><Sparkles className="w-3 h-3" /> AI-drafted</Badge>
            <span className="chip"><span className="w-1.5 h-1.5 rounded-full bg-sage-400" />live</span>
            <span className="chip">maintenance</span>
            <span className="chip">~$9,400</span>
          </GlassCard>
        </Section>

        {/* Iconography */}
        <Section title="Iconography" subtitle="Lucide icons at 18–24px. Soft pastel tiles underneath, matching the palette.">
          <GlassCard className="p-8">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-5">
              {[
                { icon: Package,   color: 'sage',  label: 'Packages' },
                { icon: DoorOpen,  color: 'peach', label: 'Visitors' },
                { icon: Waves,     color: 'sage',  label: 'Amenities' },
                { icon: Megaphone, color: 'peach', label: 'Announcements' },
                { icon: Vote,      color: 'sage',  label: 'Proposals' },
                { icon: Sparkles,  color: 'peach', label: 'AI' },
              ].map((t) => (
                <div key={t.label} className="flex flex-col items-center text-center gap-2">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                    t.color === 'sage' ? 'bg-sage-200 text-sage-700' : 'bg-peach-100 text-peach-500'
                  }`}>
                    <t.icon className="w-6 h-6" />
                  </div>
                  <div className="text-xs text-dusk-300 font-medium">{t.label}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </Section>

        {/* Clay illustrations */}
        <Section title="Clay illustrations" subtitle="3D claymorphism assets generated by Gemini 3.1 Flash Image. Regenerate via scripts/gen-images.sh.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { src: '/images/hero-clay-building.jpg', label: 'Hero · building' },
              { src: '/images/clay-mail.png',          label: 'Mail' },
              { src: '/images/clay-key.png',           label: 'Key' },
              { src: '/images/clay-pool.png',          label: 'Pool' },
              { src: '/images/clay-megaphone.png',     label: 'Megaphone' },
              { src: '/images/clay-vote.png',          label: 'Vote' },
              { src: '/images/clay-building.png',      label: 'Building icon' },
              { src: '/images/bg-sage.jpg',            label: 'Sage backdrop' },
            ].map((a) => (
              <GlassCard key={a.label} variant="clay" className="p-3">
                <div className="aspect-square rounded-2xl overflow-hidden bg-cream-100 flex items-center justify-center">
                  <img src={a.src} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="text-xs text-dusk-300 text-center mt-2 font-medium">{a.label}</div>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* Avatars */}
        <Section title="Avatars" subtitle="Deterministic gradient avatars derived from initials. No external service needed.">
          <GlassCard className="p-8 flex items-center gap-4 flex-wrap">
            {['Alex Silva', 'Maya Chen', 'Jordan Martins', 'Taylor Khan', 'Riley Okafor', 'Sam Nguyen'].map((n) => (
              <div key={n} className="flex items-center gap-2">
                <Avatar name={n} size="md" />
                <div className="text-sm text-dusk-400">{n}</div>
              </div>
            ))}
          </GlassCard>
        </Section>

        {/* Footer */}
        <div className="pt-10 pb-20 border-t border-white/40 text-sm text-dusk-300">
          <p>
            Fonts — Inter + Inter Tight via Google Fonts. Palette: sage, peach, dusk, cream.
            Roundness — 12 (medium) and full (pills). Motion — float-slow, fade-up.
          </p>
          <p className="mt-2 font-mono text-xs text-dusk-200">
            stitch · claude.ai · material 3 · fonts.google.com
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h2 className="font-display text-3xl text-dusk-500 tracking-tight">{title}</h2>}
      {subtitle && <p className="mt-2 text-dusk-300 max-w-2xl leading-relaxed">{subtitle}</p>}
      <div className={title ? 'mt-8' : ''}>{children}</div>
    </section>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-xs uppercase tracking-[0.12em] text-dusk-200 font-mono ${className || ''}`}>{children}</div>
  );
}

function Ramp({ name, scale }: { name: string; scale: [string, string][] }) {
  return (
    <GlassCard className="p-5">
      <Label>{name}</Label>
      <div className="mt-3 space-y-2">
        {scale.map(([key, hex]) => (
          <div key={key} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg shadow-clay" style={{ background: hex }} />
            <div className="flex-1 text-xs text-dusk-400 font-mono">{name.toLowerCase()}-{key}</div>
            <div className="text-xs text-dusk-200 font-mono">{hex}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-3 flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}
