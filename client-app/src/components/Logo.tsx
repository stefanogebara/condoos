import React from 'react';

interface Props {
  size?: number;
  withText?: boolean;
  className?: string;
}

export default function Logo({ size = 28, withText = true, className }: Props) {
  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="CondoOS">
        <defs>
          <linearGradient id="condoos-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#AEBFA0" />
            <stop offset="100%" stopColor="#7A9070" />
          </linearGradient>
          <filter id="condoos-inner">
            <feGaussianBlur stdDeviation="1" />
          </filter>
        </defs>
        <rect x="4" y="4" width="40" height="40" rx="14" fill="url(#condoos-grad)" />
        <rect x="4" y="4" width="40" height="40" rx="14" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" />
        {/* Little clay building silhouette */}
        <g fill="rgba(255,255,255,0.85)">
          <rect x="14" y="18" width="6" height="18" rx="1.2" />
          <rect x="22" y="14" width="6" height="22" rx="1.2" />
          <rect x="30" y="20" width="4" height="16" rx="1" />
        </g>
        <g fill="rgba(74,58,54,0.35)">
          <rect x="15.5" y="22" width="1.6" height="2" rx="0.4" />
          <rect x="15.5" y="27" width="1.6" height="2" rx="0.4" />
          <rect x="15.5" y="32" width="1.6" height="2" rx="0.4" />
          <rect x="23.5" y="18" width="1.6" height="2" rx="0.4" />
          <rect x="23.5" y="23" width="1.6" height="2" rx="0.4" />
          <rect x="23.5" y="28" width="1.6" height="2" rx="0.4" />
          <rect x="23.5" y="33" width="1.6" height="2" rx="0.4" />
          <rect x="30.8" y="24" width="1.2" height="2" rx="0.4" />
          <rect x="30.8" y="29" width="1.2" height="2" rx="0.4" />
        </g>
      </svg>
      {withText && (
        <span className="font-display font-semibold text-dusk-500 tracking-tight text-xl">
          CondoOS
        </span>
      )}
    </div>
  );
}
