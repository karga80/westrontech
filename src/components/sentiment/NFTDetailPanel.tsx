'use client';

import { useEffect, useRef } from 'react';
import type {
  WatchlistItem,
  ScoreSnapshot,
  TwitterData,
  OpenSeaData,
  WhaleData,
  UpdateInterval,
} from '@/lib/sentiment/types';
import { getScoreLabel, getScoreColor } from '@/lib/sentiment/types';
import { KOLMentionList } from './KOLMentionList';
import { openExternalUrl } from '@/lib/tauri';

interface NFTDetailPanelProps {
  item: WatchlistItem;
  score?: ScoreSnapshot;
  twitter?: TwitterData;
  openSea?: OpenSeaData;
  whale?: WhaleData;
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
    return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--';
  }
}

function formatEth(value: number | undefined): string {
  if (value == null) return '--';
  return `${value.toFixed(2)} ETH`;
}

function formatPct(value: number | undefined, showSign = true): string {
  if (value == null) return '--';
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatCount(value: number | undefined): string {
  if (value == null) return '--';
  return value.toLocaleString('tr-TR');
}

function shortenAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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

export function NFTDetailPanel({
  item,
  score,
  twitter,
  openSea,
  whale,
  onClose,
  onRefresh,
  loading = false,
}: NFTDetailPanelProps) {
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

  const topHolders = whale?.topHolders.slice(0, 5) ?? [];

  return (
    <>
      {/* Backdrop */}
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
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: scoreColor, flexShrink: 0 }}>
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
                  flexShrink: 0,
                }}
              >
                {scoreLabel}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                Son: {lastUpdated}
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
        <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column' }}>

          {/* OPENSEA */}
          <SectionHeader label="OPENSEA" href={item.openSeaUrl} />
          {openSea ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '4px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                <span style={{ color: 'var(--wr-text-3)' }}>Floor: </span>
                <span style={{ fontWeight: 700 }}>{formatEth(openSea.floorPrice)}</span>
                {openSea.floorPriceChange24h !== 0 && (
                  <span style={{
                    color: openSea.floorPriceChange24h > 0 ? 'var(--wr-success)' : 'var(--wr-danger)',
                    marginLeft: '6px',
                  }}>
                    {formatPct(openSea.floorPriceChange24h)}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                <span style={{ color: 'var(--wr-text-3)' }}>Volume 24s: </span>
                {formatEth(openSea.volume24h)}
                {openSea.volumeChange24h !== 0 && (
                  <span style={{
                    color: openSea.volumeChange24h > 0 ? 'var(--wr-success)' : 'var(--wr-danger)',
                    marginLeft: '6px',
                  }}>
                    {formatPct(openSea.volumeChange24h)}
                  </span>
                )}
                <span style={{ color: 'var(--wr-text-3)', margin: '0 6px' }}>|</span>
                <span style={{ color: 'var(--wr-text-3)' }}>Satış: </span>
                {formatCount(openSea.salesCount24h)}
              </div>
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: '0 0 4px' }}>--</p>
          )}

          <HR />

          {/* TWITTER */}
          <SectionHeader label="TWITTER" href={item.twitterUrl} />
          {twitter ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '4px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                <span style={{ color: 'var(--wr-text-3)' }}>Mention: </span>
                {formatCount(twitter.mentionCount)}
                {twitter.mentionVelocity > 1 && (
                  <span style={{ color: 'var(--wr-success)', marginLeft: '6px' }}>
                    ↑ %{Math.round((twitter.mentionVelocity - 1) * 100)}
                  </span>
                )}
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

          {/* WHALE TRACKER */}
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
                WHALE TRACKER
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {topHolders[0]?.etherscanUrl && (
                  <ExternalButton label="Etherscan" href={topHolders[0].etherscanUrl} />
                )}
              </div>
            </div>

            {whale ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                  <span style={{ color: 'var(--wr-text-3)' }}>Top 10 konsantrasyon: </span>
                  <span style={{ fontWeight: 700 }}>%{whale.whaleConcentration.toFixed(1)}</span>
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                  <span style={{ color: 'var(--wr-text-3)' }}>Son 7 gün: </span>
                  <span style={{ color: 'var(--wr-success)' }}>+{whale.whaleMovement7d.entering} giriş</span>
                  {', '}
                  <span style={{ color: 'var(--wr-danger)' }}>-{whale.whaleMovement7d.exiting} çıkış</span>
                </div>

                {/* Top holders list */}
                {topHolders.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    {topHolders.map((holder, i) => (
                      <div
                        key={holder.address}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: 'var(--wr-surface-alt)',
                          border: '1px solid var(--wr-border)',
                          padding: '6px 10px',
                          gap: '8px',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', flexShrink: 0 }}>
                          #{i + 1}
                        </span>
                        <button
                          onClick={() => openExternalUrl(holder.etherscanUrl).catch(() => undefined)}
                          style={{
                            fontFamily: 'var(--font-jetbrains)',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: 'var(--wr-accent)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            flex: 1,
                            textAlign: 'left',
                          }}
                        >
                          {shortenAddress(holder.address)}
                        </button>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text)', flexShrink: 0 }}>
                          {formatCount(holder.tokenCount)} NFT
                        </span>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', flexShrink: 0 }}>
                          %{holder.supplyPercent.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: 0 }}>--</p>
            )}
          </div>
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
            {loading ? 'Yenileniyor…' : 'Yenile'}
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
