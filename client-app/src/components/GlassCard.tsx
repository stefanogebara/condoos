import React from 'react';
import clsx from 'clsx';

type Variant = 'glass' | 'glass-dark' | 'clay' | 'clay-sage' | 'clay-peach';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  hover?: boolean;
  as?: keyof JSX.IntrinsicElements;
}

export default function GlassCard({ className, variant = 'glass', hover, children, as: Tag = 'div', ...rest }: Props) {
  return (
    <Tag
      className={clsx(
        variant,
        hover && 'transition-all duration-200 hover:-translate-y-0.5',
        className,
      )}
      {...(rest as any)}
    >
      {children}
    </Tag>
  );
}
