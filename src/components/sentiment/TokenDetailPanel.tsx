'use client';

import { useEffect, useRef } from 'react';
import type {
  WatchlistItem,
  ScoreSnapshot,
  TwitterData,
  OnChainData,
  PriceData,
  UpdateInterval,
} from '@/lib/sentiment/types';
import { getScoreLabel, getScoreColor } from '@/lib/sentiment/types';
import { KOLMentionList } from './KOLMentionList';
import { openExternalUrl } from '@/lib/tauri';

interface TokenDetailPanelProps {
  item: WatchlistItem;
  score?: ScoreSnapshot;
  twitter?: TwitterData;
  onchain?: OnChainData;
  price?: PriceData;
  onClose: () => void;
  onRefresh: () => void;
  loading?: boolean;
}

const INTERVAL_LABELS: Record<UpdateInterval, string> = {
  '15m':    '15dk',
  '1h':     '1sa',
  '4h':     '4sa',
  'manual': 'Manuel',
};

function formatTime(iso: string | undefined): string {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--';
  }
}

function formatPrice(value: number | undefined): string {
  if (value == null) return '--';
  if (value < 0.0001) return value.toExponential(4);
  if (value < 1)      return value.toFixed(6);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLargeNumber(value: number | undefined): string {
  if (value == null) return '--';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000)         return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number | undefined, showSign = true): string {
  if (value == null) return '--';
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatCount(value: number | undefined): string {
  if (value == null) return '--';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-US');
}

function HR() {
  return (
    <hr style={{ border: 'none', borderTop: '1px solid var(--wr-border)', margin: '12px 0' }} />
  );
}

function SectionHeader({ label, href }: { label: string; href?: string }) {
  const handleLink = () => {
    if (href) openExternalUrl(href).catch(() => undefined);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
      <span style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '1px',
        color: 'var(--wr-text-3)',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      {href && (
        <button
          onClick={handleLink}
          style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '9px',
            fontWeight: 600,
            color: 'var(--wr-accent)',
            background: 'none',
            border: '1px solid var(--wr-border)',
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          link ↗
        </button>
      )}
    </div>
  );
}

function ExternalButton({ label, href }: { label: string; href: string }) {
  const handleClick = () => {
    openExternalUrl(href).catch(() => undefined);
  };
  return (
    <button
      onClick={handleClick}
      style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: '9px',
        fontWeight: 600,
        color: 'var(--wr-accent)',
        background: 'none',
        border: '1px solid var(--wr-border)',
        cursor: 'pointer',
        padding: '2px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {label} ↗
    </button>
  );
}

export function TokenDetailPanel({
  item,
  score,
  twitter,
  onchain,
  price,
  onClose,
  onRefresh,
  loading = false,
}: TokenDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const scoreLevel  = score?.level;
  const scoreColor  = scoreLevel ? getScoreColor(scoreLevel) : 'var(--wr-text-3)';
  const scoreLabel  = scoreLevel ? getScoreLabel(scoreLevel) : '--';
  const scoreValue  = score?.score != null ? score.score : '--';
  const lastUpdated = formatTime(item.lastUpdated ?? score?.computedAt);

  return (
    <>
      {/* Backdrop — click outside closes */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 200,
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '420px',
          height: '100vh',
          backgroundColor: 'var(--wr-surface)',
          borderLeft: '1px solid var(--wr-border)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '14px 16px 12px',
            borderBottom: '1px solid var(--wr-border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: scoreColor }}>
                {scoreValue}/100
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  color: scoreColor,
                  border: `1px solid ${scoreColor}`,
                  padding: '1px 5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {scoreLabel}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap' }}>
                Last: {lastUpdated}
              </span>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: 0 }}>

          {/* TWITTER */}
          <SectionHeader label="TWITTER" href={item.twitterUrl} />
          {twitter ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '4px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                <span style={{ color: 'var(--wr-text-3)' }}>Mentions: </span>
                {formatCount(twitter.mentionCount)}
                {twitter.mentionVelocity > 1 && (
                  <span style={{ color: 'var(--wr-success)', marginLeft: '6px' }}>
                    ↑ %{Math.round((twitter.mentionVelocity - 1) * 100)}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                <span style={{ color: 'var(--wr-text-3)' }}>Sentiment: </span>
                <span style={{ color: 'var(--wr-success)' }}>{twitter.sentimentBreakdown.positive}% positive</span>
                {' · '}
                <span style={{ color: 'var(--wr-danger)' }}>{twitter.sentimentBreakdown.negative}% negative</span>
                {' · '}
                <span style={{ color: 'var(--wr-text-3)' }}>{twitter.sentimentBreakdown.neutral}% neutral</span>
              </div>
              <div style={{ marginTop: '6px' }}>
                <div style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  color: 'var(--wr-text-3)',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                }}>
                  KOL Mentions ({twitter.kolMentions.length})
                </div>
                <KOLMentionList mentions={twitter.kolMentions} maxVisible={5} />
              </div>
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: '0 0 4px' }}>--</p>
          )}

          <HR />

          {/* ON-CHAIN */}
          <div style={{ marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '1px',
                color: 'var(--wr-text-3)',
                textTransform: 'uppercase',
              }}>
                ON-CHAIN
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {onchain?.solscanUrl && <ExternalButton label="Solscan" href={onchain.solscanUrl} />}
                {onchain?.birdeyeUrl && <ExternalButton label="Birdeye" href={onchain.birdeyeUrl} />}
              </div>
            </div>
            {onchain ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                  <span style={{ color: 'var(--wr-text-3)' }}>Holder: </span>
                  {formatCount(onchain.holderCount)}
                  {onchain.holderChange24h !== 0 && (
                    <span style={{ color: onchain.holderChange24h > 0 ? 'var(--wr-success)' : 'var(--wr-danger)', marginLeft: '6px' }}>
                      {onchain.holderChange24h > 0 ? '+' : ''}{formatCount(onchain.holderChange24h)}{' '}
                      ({formatPct(onchain.holderChangePct24h)})
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                  <span style={{ color: 'var(--wr-text-3)' }}>Buy/Sell: </span>
                  <span style={{ color: onchain.buySellRatio >= 1 ? 'var(--wr-success)' : 'var(--wr-danger)' }}>
                    {onchain.buySellRatio.toFixed(1)}x
                  </span>
                  {' '}
                  <span style={{ color: 'var(--wr-text-3)' }}>
                    {onchain.buySellRatio >= 1 ? 'buy-heavy' : 'sell-heavy'}
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: 0 }}>--</p>
            )}
          </div>

          <HR />

          {/* FIYAT */}
          <SectionHeader label="PRICE" />
          {price ? (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', lineHeight: 1.8 }}>
              <span style={{ fontWeight: 700 }}>${formatPrice(price.currentPrice)}</span>
              {price.priceChange24h !== 0 && (
                <span style={{
                  color: price.priceChange24h > 0 ? 'var(--wr-success)' : 'var(--wr-danger)',
                  marginLeft: '8px',
                }}>
                  {formatPct(price.priceChange24h)}
                </span>
              )}
              <span style={{ color: 'var(--wr-text-3)', margin: '0 6px' }}>•</span>
              <span style={{ color: 'var(--wr-text-3)' }}>Vol 24h: </span>
              {formatLargeNumber(price.volume24h)}
              <span style={{ color: 'var(--wr-text-3)', margin: '0 6px' }}>•</span>
              <span style={{ color: 'var(--wr-text-3)' }}>MCap: </span>
              {formatLargeNumber(price.marketCap)}
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: 0 }}>--</p>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--wr-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '11px',
              fontWeight: 700,
              color: loading ? 'var(--wr-text-3)' : '#000000',
              backgroundColor: loading ? 'var(--wr-surface-alt)' : '#BEFF00',
              border: 'none',
              padding: '8px 20px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s',
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span
            style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '10px',
              color: 'var(--wr-text-3)',
              backgroundColor: 'var(--wr-surface-alt)',
              border: '1px solid var(--wr-border)',
              padding: '4px 8px',
            }}
          >
            {INTERVAL_LABELS[item.updateInterval]}
          </span>
        </div>
      </div>
    </>
  );
}
