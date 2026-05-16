import React from 'react';

interface Props {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
      <div className="min-w-0">
        <h1 className="font-display text-3xl md:text-4xl text-dusk-500 leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-dusk-300 text-sm md:text-base max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="w-full sm:w-auto sm:shrink-0 flex flex-wrap items-center justify-start sm:justify-end gap-2">{actions}</div>}
    </header>
  );
}
