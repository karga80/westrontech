'use client';

import { getScoreLevel, getScoreColor, getScoreLabel } from '@/lib/sentiment/types';

interface ScoreBadgeProps {
  score: number;
}

export default function ScoreBadge({ score }: ScoreBadgeProps) {
  const level = getScoreLevel(score);
  const color = getScoreColor(level);
  const label = getScoreLabel(level);

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontFamily: 'var(--font-jetbrains)',
    }}>
      {/* Score number */}
      <span style={{
        fontSize: '22px',
        fontWeight: 700,
        color: 'var(--wr-text)',
        lineHeight: 1,
      }}>
        {score}
      </span>

      {/* Level badge */}
      <span style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        padding: '2px 6px',
        lineHeight: 1.4,
        flexShrink: 0,
      }}>
        {label}
      </span>
    </div>
  );
}
