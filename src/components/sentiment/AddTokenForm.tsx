'use client';

import { useState } from 'react';
import type { WatchlistItem, AnalysisDays, UpdateInterval } from '@/lib/sentiment/types';
import { useSentimentStore } from '@/store/sentimentStore';

interface AddTokenFormProps {
  onClose: () => void;
  onAdded: () => void;
}

const FIELD: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)',
  fontSize: '12px',
  color: 'var(--wr-text)',
  backgroundColor: 'var(--wr-surface-alt)',
  border: '1px solid var(--wr-border)',
  padding: '10px 12px',
  width: '100%',
  outline: 'none',
  boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: 'var(--wr-text-3)',
  display: 'block',
  marginBottom: '6px',
};

const ANALYSIS_DAYS: { label: string; value: AnalysisDays }[] = [
  { label: '1 day', value: 1 },
  { label: '3 days', value: 3 },
  { label: '7 days', value: 7 },
];

const UPDATE_INTERVALS: { label: string; value: UpdateInterval }[] = [
  { label: '15dk', value: '15m' },
  { label: '1sa',  value: '1h' },
  { label: '4sa',  value: '4h' },
  { label: 'Manuel', value: 'manual' },
];

export function AddTokenForm({ onClose, onAdded }: AddTokenFormProps) {
  const [contractAddress, setContractAddress] = useState('');
  const [symbol, setSymbol] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [extraLinks, setExtraLinks] = useState<string[]>([]);
  const [analysisDays, setAnalysisDays] = useState<AnalysisDays>(7);
  const [updateInterval, setUpdateInterval] = useState<UpdateInterval>('1h');

  const addItem = useSentimentStore(s => s.addItem);

  const canSubmit =
    contractAddress.trim().length > 0 &&
    twitterUrl.trim().length > 0;

  const handleAddExtraLink = () => {
    setExtraLinks(prev => [...prev, '']);
  };

  const handleExtraLinkChange = (index: number, value: string) => {
    setExtraLinks(prev => prev.map((link, i) => (i === index ? value : link)));
  };

  const handleRemoveExtraLink = (index: number) => {
    setExtraLinks(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;

    const addr = contractAddress.trim();
    const name = symbol.trim() || `${addr.slice(0, 6)}…${addr.slice(-4)}`;

    const item: WatchlistItem = {
      id: Date.now().toString(),
      type: 'token',
      name,
      contractAddress: addr,
      twitterUrl: twitterUrl.trim(),
      extraLinks: extraLinks.filter(l => l.trim().length > 0),
      analysisDays,
      updateInterval,
      createdAt: new Date().toISOString(),
    };

    addItem(item);
    onAdded();
    onClose();
  };

  const toggleButton = (
    active: boolean,
    onClick: () => void,
    label: string,
  ): React.ReactNode => (
    <button
      key={label}
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-jetbrains)',
        fontSize: '11px',
        fontWeight: 600,
        padding: '5px 12px',
        color: active ? '#000000' : 'var(--wr-text-3)',
        backgroundColor: active ? '#BEFF00' : 'var(--wr-surface-alt)',
        border: `1px solid ${active ? 'var(--wr-accent)' : 'var(--wr-border)'}`,
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 300,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(6px)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: '480px',
          backgroundColor: 'var(--wr-modal)',
          border: '1px solid var(--wr-border-hover)',
          padding: '28px',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)', margin: 0 }}>
            Add Token
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
          Add a token to your sentiment watchlist
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Contract Address */}
          <div>
            <label style={LABEL_STYLE}>Contract Address</label>
            <input
              value={contractAddress}
              onChange={e => setContractAddress(e.target.value)}
              placeholder="So11111111..."
              className="placeholder-[#3a3a3a] focus:border-[#BEFF00] transition-colors"
              style={FIELD}
            />
          </div>

          {/* Name / Symbol */}
          <div>
            <label style={LABEL_STYLE}>
              Name / Symbol{' '}
              <span style={{ color: 'var(--wr-text-4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                (opsiyonel)
              </span>
            </label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="$BONK"
              className="placeholder-[#3a3a3a] focus:border-[#BEFF00] transition-colors"
              style={FIELD}
            />
          </div>

          {/* Twitter URL */}
          <div>
            <label style={LABEL_STYLE}>Twitter URL</label>
            <input
              value={twitterUrl}
              onChange={e => setTwitterUrl(e.target.value)}
              placeholder="https://twitter.com/bonk_inu"
              className="placeholder-[#3a3a3a] focus:border-[#BEFF00] transition-colors"
              style={FIELD}
            />
          </div>

          {/* Extra Links */}
          <div>
            <label style={LABEL_STYLE}>
              Extra Links{' '}
              <span style={{ color: 'var(--wr-text-4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                (opsiyonel)
              </span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {extraLinks.map((link, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    value={link}
                    onChange={e => handleExtraLinkChange(i, e.target.value)}
                    placeholder="https://..."
                    className="placeholder-[#3a3a3a] focus:border-[#BEFF00] transition-colors"
                    style={{ ...FIELD, flex: 1 }}
                  />
                  <button
                    onClick={() => handleRemoveExtraLink(i)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--wr-border)',
                      cursor: 'pointer',
                      color: 'var(--wr-text-3)',
                      fontSize: '14px',
                      lineHeight: 1,
                      padding: '8px 10px',
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={handleAddExtraLink}
                style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--wr-text-3)',
                  backgroundColor: 'var(--wr-surface-alt)',
                  border: '1px dashed var(--wr-border)',
                  padding: '7px 0',
                  cursor: 'pointer',
                  textAlign: 'center',
                  width: '100%',
                }}
              >
                + Add Link
              </button>
            </div>
          </div>

          {/* Analysis Window */}
          <div>
            <label style={LABEL_STYLE}>Analysis Window</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {ANALYSIS_DAYS.map(({ label, value }) =>
                toggleButton(analysisDays === value, () => setAnalysisDays(value), label),
              )}
            </div>
          </div>

          {/* Update Interval */}
          <div>
            <label style={LABEL_STYLE}>Update Interval</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {UPDATE_INTERVALS.map(({ label, value }) =>
                toggleButton(updateInterval === value, () => setUpdateInterval(value), label),
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--wr-text-3)',
                backgroundColor: 'transparent',
                border: '1px solid var(--wr-border)',
                padding: '11px 0',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                flex: 2,
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '13px',
                fontWeight: 700,
                color: canSubmit ? '#000000' : 'var(--wr-text-3)',
                backgroundColor: canSubmit ? '#BEFF00' : 'var(--wr-surface-alt)',
                border: 'none',
                padding: '11px 0',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s',
              }}
            >
              + Add Token
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
