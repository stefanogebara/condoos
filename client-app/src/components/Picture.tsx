import React from 'react';

interface Props {
  /** Path WITHOUT extension, relative to /public. e.g. "/images/characters/hero-community-01" */
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** "high" for above-fold hero, "low" for below-fold. Default: "low". */
  priority?: 'high' | 'low';
  decorative?: boolean;
}

/**
 * Drop-in replacement for <img>. Emits a <picture> with WebP + JPG fallback,
 * explicit dimensions to prevent CLS, and lazy/eager loading per priority.
 *
 * The compressed WebP siblings (~50% smaller than JPG at visually-identical
 * quality) are produced by `scripts/optimize-images.sh`.
 */
export default function Picture({
  src,
  alt,
  width,
  height,
  className,
  priority = 'low',
  decorative,
}: Props) {
  const isHigh = priority === 'high';
  return (
    <picture>
      <source srcSet={`${src}.webp`} type="image/webp" />
      <img
        src={`${src}.jpg`}
        alt={decorative ? '' : alt}
        aria-hidden={decorative || undefined}
        width={width}
        height={height}
        className={className}
        loading={isHigh ? 'eager' : 'lazy'}
        decoding={isHigh ? 'sync' : 'async'}
        fetchPriority={isHigh ? 'high' : 'auto'}
      />
    </picture>
  );
}
