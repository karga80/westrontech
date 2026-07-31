'use client';

/**
 * Westron brand mark — v2 (brand handoff §3).
 *
 * The mark is a single continuous stroke "w" that rises into a dot — the dot
 * is the only filled element and reads as an upward tick. Rules from the guide:
 *   • Gradient variant (#7C5CFF → #C9B8FF) on dark surfaces.
 *   • Mono variant: stroke #F2F2F7, dot #F2F2F7 — for single-colour contexts.
 *   • Symbol-only ≤32px: solid #7C5CFF stroke, NO dot (it disappears at size).
 *   • Wordmark: Space Grotesk 600, lowercase "westron", -0.02em tracking.
 *
 * Purple is brand-only here — it never encodes data anywhere in the product.
 */

import { useId } from 'react';

type Variant = 'gradient' | 'mono' | 'solid';

interface WestronLogoProps {
  /** Mark height in px. Wordmark scales from this. */
  size?: number;
  /** Show the "westron" wordmark next to the mark. */
  wordmark?: boolean;
  variant?: Variant;
  /** Wordmark colour (defaults to brand text). */
  wordColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function WestronLogo({
  size = 28,
  wordmark = false,
  variant = 'gradient',
  wordColor = 'var(--wr-text, #F2F2F7)',
  className,
  style,
}: WestronLogoProps) {
  // Hydration-stable unique id (useId matches server & client). A module counter
  // would produce different ids on each render and break hydration.
  const gid = `wg-${useId().replace(/:/g, '')}`;

  // ≤32px symbol-only auto-collapses to the solid, dotless treatment.
  const collapse = !wordmark && size <= 32;
  const effectiveVariant: Variant = collapse ? 'solid' : variant;
  const showDot = !collapse;

  const stroke =
    effectiveVariant === 'gradient'
      ? `url(#${gid})`
      : effectiveVariant === 'mono'
        ? '#F2F2F7'
        : '#7C5CFF';
  const dotFill = effectiveVariant === 'mono' ? '#F2F2F7' : '#C9B8FF';

  const markW = (size * 72) / 64; // viewBox 72×64

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: `${size * 0.34}px`, ...style }}
    >
      <svg
        width={markW}
        height={size}
        viewBox="0 0 72 64"
        fill="none"
        role="img"
        aria-label="Westron"
        style={{ display: 'block', flexShrink: 0 }}
      >
        {effectiveVariant === 'gradient' && (
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7C5CFF" />
              <stop offset="1" stopColor="#C9B8FF" />
            </linearGradient>
          </defs>
        )}
        <path
          d="M6 22 L18 46 L30 22 L42 46 L56 20 L64 28"
          stroke={stroke}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {showDot && <circle cx={64} cy={28} r={3.5} fill={dotFill} />}
      </svg>
      {wordmark && (
        <span
          style={{
            fontFamily: 'var(--font-space), "Space Grotesk", sans-serif',
            fontSize: `${size * 0.86}px`,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: wordColor,
            lineHeight: 1,
          }}
        >
          westron
        </span>
      )}
    </span>
  );
}
