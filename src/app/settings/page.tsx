'use client';

import React, { useState, useEffect } from 'react';
import { loadWallets, addWallet, removeWallet } from '@/lib/walletStore';
import { loadAlchemyKey, saveAlchemyKey, deleteAlchemyKey, loadOpenSeaKey, saveOpenSeaKey, deleteOpenSeaKey, loadEtherscanKey, saveEtherscanKey, deleteEtherscanKey, importWallet, checkSubscription } from '@/lib/tauri';
import { loadSubscription, saveSubscription, isSubscriptionActive, planLabel, isCacheStale, type SubscriptionState } from '@/lib/subscriptionStore';
import { loadNotificationPrefs, saveNotificationPrefs } from '@/lib/notificationPrefsStore';
import { Tag } from '@/components/Tag';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Settings — matches ISsB0 design ─────────────────────────────────────────

type SettingsSection = 'Profile' | 'Security' | 'Notifications' | 'Billing';

const SIDEBAR_ITEMS: SettingsSection[] = ['Profile', 'Security', 'Notifications', 'Billing'];

// ─── Email Verification Modal — matches FXqbR design ─────────────────────────

function EmailVerificationModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');

  const handleSend = () => {
    setSent(true);
    setError('');
  };

  const handleVerify = () => {
    if (code.trim().length === 6) {
      setVerified(true);
      setTimeout(onClose, 1200);
    } else {
      setError('Invalid code. Please try again.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '460px', backgroundColor: 'var(--wr-modal)',
        border: '1px solid var(--wr-border)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '15px', fontWeight: 600, color: 'var(--wr-text)' }}>Verify Email Address</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {verified ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>✓</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: '#4fe9b4' }}>Email verified successfully!</div>
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', marginBottom: '8px' }}>
                  {sent
                    ? `A 6-digit code was sent to ${email}. Enter it below.`
                    : `We'll send a verification code to ${email}.`}
                </div>
              </div>

              {!sent ? (
                <button
                  onClick={handleSend}
                  style={{ backgroundColor: '#7c5cff', color: '#0b0c14', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, padding: '10px 20px', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}
                >
                  Send Verification Code
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>Verification Code</label>
                    <input
                      value={code}
                      onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                      placeholder="000000"
                      maxLength={6}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '20px', fontWeight: 700, letterSpacing: '8px', textAlign: 'center', width: '100%', backgroundColor: 'var(--wr-surface)', border: `1px solid ${error ? '#ff8a96' : 'var(--wr-border)'}`, padding: '12px', color: 'var(--wr-text)', outline: 'none' }}
                    />
                    {error && <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', marginTop: '6px' }}>{error}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button onClick={handleVerify} style={{ backgroundColor: '#7c5cff', color: '#0b0c14', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, padding: '10px 20px', border: 'none', cursor: 'pointer' }}>
                      Verify
                    </button>
                    <button onClick={handleSend} style={{ backgroundColor: 'transparent', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', padding: '10px 12px', border: '1px solid var(--wr-border)', cursor: 'pointer' }}>
                      Resend Code
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileSection() {
  const [displayName, setDisplayName] = useState('gthu_dba.eth');
  const [email, setEmail] = useState('john@example.com');
  const [emailVerified, setEmailVerified] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [country, setCountry] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [sub, setSub] = useState(() => loadSubscription());
  const isPro = isSubscriptionActive(sub);

  useEffect(() => {
    const wallets = loadWallets();
    if (wallets[0]) setWalletAddress(wallets[0].address);
    setSub(loadSubscription());
  }, []);

  const LABEL_W = '140px';
  const inputStyle: React.CSSProperties = {
    flex: 1, backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)',
    padding: '6px 10px', color: 'var(--wr-text)', fontSize: '12px',
    fontFamily: 'var(--font-jetbrains)', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)',
    width: LABEL_W, flexShrink: 0,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 16px', borderBottom: '1px solid var(--wr-border)',
  };

  return (
    <div style={{ flex: 1, padding: '0 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Profile</span>
      </div>

      {/* Identity card — compact horizontal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', border: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)', marginBottom: '16px' }}>
        <div style={{ width: '36px', height: '36px', backgroundColor: 'var(--wr-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#000', fontWeight: 700, fontSize: '12px' }}>
          JD
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '2px' }}>{displayName}</div>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>john@example.com</div>
        </div>
        {isPro ? (
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, padding: '2px 8px', color: 'var(--wr-accent-text)', backgroundColor: 'var(--wr-accent)', letterSpacing: '0.06em', flexShrink: 0 }}>
            {planLabel(sub.plan).toUpperCase()}
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, padding: '2px 8px', color: 'var(--wr-text-3)', border: '1px solid var(--wr-border)', letterSpacing: '0.06em', flexShrink: 0 }}>
            FREE
          </span>
        )}
      </div>

      {/* Form — compact bordered rows */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden' }}>

        {/* Display name */}
        <div style={rowStyle}>
          <span style={labelStyle}>Display Name</span>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} />
        </div>

        {/* Wallet address */}
        <div style={rowStyle}>
          <span style={labelStyle}>Wallet</span>
          <input value={walletAddress || '—'} readOnly style={{ ...inputStyle, color: 'var(--wr-text-3)', cursor: 'not-allowed', fontFamily: 'var(--font-jetbrains)' }} />
        </div>

        {/* Email */}
        <div style={rowStyle}>
          <span style={labelStyle}>Email</span>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={inputStyle} />
          {!emailVerified ? (
            <button onClick={() => setShowVerifyModal(true)} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', padding: '5px 10px', color: 'var(--wr-accent)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', cursor: 'pointer', flexShrink: 0 }}>
              VERIFY
            </button>
          ) : (
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-success)', flexShrink: 0 }}>✓ Verified</span>
          )}
        </div>

        {/* Country */}
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>Country</span>
          <select value={country} onChange={e => setCountry(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">— Select —</option>
            <option value="US">United States</option>
            <option value="GB">United Kingdom</option>
            <option value="TR">Turkey</option>
            <option value="DE">Germany</option>
          </select>
        </div>

      </div>

      {/* Save */}
      <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="hover:opacity-90 transition-opacity" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)', border: 'none', padding: '7px 16px', cursor: 'pointer' }}>
          SAVE CHANGES
        </button>
      </div>

      {showVerifyModal && (
        <EmailVerificationModal email={email} onClose={() => { setShowVerifyModal(false); setEmailVerified(true); }} />
      )}
    </div>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '40px', height: '22px', borderRadius: '11px', flexShrink: 0,
        backgroundColor: on ? '#7c5cff' : 'var(--wr-border-hover)',
        border: 'none', cursor: 'pointer', position: 'relative', transition: 'background-color 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: '3px', width: '16px', height: '16px', borderRadius: '50%',
        backgroundColor: on ? '#0b0c14' : 'var(--wr-text-3)',
        left: on ? '21px' : '3px', transition: 'left 0.2s',
      }} />
    </button>
  );
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '12px' }}>{children}</div>
);

// ─── Import Wallet Modal ──────────────────────────────────────────────────────

function ImportWalletModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isValidAddress = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const isValidKey = /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey.trim());

  const handleImport = async () => {
    if (!name.trim()) { setError('Wallet name required.'); return; }
    if (!isValidAddress) { setError('Invalid Ethereum address (must be 0x + 40 hex chars).'); return; }
    if (!isValidKey) { setError('Invalid private key (must be 64 hex chars, optionally 0x prefixed).'); return; }

    setSaving(true);
    setError('');
    const addr = address.trim().toLowerCase();
    const key = privateKey.trim().startsWith('0x') ? privateKey.trim().slice(2) : privateKey.trim();

    try {
      if (isTauri) await importWallet({ address: addr, private_key_hex: key });
      addWallet({ id: Date.now().toString(), name: name.trim(), address: addr });
      onImported();
      onClose();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '440px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '15px', fontWeight: 600, color: 'var(--wr-text)' }}>Import Wallet</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.6 }}>
            Your private key is encrypted locally via macOS Keychain and never leaves your device.
          </div>
          {[
            { label: 'Wallet Name', value: name, set: setName, placeholder: 'e.g. Main Wallet', type: 'text' },
            { label: 'Ethereum Address', value: address, set: setAddress, placeholder: '0x…', type: 'text' },
            { label: 'Private Key', value: privateKey, set: setPrivateKey, placeholder: '0x… or 64 hex chars', type: 'password' },
          ].map(({ label, value, set, placeholder, type }) => (
            <div key={label}>
              <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '5px' }}>{label}</label>
              <input type={type} value={value} onChange={e => { set(e.target.value); setError(''); }}
                placeholder={placeholder}
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', width: '100%', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '9px 12px', color: 'var(--wr-text)', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ))}
          {error && <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button onClick={handleImport} disabled={saving}
              style={{ backgroundColor: '#7c5cff', color: '#0b0c14', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, padding: '10px 20px', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Importing…' : 'Import'}
            </button>
            <button onClick={onClose}
              style={{ backgroundColor: 'transparent', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', padding: '10px 16px', border: '1px solid var(--wr-border)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecuritySection() {
  const [twoFA, setTwoFA] = useState(true);
  const [dailyLimit, setDailyLimit] = useState('$1.85');
  const [weeklyLimit, setWeeklyLimit] = useState('$6.78');
  const [monthlyLimit, setMonthlyLimit] = useState('$309.0k');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState('');
  const [osKey, setOsKey] = useState('');
  const [osKeyInput, setOsKeyInput] = useState('');
  const [osKeySaving, setOsKeySaving] = useState(false);
  const [osKeyMsg, setOsKeyMsg] = useState('');
  const [esKey, setEsKey] = useState('');
  const [esKeyInput, setEsKeyInput] = useState('');
  const [esKeySaving, setEsKeySaving] = useState(false);
  const [esKeyMsg, setEsKeyMsg] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [connectedWallets, setConnectedWallets] = useState<{ id: string; short: string; rawAddress: string; chain: string; name: string; }[]>([]);

  const reloadWallets = () => {
    const stored = loadWallets();
    setConnectedWallets(stored.map(w => ({
      id: w.id,
      short: w.address.slice(0, 6) + '…' + w.address.slice(-4),
      rawAddress: w.address,
      chain: 'Ethereum',
      name: w.name,
    })));
  };

  useEffect(() => {
    if (isTauri) {
      loadAlchemyKey().then(k => { if (k) { setApiKey(k); setApiKeyInput(k); } }).catch(() => {});
      loadOpenSeaKey().then(k => { if (k) { setOsKey(k); setOsKeyInput(k); } }).catch(() => {});
      loadEtherscanKey().then(k => { if (k) { setEsKey(k); setEsKeyInput(k); } }).catch(() => {});
    }
    reloadWallets();
  }, []);

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setApiKeySaving(true);
    try {
      if (isTauri) await saveAlchemyKey(apiKeyInput.trim());
      setApiKey(apiKeyInput.trim());
      setApiKeyMsg('Saved.');
    } catch { setApiKeyMsg('Error saving key.'); }
    setApiKeySaving(false);
    setTimeout(() => setApiKeyMsg(''), 2000);
  };

  const handleDeleteApiKey = async () => {
    try {
      if (isTauri) await deleteAlchemyKey();
      setApiKey('');
      setApiKeyInput('');
      setApiKeyMsg('Removed.');
    } catch { setApiKeyMsg('Error removing key.'); }
    setTimeout(() => setApiKeyMsg(''), 2000);
  };

  const handleSaveOsKey = async () => {
    if (!osKeyInput.trim()) return;
    setOsKeySaving(true);
    try {
      if (isTauri) await saveOpenSeaKey(osKeyInput.trim());
      setOsKey(osKeyInput.trim());
      setOsKeyMsg('Saved.');
    } catch (e) { setOsKeyMsg(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setOsKeySaving(false);
    setTimeout(() => setOsKeyMsg(''), 2000);
  };

  const handleDeleteOsKey = async () => {
    try {
      if (isTauri) await deleteOpenSeaKey();
      setOsKey('');
      setOsKeyInput('');
      setOsKeyMsg('Removed.');
    } catch { setOsKeyMsg('Error removing key.'); }
    setTimeout(() => setOsKeyMsg(''), 2000);
  };

  const handleSaveEsKey = async () => {
    if (!esKeyInput.trim()) return;
    setEsKeySaving(true);
    try {
      if (isTauri) await saveEtherscanKey(esKeyInput.trim());
      setEsKey(esKeyInput.trim());
      setEsKeyMsg('Saved.');
    } catch (e) { setEsKeyMsg(`Error: ${e instanceof Error ? e.message : String(e)}`); }
    setEsKeySaving(false);
    setTimeout(() => setEsKeyMsg(''), 2000);
  };

  const handleDeleteEsKey = async () => {
    try {
      if (isTauri) await deleteEtherscanKey();
      setEsKey('');
      setEsKeyInput('');
      setEsKeyMsg('Removed.');
    } catch { setEsKeyMsg('Error removing key.'); }
    setTimeout(() => setEsKeyMsg(''), 2000);
  };

  const handleRemoveWallet = (id: string) => {
    removeWallet(id);
    reloadWallets();
  };

  const sessions = [
    { device: 'Chrome / macOS', ip: '192.168.1.1', last: '3 min ago' },
    { device: 'Firefox Mobile', ip: '10.0.0.91', last: '4 hours ago' },
  ];

  const isPro = isSubscriptionActive(loadSubscription());
  const atLimit = !isPro && connectedWallets.length >= 1;

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)',
    width: '140px', flexShrink: 0,
  };
  const inputStyle: React.CSSProperties = {
    flex: 1, backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)',
    padding: '6px 10px', color: 'var(--wr-text)', fontSize: '12px',
    fontFamily: 'var(--font-jetbrains)', outline: 'none',
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 16px', borderBottom: '1px solid var(--wr-border)',
  };
  const blockHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '8px 16px', backgroundColor: 'var(--wr-surface-alt)',
    borderBottom: '1px solid var(--wr-border)',
  };
  const inlineBtn: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer',
    backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)',
    border: 'none', flexShrink: 0,
  };
  const dangerBtn: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer',
    backgroundColor: 'transparent', color: 'var(--wr-danger)',
    border: '1px solid var(--wr-border)', flexShrink: 0,
  };
  const smallInlineBtn: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer',
    backgroundColor: 'transparent', color: 'var(--wr-text-3)',
    border: '1px solid var(--wr-border)', flexShrink: 0,
  };

  return (
    <div style={{ flex: 1, padding: '0 32px' }}>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Security</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {atLimit && (
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>Free: 1 wallet max</span>
          )}
          <button
            onClick={() => { if (!atLimit) setShowImportModal(true); }}
            disabled={atLimit}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: atLimit ? 'var(--wr-text-3)' : 'var(--wr-accent-text)', backgroundColor: atLimit ? 'var(--wr-surface)' : 'var(--wr-accent)', border: atLimit ? '1px solid var(--wr-border)' : 'none', padding: '5px 12px', cursor: atLimit ? 'not-allowed' : 'pointer', opacity: atLimit ? 0.5 : 1 }}>
            + Import
          </button>
        </div>
      </div>

      {/* Connected Wallets block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        <div style={blockHeaderStyle}>
          <span style={{ ...labelStyle, width: 'auto' }}>Connected Wallets</span>
        </div>
        {connectedWallets.length === 0 ? (
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>No wallets imported</span>
          </div>
        ) : (
          connectedWallets.map((w, i) => (
            <div key={w.id} style={{ ...rowStyle, borderBottom: i < connectedWallets.length - 1 ? '1px solid var(--wr-border)' : 'none' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>{w.name}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{w.short}</span>
                <Tag variant="neutral" size="xs">{w.chain}</Tag>
              </div>
              <a href={`https://etherscan.io/address/${w.rawAddress}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--wr-text-3)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
              <button onClick={() => handleRemoveWallet(w.id)} style={dangerBtn}>Remove</button>
            </div>
          ))
        )}
      </div>

      {/* API Keys block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        {/* Alchemy row */}
        <div style={{ borderBottom: '1px solid var(--wr-border)' }}>
          <div style={rowStyle}>
            <span style={labelStyle}>Alchemy Key</span>
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="Enter Alchemy API key…"
              style={inputStyle}
            />
            <button onClick={handleSaveApiKey} disabled={apiKeySaving || !apiKeyInput.trim()} style={{ ...inlineBtn, opacity: apiKeySaving || !apiKeyInput.trim() ? 0.4 : 1, cursor: apiKeySaving || !apiKeyInput.trim() ? 'not-allowed' : 'pointer' }}>
              {apiKeySaving ? 'Saving…' : 'Save'}
            </button>
            {apiKey && (
              <button onClick={handleDeleteApiKey} style={dangerBtn}>Remove</button>
            )}
          </div>
          {apiKeyMsg && (
            <div style={{ padding: '4px 16px 8px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: apiKeyMsg.includes('Error') ? 'var(--wr-danger)' : 'var(--wr-success)' }}>{apiKeyMsg}</div>
          )}
        </div>
        {/* OpenSea row */}
        <div>
          <div style={rowStyle}>
            <span style={labelStyle}>OpenSea Key</span>
            <input
              type="password"
              value={osKeyInput}
              onChange={e => setOsKeyInput(e.target.value)}
              placeholder="Enter OpenSea API key…"
              style={inputStyle}
            />
            <button onClick={handleSaveOsKey} disabled={osKeySaving || !osKeyInput.trim()} style={{ ...inlineBtn, opacity: osKeySaving || !osKeyInput.trim() ? 0.4 : 1, cursor: osKeySaving || !osKeyInput.trim() ? 'not-allowed' : 'pointer' }}>
              {osKeySaving ? 'Saving…' : 'Save'}
            </button>
            {osKey && (
              <button onClick={handleDeleteOsKey} style={dangerBtn}>Remove</button>
            )}
          </div>
          {osKeyMsg && (
            <div style={{ padding: '4px 16px 8px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: osKeyMsg.includes('Error') ? 'var(--wr-danger)' : 'var(--wr-success)' }}>{osKeyMsg}</div>
          )}
        </div>

        {/* Etherscan row (powers the Sister Wallet Finder) */}
        <div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>Etherscan Key</span>
            <input
              type="password"
              value={esKeyInput}
              onChange={e => setEsKeyInput(e.target.value)}
              placeholder="Enter Etherscan API key…"
              style={inputStyle}
            />
            <button onClick={handleSaveEsKey} disabled={esKeySaving || !esKeyInput.trim()} style={{ ...inlineBtn, opacity: esKeySaving || !esKeyInput.trim() ? 0.4 : 1, cursor: esKeySaving || !esKeyInput.trim() ? 'not-allowed' : 'pointer' }}>
              {esKeySaving ? 'Saving…' : 'Save'}
            </button>
            {esKey && (
              <button onClick={handleDeleteEsKey} style={dangerBtn}>Remove</button>
            )}
          </div>
          {esKeyMsg && (
            <div style={{ padding: '4px 16px 8px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: esKeyMsg.includes('Error') ? 'var(--wr-danger)' : 'var(--wr-success)' }}>{esKeyMsg}</div>
          )}
        </div>
      </div>

      {/* Access & Limits block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        {/* 2FA row */}
        <div style={rowStyle}>
          <span style={labelStyle}>2FA</span>
          <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Protect your account with an authenticator app</span>
          <Toggle on={twoFA} onToggle={() => setTwoFA(v => !v)} />
        </div>
        {/* Spending limits row */}
        <div style={rowStyle}>
          <span style={labelStyle}>Daily</span>
          <input value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} style={{ ...inputStyle, flex: 'none', width: '80px' }} />
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)', flexShrink: 0 }}>Weekly</span>
          <input value={weeklyLimit} onChange={e => setWeeklyLimit(e.target.value)} style={{ ...inputStyle, flex: 'none', width: '80px' }} />
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)', flexShrink: 0 }}>Monthly</span>
          <input value={monthlyLimit} onChange={e => setMonthlyLimit(e.target.value)} style={{ ...inputStyle, flex: 'none', width: '80px' }} />
        </div>
        {/* Sessions row */}
        <div style={{ ...rowStyle, borderBottom: 'none', alignItems: 'flex-start' }}>
          <span style={{ ...labelStyle, paddingTop: '2px' }}>Sessions</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sessions.map(s => (
              <div key={s.device} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', flex: 1 }}>{s.device} · {s.ip} · {s.last}</span>
                <button style={smallInlineBtn}>Revoke</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)', border: 'none', padding: '7px 16px', cursor: 'pointer' }}>
          SAVE CHANGES
        </button>
      </div>

      {showImportModal && (
        <ImportWalletModal
          onClose={() => setShowImportModal(false)}
          onImported={reloadWallets}
        />
      )}
    </div>
  );
}

function NotificationsSection() {
  const [trading, setTrading] = useState({ bidAccepted: true, bidOutbid: true, listingSold: true, priceDropAlert: false });
  const [portfolio, setPortfolio] = useState({ floorPriceChange: true, newCollectionListing: false, whaleActivity: true });
  const [inApp, setInApp] = useState(true);
  const [emailOn, setEmailOn] = useState(false);
  const [email, setEmail] = useState('');
  const [telegramOn, setTelegramOn] = useState(false);
  const [discordOn, setDiscordOn] = useState(false);
  const [discordUrl, setDiscordUrl] = useState('');
  const [quietOn, setQuietOn] = useState(true);
  const [quietFrom, setQuietFrom] = useState('22:00');
  const [quietTo, setQuietTo] = useState('08:00');

  // Load persisted prefs on mount
  useEffect(() => {
    const prefs = loadNotificationPrefs();
    if (prefs.discordWebhook) { setDiscordUrl(prefs.discordWebhook); setDiscordOn(true); }
    setQuietFrom(prefs.quietFrom);
    setQuietTo(prefs.quietTo);
  }, []);

  function handleDiscordBlur() {
    saveNotificationPrefs({ discordWebhook: discordUrl, quietFrom, quietTo });
  }

  function handleQuietChange(field: 'quietFrom' | 'quietTo', value: string) {
    const next = field === 'quietFrom' ? { discordWebhook: discordUrl, quietFrom: value, quietTo } : { discordWebhook: discordUrl, quietFrom, quietTo: value };
    if (field === 'quietFrom') setQuietFrom(value); else setQuietTo(value);
    saveNotificationPrefs(next);
  }
  const [days, setDays] = useState({ M: true, T: true, W: true, T2: true, F: true, S: false, S2: false });

  const tradingItems = [
    { key: 'bidAccepted' as const, label: 'Bid Accepted', desc: 'Get notified when your bid is accepted by the seller' },
    { key: 'bidOutbid' as const, label: 'Bid Outbid', desc: 'Alert when someone places a higher bid than yours' },
    { key: 'listingSold' as const, label: 'Listing Sold', desc: 'Notification when your listed NFT is purchased' },
    { key: 'priceDropAlert' as const, label: 'Price Drop Alert', desc: 'Get alerted when prices in your watchlist drop to allow' },
  ];
  const portfolioItems = [
    { key: 'floorPriceChange' as const, label: 'Floor Price Change > 12%', desc: 'Alert when floor prices change significantly' },
    { key: 'newCollectionListing' as const, label: 'New Collection Listing', desc: 'Notify when new items appear in tracked collections' },
    { key: 'whaleActivity' as const, label: 'Whale Activity', desc: 'Track large transactions from whale wallets' },
  ];

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)',
    width: '140px', flexShrink: 0,
  };
  const inputStyle: React.CSSProperties = {
    flex: 1, backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)',
    padding: '6px 10px', color: 'var(--wr-text)', fontSize: '12px',
    fontFamily: 'var(--font-jetbrains)', outline: 'none',
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 16px', borderBottom: '1px solid var(--wr-border)',
  };
  const blockHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '8px 16px', backgroundColor: 'var(--wr-surface-alt)',
    borderBottom: '1px solid var(--wr-border)',
  };

  return (
    <div style={{ flex: 1, padding: '0 32px' }}>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Notifications</span>
      </div>

      {/* Alerts block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        <div style={blockHeaderStyle}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Trading</span>
        </div>
        {tradingItems.map(item => (
          <div key={item.key} style={rowStyle}>
            <span style={{ flex: 1, fontFamily: 'var(--font-inter)', fontSize: '12px', color: 'var(--wr-text)' }}>{item.label}</span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flex: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</span>
            <Toggle on={trading[item.key]} onToggle={() => setTrading(s => ({ ...s, [item.key]: !s[item.key] }))} />
          </div>
        ))}
        <div style={blockHeaderStyle}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Portfolio</span>
        </div>
        {portfolioItems.map((item, i) => (
          <div key={item.key} style={{ ...rowStyle, borderBottom: i < portfolioItems.length - 1 ? '1px solid var(--wr-border)' : 'none' }}>
            <span style={{ flex: 1, fontFamily: 'var(--font-inter)', fontSize: '12px', color: 'var(--wr-text)' }}>{item.label}</span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flex: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</span>
            <Toggle on={portfolio[item.key]} onToggle={() => setPortfolio(s => ({ ...s, [item.key]: !s[item.key] }))} />
          </div>
        ))}
      </div>

      {/* Channels block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        {/* In-App */}
        <div style={rowStyle}>
          <span style={labelStyle}>In-App</span>
          <span style={{ flex: 1 }} />
          <Toggle on={inApp} onToggle={() => setInApp(v => !v)} />
        </div>
        {/* Email */}
        <div style={rowStyle}>
          <span style={labelStyle}>Email</span>
          {emailOn && (
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
          )}
          {!emailOn && <span style={{ flex: 1 }} />}
          <Toggle on={emailOn} onToggle={() => setEmailOn(v => !v)} />
        </div>
        {/* Telegram */}
        <div style={rowStyle}>
          <span style={labelStyle}>Telegram</span>
          <span style={{ flex: 1 }} />
          {telegramOn && (
            <button style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer', backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)', border: 'none', marginRight: '8px' }}>
              Connect
            </button>
          )}
          <Toggle on={telegramOn} onToggle={() => setTelegramOn(v => !v)} />
        </div>
        {/* Discord */}
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>Discord</span>
          {discordOn && (
            <input value={discordUrl} onChange={e => setDiscordUrl(e.target.value)} onBlur={handleDiscordBlur} placeholder="https://discord.com/api/webhooks/..." style={inputStyle} />
          )}
          {!discordOn && <span style={{ flex: 1 }} />}
          <Toggle on={discordOn} onToggle={() => setDiscordOn(v => !v)} />
        </div>
      </div>

      {/* Quiet Hours block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>Quiet Hours</span>
          <Toggle on={quietOn} onToggle={() => setQuietOn(v => !v)} />
          {quietOn && (
            <>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flexShrink: 0 }}>From</span>
              <input value={quietFrom} onChange={e => handleQuietChange('quietFrom', e.target.value)} style={{ ...inputStyle, flex: 'none', width: '72px' }} />
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flexShrink: 0 }}>to</span>
              <input value={quietTo} onChange={e => handleQuietChange('quietTo', e.target.value)} style={{ ...inputStyle, flex: 'none', width: '72px' }} />
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                {(['M','T','W','T','F','S','S'] as const).map((d, i) => {
                  const k = ['M','T','W','T2','F','S','S2'][i] as keyof typeof days;
                  return (
                    <button key={i} onClick={() => setDays(s => ({ ...s, [k]: !s[k] }))}
                      style={{ width: '26px', height: '26px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, border: '1px solid', borderColor: days[k] ? 'var(--wr-accent)' : 'var(--wr-border)', backgroundColor: days[k] ? 'var(--wr-accent-dim)' : 'var(--wr-surface)', color: days[k] ? 'var(--wr-accent)' : 'var(--wr-text-3)', cursor: 'pointer' }}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)', border: 'none', padding: '7px 16px', cursor: 'pointer' }}>
          SAVE CHANGES
        </button>
      </div>
    </div>
  );
}

// Payment config — update these to match your wrangler.toml before launch
const PAYMENT_WALLET   = '0xYOUR_PAYMENT_WALLET_ADDRESS';
const MONTHLY_ETH      = '0.01';
const ANNUAL_ETH       = '0.09';

function BillingSection() {
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');
  const [checkError, setCheckError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { setSub(loadSubscription()); }, []);

  const active = sub ? isSubscriptionActive(sub) : false;

  const handleCheckStatus = async () => {
    setChecking(true);
    setCheckError('');
    setCheckMsg('');
    try {
      const wallets = loadWallets();
      const addr = wallets[0]?.address ?? '';
      if (!addr) {
        setCheckError('No wallet added. Add a wallet first.');
        return;
      }

      let result;
      if (isTauri) {
        result = await checkSubscription(addr);
      } else {
        // Browser / dev mode — mock inactive
        result = { active: false, plan: null, expires_at: null };
      }

      const newState: SubscriptionState = {
        plan: result.active ? (result.plan as 'monthly' | 'annual') : 'free',
        activatedAt: result.active ? new Date().toISOString() : null,
        expiresAt: result.expires_at ?? null,
        lastChecked: new Date().toISOString(),
      };
      saveSubscription(newState);
      setSub(newState);
      setCheckMsg(result.active ? 'Subscription confirmed!' : 'No active subscription found for this wallet.');
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      setTimeout(() => { setCheckMsg(''); setCheckError(''); }, 5000);
    }
  };

  const handleReset = () => {
    saveSubscription({ plan: 'free', activatedAt: null, expiresAt: null, lastChecked: null });
    setSub(loadSubscription());
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(PAYMENT_WALLET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!sub) return null;

  const stale = isCacheStale(sub);

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)',
    width: '140px', flexShrink: 0,
  };
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 16px', borderBottom: '1px solid var(--wr-border)',
  };
  const blockHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '8px 16px', backgroundColor: 'var(--wr-surface-alt)',
    borderBottom: '1px solid var(--wr-border)',
  };

  return (
    <div style={{ flex: 1, padding: '0 32px' }}>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Billing</span>
        <button onClick={handleCheckStatus} disabled={checking}
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--wr-accent-text)', backgroundColor: 'var(--wr-accent)', border: 'none', padding: '5px 12px', cursor: checking ? 'not-allowed' : 'pointer', opacity: checking ? 0.6 : 1 }}>
          {checking ? 'CHECKING…' : 'CHECK STATUS'}
        </button>
      </div>

      {/* Current Plan block */}
      <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ ...blockHeaderStyle, backgroundColor: 'var(--wr-surface-alt)', borderBottom: (checkMsg || checkError) ? '1px solid var(--wr-border)' : 'none' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{planLabel(sub.plan)}</span>
          <Tag variant={active ? 'success' : 'neutral'} size="xs">{active ? 'Active' : 'Free'}</Tag>
          {stale && !active && <Tag variant="warning" size="xs">Unverified</Tag>}
          <span style={{ flex: 1 }} />
          {active ? (
            <>
              {sub.expiresAt && (
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                  Expires {new Date(sub.expiresAt).toLocaleDateString()}
                </span>
              )}
              {!sub.expiresAt && (
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                  Unlimited wallets · bulk trading · sniping · alerts
                </span>
              )}
              <button onClick={handleReset}
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--wr-danger)', border: '1px solid var(--wr-border)', flexShrink: 0 }}>
                Reset
              </button>
            </>
          ) : (
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
              Portfolio &amp; gallery read-only
            </span>
          )}
        </div>
        {(checkMsg || checkError) && (
          <div style={{ padding: '8px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: checkError ? 'var(--wr-danger)' : 'var(--wr-success)' }}>
            {checkMsg || checkError}
          </div>
        )}
      </div>

      {/* Subscribe block */}
      {!active && (
        <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
          <div style={blockHeaderStyle}>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>How to Subscribe</span>
          </div>
          {/* Monthly row */}
          <div style={rowStyle}>
            <span style={labelStyle}>Monthly</span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-accent)' }}>{MONTHLY_ETH} <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--wr-text-3)' }}>ETH</span></span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>30 days</span>
            <span style={{ flex: 1 }} />
          </div>
          {/* Annual row */}
          <div style={rowStyle}>
            <span style={labelStyle}>Annual</span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-accent)' }}>{ANNUAL_ETH} <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--wr-text-3)' }}>ETH</span></span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>365 days</span>
            <span style={{ flex: 1 }} />
            <Tag variant="accent" size="xs">Save ~25%</Tag>
          </div>
          {/* Payment address row */}
          <div style={rowStyle}>
            <span style={labelStyle}>Send To</span>
            <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', wordBreak: 'break-all' }}>{PAYMENT_WALLET}</span>
            <button onClick={handleCopy}
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer', backgroundColor: 'transparent', color: copied ? 'var(--wr-success)' : 'var(--wr-accent)', border: '1px solid var(--wr-border)', flexShrink: 0 }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          {/* Note row */}
          <div style={{ padding: '8px 16px', borderTop: 'none' }}>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.6 }}>
              Send from your imported wallet. Subscription activates within minutes after confirmation. Then click Check Status above.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const SECTION_COMPONENTS: Record<SettingsSection, React.FC> = {
  Profile: ProfileSection,
  Security: SecuritySection,
  Notifications: NotificationsSection,
  Billing: BillingSection,
};

export default function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('Profile');
  const ActiveSection = SECTION_COMPONENTS[section];

  return (
    <main className="min-h-full bg-[#0b0c14] text-white flex" style={{ paddingLeft: 0 }}>

      {/* Sidebar */}
      <aside className="shrink-0 border-r border-[#14161f]" style={{ width: '240px', paddingTop: '24px' }}>
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-accent)', padding: '0 24px', marginBottom: '12px' }}>Settings</div>
        <nav>
          {SIDEBAR_ITEMS.map(item => (
            <button
              key={item}
              onClick={() => setSection(item)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0 24px',
                height: '41px',
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '13px',
                fontWeight: 500,
                color: section === item ? 'var(--wr-accent)' : 'var(--wr-text-3)',
                background: 'none',
                border: 'none',
                borderLeft: section === item ? '2px solid var(--wr-accent)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1" style={{ paddingTop: '40px' }}>
        <ActiveSection />
      </div>
    </main>
  );
}
