'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { listAlerts, setAlertActive, deleteAlert, loadAlchemyKey, type AlertRule } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_ALERTS } from '@/lib/emptyData';
import ProGate from '@/components/ProGate';

// ─── Alerts / Rules — matches 5JKDK design ───────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      style={{ width: '40px', height: '22px', borderRadius: '11px', flexShrink: 0, backgroundColor: on ? '#BEFF00' : 'var(--wr-overlay)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background-color 0.2s' }}>
      <span style={{ position: 'absolute', top: '3px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: on ? '#000000' : 'var(--wr-text-3)', left: on ? '21px' : '3px', transition: 'left 0.2s' }} />
    </button>
  );
}

const SL = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '12px' }}>{children}</div>
);

export default function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState('');
  const [notifPrefs] = useState([
    { label: 'Bid accepted', desc: 'Get notified when your bid is accepted by the seller', on: true },
    { label: 'Outbid Alert', desc: 'Get notified when someone outbids your active bid or offer', on: true },
    { label: 'Listing Sold', desc: 'Receive an alert when your listed NFT is sold or purchased', on: false },
    { label: 'Whale Activity', desc: 'Track large transactions from whale wallets in real time', on: true },
    { label: 'Gas Price Alert', desc: 'Get notified when gas fees reach your set threshold', on: false },
  ]);
  const [prefStates, setPrefStates] = useState(notifPrefs.map(p => p.on));

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const wallets = loadWallets();
    const addr = wallets[0]?.address ?? '';
    setWalletAddress(addr);
    if (!inTauri) { setRules(EMPTY_ALERTS); setLoading(false); return; }
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      void key;
      const data = await listAlerts(addr).catch(() => [] as AlertRule[]);
      setRules(data);
      setLoading(false);
    })();
  }, []);

  const handleToggle = async (id: string, current: boolean) => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (inTauri) await setAlertActive(id, !current).catch(() => {});
    setRules(prev => prev.map(r => r.id === id ? { ...r, active: !current } : r));
  };

  const handleDelete = async (id: string) => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (inTauri) await deleteAlert(id).catch(() => {});
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const trackedWallets = loadWallets().map(w => ({
    wallet: w.address.slice(0, 6) + '…' + w.address.slice(-4),
    name: w.name,
    active: true,
  }));

  return (
    <ProGate feature="Alerts & Monitoring">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>
      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <Link href="/alerts" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Alerts</Link>
        <span>›</span>
        <span style={{ color: 'var(--wr-text)' }}>Rules</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Alert Rules</h1>
        <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#000000', backgroundColor: '#BEFF00', border: 'none', padding: '8px 16px', cursor: 'pointer', letterSpacing: '0.5px' }}>
          + Add Rules
        </button>
      </div>

      {/* Tracked Wallets */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
        <SL>Tracked Wallets</SL>
        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[#1A1A1A]"
            style={{ gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 120px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span>Wallet</span><span>Labels</span><span>Route</span><span>Slots</span><span>Actions</span>
          </div>
          {trackedWallets.map((w, i) => (
            <div key={i} className="grid px-4 py-3 border-b border-[#1A1A1A] last:border-b-0 items-center"
              style={{ gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 120px' }}>
              <span style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{w.wallet}</span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px' }}>{w.name}</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>Ethereum</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>
                {rules.filter(r => r.wallet_address.toLowerCase() === loadWallets()[i]?.address.toLowerCase()).length} rules
              </span>
              <div className="flex gap-2">
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                  color: w.active ? 'var(--wr-accent)' : 'var(--wr-text-3)',
                  backgroundColor: w.active ? 'var(--wr-accent-dim)' : 'var(--wr-border)',
                  border: `1px solid ${w.active ? '#BEFF0044' : 'var(--wr-border-hover)'}`, padding: '2px 8px' }}>
                  {w.active ? 'Active' : 'Paused'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Price Alert Rules */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
        <SL>Price Alert Rules</SL>
        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[#1A1A1A]"
            style={{ gridTemplateColumns: '1.2fr 1.2fr 1fr 1fr 80px 80px 100px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span>Collection</span><span>Condition</span><span>Target</span><span>Update</span><span>Status</span><span>Active</span><span>Actions</span>
          </div>
          {loading ? (
            <div className="px-4 py-6 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>Loading rules…</div>
          ) : rules.length === 0 ? (
            <div className="px-4 py-6 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>No alert rules yet. Create one from the Alerts hub.</div>
          ) : rules.map((r) => (
            <div key={r.id} className="grid px-4 py-3 border-b border-[#1A1A1A] last:border-b-0 items-center"
              style={{ gridTemplateColumns: '1.2fr 1.2fr 1fr 1fr 80px 80px 100px' }}>
              <span style={{ color: 'var(--wr-text)', fontSize: '12px' }}>
                {r.collection_slug ?? r.alert_type}
              </span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px' }}>
                {r.condition === 'below' ? 'Below' : 'Above'}
              </span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>
                {r.threshold_eth} ETH
              </span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>
                {r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleDateString() : '—'}
              </span>
              <Toggle on={r.active} onToggle={() => handleToggle(r.id, r.active)} />
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                color: r.active ? 'var(--wr-accent)' : 'var(--wr-text-3)',
                backgroundColor: r.active ? 'var(--wr-accent-dim)' : 'var(--wr-border)',
                border: `1px solid ${r.active ? '#BEFF0044' : 'var(--wr-border-hover)'}`, padding: '2px 8px', display: 'inline-block' }}>
                {r.active ? 'Active' : 'Paused'}
              </span>
              <div className="flex gap-2">
                <button onClick={() => handleDelete(r.id)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#F87171', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notification Preferences */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px' }}>
        <SL>Notification Preferences</SL>
        <div className="space-y-3">
          {notifPrefs.map((p, i) => (
            <div key={p.label} className="flex items-center justify-between bg-[#111111] border border-[#1A1A1A] px-4 py-3.5">
              <div>
                <div style={{ color: 'var(--wr-text)', fontSize: '13px' }}>{p.label}</div>
                <div style={{ color: 'var(--wr-text-3)', fontSize: '11px', marginTop: '2px', fontFamily: 'var(--font-jetbrains)' }}>{p.desc}</div>
              </div>
              <Toggle on={prefStates[i]} onToggle={() => setPrefStates(s => s.map((v, j) => j === i ? !v : v))} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4 mt-6">
        {[
          { href: '/alerts/feed', label: 'Feed' },
          { href: '/alerts/rules', label: 'Rules', active: true },
          { href: '/alerts/history', label: 'History' },
        ].map(link => (
          <Link key={link.href} href={link.href}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: link.active ? 'var(--wr-accent)' : 'var(--wr-text-3)', textDecoration: 'none' }}>
            {link.label}
          </Link>
        ))}
      </div>
    </main>
    </ProGate>
  );
}
