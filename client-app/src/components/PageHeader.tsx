import React from 'react';

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <header className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="font-display text-3xl md:text-4xl text-dusk-500 leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-dusk-300 text-sm md:text-base max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </header>
  );
}
