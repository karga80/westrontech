'use client';

import { useState } from 'react';
import type { KOLMention } from '@/lib/sentiment/types';
import { openExternalUrl } from '@/lib/tauri';

interface KOLMentionListProps {
  mentions: KOLMention[];
  maxVisible?: number;
}

function formatFollowers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000)     return `${(count / 1_000).toFixed(0)}K`;
  return count.toString();
}

function formatCount(count: number): string {
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function KOLMentionList({ mentions, maxVisible = 5 }: KOLMentionListProps) {
  const [showAll, setShowAll] = useState(false);

  const sorted = [...mentions].sort((a, b) => b.followerCount - a.followerCount);
  const visible = showAll ? sorted : sorted.slice(0, maxVisible);
  const hasMore = sorted.length > maxVisible;

  if (sorted.length === 0) {
    return (
      <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: 0 }}>
        Henüz KOL mention yok
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {visible.map((kol, i) => (
        <KOLMentionRow key={`${kol.handle}-${i}`} kol={kol} />
      ))}

      {hasMore && (
        <button
          onClick={() => setShowAll(prev => !prev)}
          style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.5px',
            color: 'var(--wr-accent)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            textAlign: 'left',
          }}
        >
          {showAll
            ? '▲ Daha az göster'
            : `▼ ${sorted.length - maxVisible} daha göster`}
        </button>
      )}
    </div>
  );
}

function KOLMentionRow({ kol }: { kol: KOLMention }) {
  const handleTweetLink = () => {
    openExternalUrl(kol.tweetUrl).catch(() => undefined);
  };

  const preview =
    kol.tweetText.length > 120
      ? `${kol.tweetText.slice(0, 120)}…`
      : kol.tweetText;

  return (
    <div
      style={{
        backgroundColor: 'var(--wr-surface-alt)',
        border: '1px solid var(--wr-border)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {/* Row 1: avatar + handle + follower count + stats + link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Avatar */}
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: 'var(--wr-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: '#000000', lineHeight: 1 }}>
            {getInitials(kol.displayName)}
          </span>
        </div>

        {/* Handle + name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: 'var(--wr-text)' }}>
              @{kol.handle}
            </span>
            {kol.isManualList && (
              <span
                style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '9px',
                  fontWeight: 700,
                  color: '#000000',
                  backgroundColor: 'var(--wr-accent)',
                  padding: '1px 4px',
                  lineHeight: 1.4,
                }}
              >
                ★
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
              {kol.displayName}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
            {formatFollowers(kol.followerCount)} takipçi
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
            ❤ {formatCount(kol.likes)}
          </span>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
            ↺ {formatCount(kol.retweets)}
          </span>
          <button
            onClick={handleTweetLink}
            style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.5px',
              color: 'var(--wr-accent)',
              background: 'none',
              border: '1px solid var(--wr-border)',
              cursor: 'pointer',
              padding: '2px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            tweet ↗
          </button>
        </div>
      </div>

      {/* Row 2: tweet preview */}
      <p
        style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '11px',
          color: 'var(--wr-text-3)',
          margin: 0,
          lineHeight: 1.5,
          paddingLeft: '36px',
        }}
      >
        {preview}
      </p>
    </div>
  );
}
