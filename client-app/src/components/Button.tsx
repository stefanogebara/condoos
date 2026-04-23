import React from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'ghost' | 'sage' | 'peach';
type Size = 'sm' | 'md' | 'lg';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading,
  leftIcon,
  rightIcon,
  children,
  className,
  disabled,
  ...rest
}: Props) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-150 select-none';
  const sizes = {
    sm: 'px-3.5 py-2 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-7 py-3.5 text-base',
  };
  const variants = {
    primary: 'bg-dusk-400 text-cream-50 shadow-[0_8px_24px_-6px_rgba(74,58,54,0.45),inset_0_1px_0_0_rgba(255,255,255,0.2)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-8px_rgba(74,58,54,0.55),inset_0_1px_0_0_rgba(255,255,255,0.22)]',
    ghost:   'bg-white/50 backdrop-blur-md border border-white/60 text-dusk-400 hover:bg-white/70',
    sage:    'bg-sage-300 text-dusk-500 shadow-clay hover:-translate-y-0.5',
    peach:   'bg-peach-200 text-dusk-500 shadow-clay hover:-translate-y-0.5',
  };
  return (
    <button
      className={clsx(base, sizes[size], variants[variant], (disabled || loading) && 'opacity-60 pointer-events-none', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" />
      ) : leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
