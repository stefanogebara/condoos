import React from 'react';
import GlassCard from './GlassCard';

interface Props {
  title: string;
  body?: string;
  image?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ title, body, image, action }: Props) {
  return (
    <GlassCard variant="clay" className="p-10 flex flex-col items-center text-center">
      {image && <img src={image} alt="" className="w-28 h-28 object-contain mb-4 animate-float-slow" />}
      <h3 className="font-display text-xl text-dusk-500">{title}</h3>
      {body && <p className="text-sm text-dusk-300 mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </GlassCard>
  );
}
