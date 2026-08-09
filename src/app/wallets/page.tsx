'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  getPortfolioSnapshot, loadAlchemyKey, importWallet,
  type PortfolioSnapshot,
} from '@/lib/tauri';
import {
  loadWallets, saveWallets, addWallet as persistWallet, removeWallet as deleteWalletFromStore,
  updateWallet as updateWalletInStore, type StoredWallet,
} from '@/lib/walletStore';
import { deriveAddress, normalizeKey } from '@/lib/walletImport';
import { EMPTY_SNAPSHOT } from '@/lib/emptyData';
import { Tag, WALLET_TOKEN_VARIANT } from '@/components/Tag';
import SisterWalletFinder from '@/components/SisterWalletFinder';
import DistributeModal from '@/components/DistributeModal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Wallet {
  id: string; name: string; address: string; rawAddress: string;
  badge: string;
  usdValue: number; change: number; changePct: number;
  nfts: number; floorPnl: number; coins: number; pnl: number;
}

function buildWallet(stored: StoredWallet, snap: PortfolioSnapshot | null): Wallet {
  return {
    id: stored.id,
    name: stored.name,
    address: stored.address.length > 12
      ? `${stored.address.slice(0, 6)}…${stored.address.slice(-4)}`
      : stored.address,
    rawAddress: stored.address,
    badge: 'ETH',
    usdValue:  snap?.portfolio_value_usd ?? 0,
    change:    0,
    changePct: 0,
    nfts:      snap?.nft_count ?? 0,
    floorPnl:  0,
    coins:     snap?.token_count ?? 0,
    pnl:       0,
  };
}

// Direction colour: green up / red down. Purple is brand-only, never data.
function pnlColor(n: number) { return n >= 0 ? 'var(--wr-buy-text)' : 'var(--wr-sell-text)'; }
function pnlText(n: number) {
  const abs = Math.abs(n).toLocaleString();
  return n >= 0 ? `+$${abs}` : `-$${abs}`;
}

// ─── Modal Backdrop ─────────────────────────────────────────────────────────

function ModalBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[300]"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

// ─── Delete Confirm Modal ────────────────────────────────────────────────────

function DeleteModal({ wallet, onConfirm, onClose }: {
  wallet: Wallet;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalBackdrop onClose={onClose}>
      <div
        style={{ width: '380px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Remove Wallet</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', lineHeight: '1.6' }}>
          Remove <span style={{ color: 'var(--wr-text)' }}>{wallet.name}</span> ({wallet.address}) from Westron?
          <br />This does not delete the wallet — your funds remain safe.
        </p>

        <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid #2b070c', padding: '10px 14px', marginBottom: '20px' }}>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', lineHeight: '1.6' }}>
            If you imported a private key, it will be removed from macOS Keychain.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{
            flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
            color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
            padding: '11px 0', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
            color: 'var(--wr-text)', backgroundColor: '#2b070c', border: '1px solid #ff8a96',
            padding: '11px 0', cursor: 'pointer',
          }}>Remove Wallet</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Add Wallet Modal ────────────────────────────────────────────────────────

type AddWalletTab = 'import' | 'watch';

function AddWalletModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [tab, setTab] = useState<AddWalletTab>('import');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  const FIELD: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)',
    padding: '10px 12px', width: '100%', outline: 'none',
  };
  const LABEL: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)',
    display: 'block', marginBottom: '6px',
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ width: '420px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Add Wallet</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
          Import an Ethereum wallet or add a watch-only address
        </p>

        <div className="flex" style={{ borderBottom: '1px solid var(--wr-border)', marginBottom: '20px' }}>
          {([['import', 'Import Key'], ['watch', 'Watch Address']] as [AddWalletTab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
              padding: '8px 16px', marginBottom: '-1px',
              color: tab === t ? 'var(--wr-accent)' : '#6e7590',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--wr-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={LABEL}>Wallet Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Main Wallet"
              className="placeholder-[#232533] focus:border-[#7c5cff]"
              style={FIELD} />
          </div>

          {tab === 'import' ? (
            <>
              <div>
                <label style={LABEL}>Wallet Address</label>
                <input value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="0x..."
                  className="placeholder-[#232533] focus:border-[#7c5cff]"
                  style={FIELD} />
              </div>
              <div>
                <label style={LABEL}>Private Key</label>
                <input type="password" value={key} onChange={e => setKey(e.target.value)}
                  placeholder="0x..."
                  className="placeholder-[#232533] focus:border-[#7c5cff]"
                  style={FIELD} />
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px' }}>
                  Your key never leaves this device.
                </div>
              </div>
            </>
          ) : (
            <div>
              <label style={LABEL}>Wallet Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)}
                placeholder="0x..."
                className="placeholder-[#232533] focus:border-[#7c5cff]"
                style={FIELD} />
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px' }}>
                Watch-only wallets are read-only — no signing.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button onClick={onClose} style={{
              flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
              color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
              padding: '11px 0', cursor: 'pointer',
            }}>Cancel</button>
            {importError && (
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '-6px' }}>{importError}</div>
            )}
            <button
              disabled={importing}
              onClick={async () => {
                setImportError('');
                const addr = tab === 'import' ? address.trim() : address.trim();
                if (!addr || !name.trim()) return;
                if (tab === 'import') {
                  if (!key.trim()) return;
                  setImporting(true);
                  try {
                    // Address is derived from the key, never taken from the form.
                    const cleanKey = normalizeKey(key);
                    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
                    // The address is derived from the key, never taken from the form.
                    let resolved = await deriveAddress(key);
                    if (inTauri) resolved = await importWallet({ private_key_hex: cleanKey });
                    if (addr && addr.toLowerCase() !== resolved.toLowerCase()) {
                      setImportError(`Imported as ${resolved} — derived from the private key.`);
                    }
                    persistWallet({ id: Date.now().toString(), name: name.trim(), address: resolved, kind: 'owned' });
                    onAdded();
                    onClose();
                  } catch (e) {
                    setImportError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setImporting(false);
                  }
                } else {
                  persistWallet({ id: Date.now().toString(), name: name.trim(), address: addr, kind: 'watched' });
                  onAdded();
                  onClose();
                }
              }}
              style={{
                flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                color: '#0b0c14', backgroundColor: importing ? '#8aaa00' : '#7c5cff', border: 'none',
                padding: '11px 0', cursor: importing ? 'not-allowed' : 'pointer',
              }}
            >{importing ? 'Importing…' : tab === 'import' ? 'Import Wallet' : 'Add Watch Wallet'}</button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Edit Wallet Modal ───────────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function EditWalletModal({ wallet, allWallets, onClose, onSaved }: {
  wallet: Wallet;
  allWallets: StoredWallet[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(wallet.name);
  const [address, setAddress] = useState(wallet.rawAddress);
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();

    if (!trimmedName) { setError('Wallet name is required.'); return; }

    const addressChanged = trimmedAddress.toLowerCase() !== wallet.rawAddress.toLowerCase();
    if (addressChanged && !ETH_ADDRESS_RE.test(trimmedAddress)) {
      setError('Invalid Ethereum address.'); return;
    }

    const duplicate = allWallets.some(
      w => w.id !== wallet.id && w.address.toLowerCase() === trimmedAddress.toLowerCase()
    );
    if (duplicate) { setError('This address is already tracked.'); return; }

    updateWalletInStore(wallet.id, { name: trimmedName, address: trimmedAddress });
    onSaved();
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '13px',
    color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)',
    border: '1px solid var(--wr-border)', padding: '10px 12px',
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        style={{ width: '400px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: '20px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Edit Wallet</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>
            Wallet Name
          </label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Main Wallet"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>
            Wallet Address
          </label>
          <input
            value={address}
            onChange={e => { setAddress(e.target.value); setError(''); }}
            placeholder="0x..."
            style={{ ...inputStyle, fontFamily: 'var(--font-jetbrains)', letterSpacing: '0.3px' }}
          />
        </div>

        {error && (
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{
            flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
            color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
            padding: '11px 0', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
            color: '#0b0c14', backgroundColor: '#7c5cff', border: 'none',
            padding: '11px 0', cursor: 'pointer',
          }}>Save Changes</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Distribute Funds Modal ──────────────────────────────────────────────────

// ─── Wallet Card ─────────────────────────────────────────────────────────────

function WalletCard({ w, loading, onDelete, onEdit }: { w: Wallet; loading?: boolean; onDelete: () => void; onEdit: () => void }) {
  const chg = pnlColor(w.change);
  return (
    <div
      className="flex flex-col border transition-all duration-150"
      style={{ height: '239px', backgroundColor: 'var(--wr-surface)', borderColor: 'var(--wr-border)', position: 'relative' }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--wr-border-hover)';
        el.style.backgroundColor = 'var(--wr-hover-bg)';
        el.style.boxShadow = '0 6px 28px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--wr-border)';
        el.style.backgroundColor = 'var(--wr-surface)';
        el.style.boxShadow = 'none';
      }}
    >
      {loading && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'var(--wr-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#555', letterSpacing: '2px' }}>LOADING…</span>
        </div>
      )}

      <Link href={`/wallet/detail?id=${w.id}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px', paddingBottom: '12px', textDecoration: 'none', minHeight: 0 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)' }}>{w.name}</span>
          <Tag variant={WALLET_TOKEN_VARIANT[w.badge] ?? 'neutral'}>{w.badge}</Tag>
        </div>
        <div className="flex items-center gap-1" style={{ marginBottom: '8px' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{w.address}</span>
          {/* External link — NOT an <a> (would nest inside the card's Link and
              break hydration). Opens the system browser, swallows the click. */}
          <span
            role="link"
            tabIndex={0}
            title="View on Etherscan"
            onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(`https://etherscan.io/address/${w.rawAddress}`, '_blank', 'noopener,noreferrer'); }}
            className="shrink-0 text-[#6e7590] hover:text-[#9298b8] transition-colors flex cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
        </div>
        <div style={{ marginBottom: '4px' }}>
          <div style={{ fontFamily: 'var(--font-inter)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>
            ${w.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center" style={{ gap: '4px' }}>
            <span style={{ color: chg, fontSize: '10px' }}>{w.change >= 0 ? '↑' : '↓'}</span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: chg, fontVariantNumeric: 'tabular-nums' }}>
              {w.change >= 0 ? '+' : ''}${Math.abs(w.change).toLocaleString()} ({w.change >= 0 ? '+' : ''}{w.changePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex items-start mt-auto pt-3" style={{ borderTop: '1px solid var(--wr-border)', gap: '0' }}>
          <div className="flex flex-1" style={{ gap: '20px' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>NFTs</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>{w.nfts}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Floor PnL</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: pnlColor(w.floorPnl), fontVariantNumeric: 'tabular-nums' }}>{pnlText(w.floorPnl)}</div>
            </div>
          </div>
          <div style={{ width: '1px', backgroundColor: 'var(--wr-border-hover)', alignSelf: 'stretch', margin: '0 16px' }} />
          <div className="flex flex-1" style={{ gap: '20px' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>COINS</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>{w.coins}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>PnL</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: pnlColor(w.pnl), fontVariantNumeric: 'tabular-nums' }}>{pnlText(w.pnl)}</div>
            </div>
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      <div className="flex" style={{ borderTop: '1px solid var(--wr-border)', height: '27px' }}>
        <Link
          href={`/wallet/detail?id=${w.id}`}
          className="flex-1 h-full flex items-center justify-center"
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', borderRight: '1px solid var(--wr-border)', textDecoration: 'none' }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'var(--wr-hover-bg)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--wr-accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--wr-text)'; }}
        >
          View
        </Link>
        <button
          className="flex-1 h-full cursor-pointer"
          onClick={e => { e.preventDefault(); onEdit(); }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-hover-bg)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', borderRight: '1px solid var(--wr-border)', borderRadius: 0, transition: 'background-color 0.12s, color 0.12s' }}
        >
          Edit
        </button>
        <button
          className="flex-1 h-full cursor-pointer"
          onClick={e => { e.preventDefault(); onDelete(); }}
          onMouseEnter={e => { const isDay = document.documentElement.getAttribute('data-theme') === 'day'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDay ? 'var(--wr-danger-bg)' : '#2b070c'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-danger)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-danger)'; }}
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-danger)', backgroundColor: 'transparent', border: 'none', borderRadius: 0, transition: 'background-color 0.12s, color 0.12s' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WalletsPage() {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showDistribute, setShowDistribute] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Wallet | null>(null);
  const [editTarget, setEditTarget] = useState<Wallet | null>(null);

  const [storedWallets, setStoredWallets] = useState<StoredWallet[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, PortfolioSnapshot>>({});
  const [loadingData, setLoadingData] = useState(true);

  const refresh = () => setStoredWallets(loadWallets());

  useEffect(() => {
    const wallets = loadWallets();
    setStoredWallets(wallets);

    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!inTauri) {
      // Browser mode (no Tauri backend) — show empty state, no API calls possible
      const emptySnaps: Record<string, PortfolioSnapshot> = {};
      wallets.forEach(w => { emptySnaps[w.id] = EMPTY_SNAPSHOT; });
      setSnapshots(emptySnaps);
      setLoadingData(false);
      return;
    }

    (async () => {
      try {
        const key = await loadAlchemyKey();
        if (!key) { setLoadingData(false); return; }
        const results = await Promise.allSettled(
          wallets.map(w => getPortfolioSnapshot(w.address, key))
        );
        const snaps: Record<string, PortfolioSnapshot> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') snaps[wallets[i].id] = r.value;
        });
        setSnapshots(snaps);
      } catch { /* silent */ } finally {
        setLoadingData(false);
      }
    })();
  }, []);

  const wallets: Wallet[] = storedWallets.map((sw) =>
    buildWallet(sw, snapshots[sw.id] ?? null)
  );

  const totalValue = wallets.reduce((acc, w) => acc + w.usdValue, 0);
  const totalNfts  = wallets.reduce((acc, w) => acc + w.nfts, 0);
  const totalCoins = wallets.reduce((acc, w) => acc + w.coins, 0);

  const handleDelete = (w: Wallet) => setDeleteTarget(w);
  const handleEdit = (w: Wallet) => setEditTarget(w);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteWalletFromStore(deleteTarget.id);
    setStoredWallets(loadWallets());
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: 'var(--wr-bg)' }}>
      <div style={{ flex: 1, padding: '32px 48px' }}>


        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: '28px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-inter)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '4px' }}>Wallets</h1>
            <div className="flex items-center" style={{ gap: '20px' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                {wallets.length} wallet{wallets.length !== 1 ? 's' : ''}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                Total: <span style={{ color: 'var(--wr-text)' }}>${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                {totalNfts} NFTs · {totalCoins} coins
              </span>
            </div>
          </div>
          <div className="flex items-center" style={{ gap: '8px' }}>
            <button
              onClick={() => setShowDistribute(true)}
              style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600,
                color: 'var(--wr-accent)', backgroundColor: 'transparent',
                border: '1px solid var(--wr-accent)', padding: '9px 18px', cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-accent-dim)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
            >
              ⇄ Distribute Funds
            </button>
            <button
              onClick={() => setShowAddWallet(true)}
              style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700,
                color: '#0b0c14', backgroundColor: '#7c5cff',
                border: 'none', padding: '10px 20px', cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#5b3df0'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7c5cff'; }}
            >
              + Add Wallet
            </button>
          </div>
        </div>

        <SisterWalletFinder />

        {/* Wallet grid */}
        {wallets.length === 0 ? (
          <div className="flex flex-col items-center justify-center" style={{ paddingTop: '120px', gap: '16px' }}>
            <div style={{ width: '56px', height: '56px', border: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: 'var(--wr-text-4)' }}>◈</div>
            <div style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 500, color: 'var(--wr-text-3)' }}>No wallets yet</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-4)' }}>Add a wallet to get started</div>
            <button onClick={() => setShowAddWallet(true)} style={{ marginTop: '8px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#0b0c14', backgroundColor: '#7c5cff', border: 'none', padding: '10px 24px', cursor: 'pointer' }}>
              + Add Wallet
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {wallets.map(w => (
              <WalletCard key={w.id} w={w} loading={loadingData} onDelete={() => handleDelete(w)} onEdit={() => handleEdit(w)} />
            ))}
            {/* Add wallet card */}
            <button
              onClick={() => setShowAddWallet(true)}
              className="flex flex-col items-center justify-center border transition-all duration-150"
              style={{ height: '239px', backgroundColor: 'transparent', borderColor: 'var(--wr-border)', borderStyle: 'dashed', cursor: 'pointer', gap: '10px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-accent)'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-accent-dim)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
            >
              <span style={{ fontSize: '28px', color: 'var(--wr-text-4)' }}>+</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-4)', letterSpacing: '1px', textTransform: 'uppercase' }}>Add Wallet</span>
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddWallet && (
        <AddWalletModal onClose={() => setShowAddWallet(false)} onAdded={refresh} />
      )}
      {showDistribute && (
        <DistributeModal
          wallets={wallets.map(w => ({ id: w.id, name: w.name, address: w.rawAddress || w.address, usdValue: w.usdValue }))}
          skin="wallets"
          onClose={() => setShowDistribute(false)}
        />
      )}
      {deleteTarget && (
        <DeleteModal wallet={deleteTarget} onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />
      )}
      {editTarget && (
        <EditWalletModal
          wallet={editTarget}
          allWallets={storedWallets}
          onClose={() => setEditTarget(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
