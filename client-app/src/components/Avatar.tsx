import React from 'react';
import clsx from 'clsx';

interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const GRADIENTS = [
  'from-sage-300 to-sage-500',
  'from-peach-200 to-peach-400',
  'from-dusk-100 to-dusk-300',
  'from-sage-200 to-peach-300',
  'from-peach-300 to-dusk-200',
];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export default function Avatar({ name, size = 'md', className }: Props) {
  const initials = name.split(' ').map((s) => s[0] || '').join('').slice(0, 2).toUpperCase();
  const gradient = colorFor(name);
  const sizes = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
  };
  return (
    <div
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-gradient-to-br text-white font-semibold shadow-clay ring-2 ring-white/60',
        gradient, sizes[size], className,
      )}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
