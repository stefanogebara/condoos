import React from 'react';
import clsx from 'clsx';

type Tone = 'neutral' | 'sage' | 'peach' | 'warning' | 'dark';
interface Props {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-white/60 text-dusk-400 border-white/70',
  sage:    'bg-sage-100 text-sage-700 border-sage-200',
  peach:   'bg-peach-100 text-peach-500 border-peach-200',
  warning: 'bg-amber-100/70 text-amber-800 border-amber-200',
  dark:    'bg-dusk-400/90 text-cream-50 border-dusk-500 backdrop-blur-md',
};

export default function Badge({ tone = 'neutral', children, className }: Props) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium backdrop-blur-sm',
      TONES[tone], className,
    )}>
      {children}
    </span>
  );
}
