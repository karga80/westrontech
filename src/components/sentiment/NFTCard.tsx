'use client';

import { useState } from 'react';
import type { WatchlistItem, ScoreSnapshot } from '@/lib/sentiment/types';
import ScoreBadge from './ScoreBadge';

interface NFTCardProps {
  item: WatchlistItem;
  score?: ScoreSnapshot;
  history?: Array<{ score: number; createdAt: string }>;
  floorPrice?: number;
  loading?: boolean;
  onClick: () => void;
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'az önce';
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} sa önce`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} gün önce`;
}

function truncateAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function NFTCard({ item, score, history, floorPrice, loading, onClick }: NFTCardProps) {
  const [hovered, setHovered] = useState(false);

  const trendArrow = (() => {
    if (!history || history.length < 2) return null;
    const latest = history[history.length - 1].score;
    const prev   = history[history.length - 2].score;
    if (latest > prev) return { symbol: '↑', color: 'var(--wr-success)' };
    if (latest < prev) return { symbol: '↓', color: 'var(--wr-danger)' };
    return null;
  })();

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '220px',
        backgroundColor: 'var(--wr-surface)',
        border: `1px solid ${hovered ? 'var(--wr-border-hover)' : 'var(--wr-border)'}`,
        padding: '16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top: name + type badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{
          fontFamily: 'var(--font-jetbrains)',
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--wr-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {item.name || truncateAddress(item.contractAddress)}
        </span>
        <span style={{
          fontFamily: 'var(--font-jetbrains)',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: '#818CF8',
          border: '1px solid #818CF8',
          padding: '2px 6px',
          flexShrink: 0,
        }}>
          NFT
        </span>
      </div>

      {/* Middle: score or placeholder */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {loading ? (
          <span style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '11px',
            color: 'var(--wr-text-3)',
          }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'var(--wr-accent)',
            }} />
            {' '}yükleniyor…
          </span>
        ) : score ? (
          <ScoreBadge score={score.score} />
        ) : (
          <span style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--wr-text-3)',
          }}>--</span>
        )}

        {trendArrow && (
          <span style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '16px',
            fontWeight: 700,
            color: trendArrow.color,
            lineHeight: 1,
          }}>
            {trendArrow.symbol}
          </span>
        )}
      </div>

      {/* Floor price row */}
      <div style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: '10px',
        color: 'var(--wr-text-3)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span style={{ color: 'var(--wr-text-4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Floor</span>
        <span style={{ color: floorPrice != null ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>
          {floorPrice != null ? `${floorPrice} ETH` : '--'}
        </span>
      </div>

      {/* Bottom: last updated */}
      <div style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: '10px',
        color: 'var(--wr-text-3)',
      }}>
        {loading ? (
          'güncelleniyor…'
        ) : item.lastUpdated ? (
          formatRelativeTime(item.lastUpdated)
        ) : (
          'henüz güncellenmedi'
        )}
      </div>
    </div>
  );
}
