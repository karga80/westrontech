'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { importWallet } from '@/lib/tauri';
import { addWallet, loadWallets } from '@/lib/walletStore';
import { useTheme } from '@/lib/themeContext';

// ─── Login / Onboarding — Westron native key import ───────────────────────────

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Step = 'home' | 'import' | 'watch';

function isValidAddress(s: string) { return /^0x[0-9a-fA-F]{40}$/.test(s.trim()); }
function isValidKey(s: string)     { return /^(0x)?[0-9a-fA-F]{64}$/.test(s.trim()); }

export default function LoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDay = theme === 'day';
  const [step, setStep] = useState<Step>('home');

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: 'var(--wr-bg)' }}
    >
      {/* macOS traffic-light drag region */}
      <div className="fixed top-0 left-0 right-0 h-8" data-tauri-drag-region />

      {/* Brand */}
      <div className="flex flex-col items-center" style={{ marginBottom: '40px', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Image src="/logo-mark.png" alt="" width={320} height={361}
            style={{ height: '36px', width: 'auto' }} priority />
          <span style={{
            fontFamily: 'var(--font-bellota)',
            fontSize: '28px',
            fontWeight: 700,
            letterSpacing: '5px',
            color: 'var(--wr-text)',
            textTransform: 'uppercase',
            lineHeight: 1,
          }}>WESTRON</span>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
          Ethereum portfolio & NFT trading — keys stay on your machine
        </p>
      </div>

      <div style={{ width: '420px' }}>
        {step === 'home'   && <HomeStep   isDay={isDay} onImport={() => setStep('import')} onWatch={() => setStep('watch')} />}
        {step === 'import' && <ImportStep onBack={() => setStep('home')} onDone={() => router.push('/')} />}
        {step === 'watch'  && <WatchStep  onBack={() => setStep('home')} onDone={() => router.push('/')} />}
      </div>
    </main>
  );
}

// ─── Home Step ────────────────────────────────────────────────────────────────

function HomeStep({ isDay, onImport, onWatch }: { isDay: boolean; onImport: () => void; onWatch: () => void }) {
  const existingWallets = typeof window !== 'undefined' ? loadWallets() : [];
  const hasWallets = existingWallets.length > 0 && existingWallets[0].address !== '0x3f4a6b2d8e1c9f7a5b3e4d6c2a1f8b3d4e5c6a91c';

  return (
    <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '36px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '19px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '6px' }}>
          Add Your First Wallet
        </h2>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.7 }}>
          Private keys are encrypted and stored in macOS Keychain. They never leave your device.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Import with private key */}
        <button onClick={onImport}
          style={{ display: 'flex', alignItems: 'center', gap: '14px', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid var(--wr-accent)', padding: '16px 20px', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
          <span style={{
            width: '32px', height: '32px',
            backgroundColor: isDay ? '#3D6000' : '#BEFF00',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontWeight: 700, fontSize: '14px',
            color: isDay ? '#FFFFFF' : '#000000',
          }}>
            ↓
          </span>
          <div>
            <div style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)' }}>Import Wallet</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '2px' }}>
              Enter private key — enables trading, sniping & bulk actions
            </div>
          </div>
        </button>

        {/* Watch-only by address */}
        <button onClick={onWatch}
          style={{ display: 'flex', alignItems: 'center', gap: '14px', backgroundColor: 'var(--wr-overlay)', border: '1px solid var(--wr-border)', padding: '16px 20px', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
          <span style={{ width: '32px', height: '32px', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, fontSize: '14px', color: 'var(--wr-text-3)' }}>
            ◉
          </span>
          <div>
            <div style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)' }}>Watch Address</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '2px' }}>
              Track any wallet read-only — no private key needed
            </div>
          </div>
        </button>
      </div>

      {hasWallets && (
        <button
          onClick={() => { if (typeof window !== 'undefined') window.location.href = '/'; }}
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center', marginTop: '4px' }}>
          Continue with existing wallets →
        </button>
      )}
    </div>
  );
}

// ─── Import Step ──────────────────────────────────────────────────────────────

function ImportStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [privateKey, setPrivateKey] = useState('');
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [deriving, setDeriving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleDerive = async () => {
    if (!isValidKey(privateKey)) {
      setError('Invalid private key — must be 64 hex characters, optionally 0x prefixed.');
      return;
    }
    setDeriving(true);
    setError('');
    try {
      const { privateKeyToAccount } = await import('viem/accounts');
      const normalized = (privateKey.trim().startsWith('0x') ? privateKey.trim() : '0x' + privateKey.trim()) as `0x${string}`;
      const account = privateKeyToAccount(normalized);
      setDerivedAddress(account.address);
    } catch {
      setError('Could not derive address — double-check the private key.');
    } finally {
      setDeriving(false);
    }
  };

  const handleConfirm = async () => {
    if (!derivedAddress) return;
    if (!name.trim()) { setError('Wallet name is required.'); return; }
    setSaving(true);
    setError('');
    const addr = derivedAddress.toLowerCase();
    const key  = privateKey.trim().startsWith('0x') ? privateKey.trim().slice(2) : privateKey.trim();
    try {
      if (isTauri) await importWallet({ address: addr, private_key_hex: key });
      addWallet({ id: Date.now().toString(), name: name.trim(), address: addr });
      onDone();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  };

  // Phase 2 — confirm screen
  if (derivedAddress) {
    return (
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '36px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => { setDerivedAddress(null); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>←</button>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)', margin: 0 }}>Confirm Wallet</h2>
        </div>

        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.7, padding: '10px 14px', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid var(--wr-border)' }}>
          🔒 Your private key is encrypted via macOS Keychain and stored locally. It is never transmitted to any server.
        </div>

        {/* Derived address display */}
        <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '16px 18px' }}>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>
            Derived Address
          </div>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text)', wordBreak: 'break-all', letterSpacing: '0.5px' }}>
            {derivedAddress}
          </div>
        </div>

        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', margin: 0, lineHeight: 1.6 }}>
          This is the wallet address derived from your private key. Verify it matches before continuing.
        </p>

        {/* Name input */}
        <div>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '5px' }}>
            Wallet Name
          </label>
          <input
            type="text" value={name} onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Main Wallet"
            autoFocus
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', width: '100%', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '9px 12px', color: 'var(--wr-text)', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {error && (
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#f87171' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setDerivedAddress(null); setError(''); }}
            style={{ flex: 1, backgroundColor: 'var(--wr-overlay)', color: 'var(--wr-text-3)', border: '1px solid var(--wr-border-hover)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, padding: '12px 0', cursor: 'pointer' }}>
            Back
          </button>
          <button onClick={handleConfirm} disabled={saving}
            style={{ flex: 2, backgroundColor: '#BEFF00', color: '#000000', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, padding: '12px 0', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Adding…' : 'Add Wallet →'}
          </button>
        </div>
      </div>
    );
  }

  // Phase 1 — key entry
  return (
    <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '36px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div className="flex items-center gap-3">
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>←</button>
        <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)', margin: 0 }}>Import Wallet</h2>
      </div>

      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.7, padding: '10px 14px', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid var(--wr-border)' }}>
        🔒 Your private key is encrypted via macOS Keychain and stored locally. It is never transmitted to any server.
      </div>

      <div>
        <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '5px' }}>
          Private Key
        </label>
        <input
          type="password" value={privateKey} onChange={e => { setPrivateKey(e.target.value); setError(''); }}
          placeholder="0x… or 64 hex characters"
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', width: '100%', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '9px 12px', color: 'var(--wr-text)', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {error && (
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#f87171' }}>{error}</div>
      )}

      <button onClick={handleDerive} disabled={deriving}
        style={{ backgroundColor: '#BEFF00', color: '#000000', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, padding: '13px 0', border: 'none', cursor: deriving ? 'not-allowed' : 'pointer', opacity: deriving ? 0.6 : 1 }}>
        {deriving ? 'Deriving address…' : 'Continue →'}
      </button>
    </div>
  );
}

// ─── Watch Step ───────────────────────────────────────────────────────────────

function WatchStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleWatch = () => {
    if (!name.trim())             { setError('Wallet name is required.'); return; }
    if (!isValidAddress(address)) { setError('Invalid Ethereum address (0x + 40 hex characters).'); return; }

    setSaving(true);
    addWallet({ id: Date.now().toString(), name: name.trim(), address: address.trim().toLowerCase() });
    onDone();
  };

  return (
    <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '36px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div className="flex items-center gap-3">
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>←</button>
        <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)', margin: 0 }}>Watch Address</h2>
      </div>

      <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.7 }}>
        Read-only mode — portfolio & NFT data will load but trading features require a private key.
      </p>

      {[
        { label: 'Wallet Name',      value: name,    set: setName,    placeholder: 'e.g. Whale Watch' },
        { label: 'Ethereum Address', value: address, set: setAddress, placeholder: '0x…' },
      ].map(({ label, value, set, placeholder }) => (
        <div key={label}>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '5px' }}>
            {label}
          </label>
          <input type="text" value={value} onChange={e => { set(e.target.value); setError(''); }}
            placeholder={placeholder}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', width: '100%', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '9px 12px', color: 'var(--wr-text)', outline: 'none', boxSizing: 'border-box' }} />
        </div>
      ))}

      {error && (
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#f87171' }}>{error}</div>
      )}

      <button onClick={handleWatch} disabled={saving}
        style={{ backgroundColor: 'var(--wr-overlay)', color: 'var(--wr-text)', border: '1px solid var(--wr-border-hover)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, padding: '13px 0', cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Adding…' : 'Add & Continue →'}
      </button>
    </div>
  );
}
