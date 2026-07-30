'use client';

import { useState } from 'react';
import {
  findSisterWallets,
  type SisterReport,
  type SisterCandidate,
  type SisterReason,
} from '@/lib/tauri';

// Human-readable labels for each match reason.
const REASON_LABEL: Record<SisterReason, string> = {
  common_funder: 'Same funder',
  round_trip:    'Two-way transfers',
  funded_target: 'Funded this wallet',
  target_funded: 'Funded by this wallet',
};

const REASON_COLOR: Record<SisterReason, string> = {
  common_funder: '#7c5cff',
  round_trip:    '#7DD3FC',
  funded_target: '#ffb020',
  target_funded: '#C4B5FD',
};

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function fmtDate(ts?: number | null) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function scoreColor(s: number) {
  if (s >= 70) return '#7c5cff';
  if (s >= 40) return '#ffb020';
  return 'var(--wr-text-3)';
}

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)',
};

const INPUT: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text)',
  backgroundColor: 'var(--wr-bg)', border: '1px solid var(--wr-border)',
  outline: 'none', padding: '10px 12px', flex: 1, minWidth: 0,
};

export default function SisterWalletFinder() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SisterReport | null>(null);

  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  async function run() {
    const addr = address.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setError('Enter a valid Ethereum address (0x… , 42 characters).');
      return;
    }
    if (!inTauri) {
      setError('The sister-wallet finder needs the desktop app (it queries Etherscan directly).');
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const r = await findSisterWallets(addr);
      setReport(r);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)', padding: '20px 22px', marginBottom: '28px' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: '4px' }}>
        <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '15px', fontWeight: 600, color: 'var(--wr-text)' }}>
          Sister Wallet Finder
        </h2>
        <span style={{ ...LABEL, color: 'var(--wr-text-3)' }}>Etherscan · ETH mainnet</span>
      </div>
      <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '16px', lineHeight: 1.5 }}>
        Enter any address to find likely side wallets of the same owner — based on shared funding
        source and direct on-chain transfers. Leads, not proof.
      </p>

      <div className="flex items-center" style={{ gap: '8px', marginBottom: report || error ? '18px' : 0 }}>
        <input
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(); }}
          placeholder="0x…"
          spellCheck={false}
          style={INPUT}
        />
        <button
          onClick={run}
          disabled={loading}
          style={{
            fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700,
            color: '#000', backgroundColor: loading ? 'var(--wr-text-3)' : '#7c5cff',
            border: 'none', padding: '10px 20px', cursor: loading ? 'default' : 'pointer',
            letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Scanning…' : 'Find sisters'}
        </button>
      </div>

      {error && (
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#ff8a96', border: '1px solid #ff8a96', padding: '10px 12px' }}>
          {error}
        </div>
      )}

      {report && (
        <div>
          {report.funder && (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '10px' }}>
              First funded by{' '}
              <span style={{ color: 'var(--wr-text)' }}>{short(report.funder)}</span>
            </div>
          )}
          {report.note && (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ffb020', border: '1px solid #2a1e05', backgroundColor: '#1a1200', padding: '8px 10px', marginBottom: '14px', lineHeight: 1.5 }}>
              {report.note}
            </div>
          )}

          {report.candidates.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', padding: '12px 0' }}>
              No linked wallets found from on-chain activity.
            </div>
          ) : (
            <>
              <div style={{ ...LABEL, marginBottom: '10px' }}>
                {report.candidates.length} candidate{report.candidates.length !== 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', backgroundColor: 'var(--wr-border)' }}>
                {report.candidates.map((c: SisterCandidate) => (
                  <div key={c.address} className="flex items-center" style={{ gap: '14px', backgroundColor: 'var(--wr-surface)', padding: '11px 12px' }}>
                    <div style={{ width: '42px', textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '16px', fontWeight: 700, color: scoreColor(c.score), lineHeight: 1 }}>
                        {c.score}
                      </div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', color: 'var(--wr-text-3)', letterSpacing: '0.5px' }}>SCORE</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center" style={{ gap: '8px', marginBottom: '5px' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text)' }}>{short(c.address)}</span>
                        <a
                          href={`https://etherscan.io/address/${c.address}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textDecoration: 'none' }}
                        >
                          etherscan ↗
                        </a>
                      </div>
                      <div className="flex items-center" style={{ gap: '6px', flexWrap: 'wrap' }}>
                        {c.reasons.map(r => (
                          <span key={r} style={{
                            fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                            color: REASON_COLOR[r], border: `1px solid ${REASON_COLOR[r]}`,
                            padding: '2px 6px', letterSpacing: '0.3px',
                          }}>
                            {REASON_LABEL[r]}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                      <div>{c.direct_in + c.direct_out} direct tx</div>
                      <div>{fmtDate(c.first_interaction)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
