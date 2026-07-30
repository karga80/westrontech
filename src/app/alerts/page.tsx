'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  listAlerts, createAlert, loadAlchemyKey,
  type AlertRule, type AlertRuleInput,
} from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_ALERTS } from '@/lib/emptyData';
import ProGate from '@/components/ProGate';
import { loadNotificationPrefs } from '@/lib/notificationPrefsStore';

// ─── Alerts Hub ───────────────────────────────────────────────────────────────

const ALERT_TYPE_LABELS: Record<string, string> = {
  portfolio_value: 'Portfolio Value',
  floor_price:     'Floor Price',
  wallet_activity: 'Wallet Activity',
};

const CONDITION_LABELS: Record<string, string> = {
  above: '↑ Above',
  below: '↓ Below',
};

function AlertTypeBadge({ type }: { type: string }) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    portfolio_value: { bg: '#0a1a2e', border: '#1d4ed8', text: '#90a6ff' },
    floor_price:     { bg: '#1a0a2e', border: '#7c3aed', text: '#a78bfa' },
    wallet_activity: { bg: '#0a2e1a', border: '#15803d', text: '#4fe9b4' },
  };
  const c = colors[type] ?? { bg: '#14161f', border: '#333', text: '#9298b8' };
  return (
    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
      backgroundColor: c.bg, border: `1px solid ${c.border}`, color: c.text, padding: '2px 8px' }}>
      {ALERT_TYPE_LABELS[type] ?? type}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: active ? '#4fe9b4' : 'var(--wr-text-3)' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: active ? '#4fe9b4' : '#3f3f3f', flexShrink: 0 }} />
      {active ? 'Active' : 'Paused'}
    </span>
  );
}

// ─── Quick Create Form ────────────────────────────────────────────────────────

function QuickCreateForm({ walletAddress, apiKey, onCreated }: { walletAddress: string; apiKey: string; onCreated: (rule: AlertRule) => void }) {
  const [alertType, setAlertType] = useState('portfolio_value');
  const [condition, setCondition] = useState('below');
  const [threshold, setThreshold] = useState('');
  const [collection, setCollection] = useState('');
  const [discord, setDiscord] = useState('');
  const [creating, setCreating] = useState(false);

  // Pre-fill Discord webhook from global notification prefs
  useEffect(() => {
    const prefs = loadNotificationPrefs();
    if (prefs.discordWebhook) setDiscord(prefs.discordWebhook);
  }, []);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!threshold || isNaN(parseFloat(threshold))) { setError('Enter a valid threshold.'); return; }
    setError('');
    setCreating(true);
    const input: AlertRuleInput = {
      alert_type: alertType,
      wallet_address: walletAddress,
      threshold_eth: parseFloat(threshold),
      condition,
      collection_slug: alertType === 'floor_price' ? collection || undefined : undefined,
      discord_webhook: discord || undefined,
    };
    try {
      const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (inTauri && apiKey) {
        const id = await createAlert(input);
        onCreated({ ...input, id, active: true, created_at: new Date().toISOString() });
      } else {
        // Browser mode mock
        onCreated({ ...input, id: `local-${Date.now()}`, active: true, created_at: new Date().toISOString() });
      }
      setThreshold('');
      setCollection('');
      setDiscord('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create alert.');
    }
    setCreating(false);
  };

  return (
    <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '24px' }}>
      <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '16px' }}>
        Quick Create Alert
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px 1fr auto', gap: '12px', alignItems: 'end' }}>
        {/* Alert type */}
        <div>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>TYPE</label>
          <select value={alertType} onChange={e => setAlertType(e.target.value)}
            style={{ width: '100%', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', padding: '8px 10px' }}>
            <option value="portfolio_value">Portfolio Value</option>
            <option value="floor_price">Floor Price</option>
            <option value="wallet_activity">Wallet Activity</option>
          </select>
        </div>
        {/* Collection (floor price only) */}
        <div>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>
            {alertType === 'floor_price' ? 'COLLECTION SLUG' : '—'}
          </label>
          <input value={collection} onChange={e => setCollection(e.target.value)}
            disabled={alertType !== 'floor_price'}
            placeholder={alertType === 'floor_price' ? 'e.g. boredapeyachtclub' : ''}
            style={{ width: '100%', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', color: alertType === 'floor_price' ? 'var(--wr-text)' : 'var(--wr-border-hover)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', padding: '8px 10px', outline: 'none' }} />
        </div>
        {/* Condition */}
        <div>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>CONDITION</label>
          <select value={condition} onChange={e => setCondition(e.target.value)}
            style={{ width: '100%', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', padding: '8px 10px' }}>
            <option value="below">Below</option>
            <option value="above">Above</option>
          </select>
        </div>
        {/* Threshold */}
        <div>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>THRESHOLD (ETH)</label>
          <input type="number" min="0" step="0.01" value={threshold} onChange={e => setThreshold(e.target.value)}
            placeholder="0.00"
            style={{ width: '100%', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', padding: '8px 10px', outline: 'none' }} />
        </div>
        {/* Create button */}
        <button onClick={handleCreate} disabled={creating}
          style={{ backgroundColor: '#7c5cff', color: '#000', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, padding: '8px 20px', border: 'none', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.6 : 1, whiteSpace: 'nowrap' }}>
          {creating ? 'Creating…' : '+ Create'}
        </button>
      </div>
      {error && <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', marginTop: '8px' }}>{error}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    if (!inTauri) {
      const wallets = loadWallets();
      const addr = wallets[0]?.address ?? '';
      setWalletAddress(addr);
      setAlerts(EMPTY_ALERTS);
      setLoading(false);
      return;
    }

    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      setApiKey(key);
      const wallets = loadWallets();
      const addr = wallets[0]?.address ?? '';
      setWalletAddress(addr);
      if (addr) {
        const rules = await listAlerts(addr).catch(() => [] as AlertRule[]);
        setAlerts(rules);
      }
      setLoading(false);
    })();
  }, []);

  const activeCount    = alerts.filter(a => a.active).length;
  const triggeredCount = alerts.filter(a => a.last_triggered_at).length;

  const handleCreated = (rule: AlertRule) => setAlerts(prev => [rule, ...prev]);

  const NAV_CARDS = [
    { label: 'Rules',   href: '/alerts/rules',   icon: '⚙', desc: 'Manage alert conditions' },
    { label: 'Feed',    href: '/alerts/feed',     icon: '📡', desc: 'Live alert stream' },
    { label: 'History', href: '/alerts/history',  icon: '🕒', desc: 'Past triggered alerts' },
  ];

  return (
    <ProGate feature="Alerts & Monitoring">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '4px' }}>
            Alerts
          </h1>
          <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
            Real-time on-chain notifications
          </p>
        </div>
        <Link href="/alerts/rules">
          <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, backgroundColor: '#7c5cff', color: '#000', border: 'none', padding: '8px 18px', cursor: 'pointer' }}>
            Manage Rules →
          </button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Alerts',   value: loading ? '—' : String(alerts.length),   color: 'var(--wr-text)' },
          { label: 'Active',         value: loading ? '—' : String(activeCount),      color: '#4fe9b4' },
          { label: 'Ever Triggered', value: loading ? '—' : String(triggeredCount),   color: '#ffb020' },
        ].map(card => (
          <div key={card.label} style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>{card.label}</p>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '28px', fontWeight: 700, color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Nav cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {NAV_CARDS.map(nav => (
          <Link key={nav.href} href={nav.href} style={{ textDecoration: 'none' }}>
            <div className="hover:border-[#333] transition-colors"
              style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '20px', cursor: 'pointer' }}>
              <div style={{ fontSize: '20px', marginBottom: '10px' }}>{nav.icon}</div>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '4px' }}>{nav.label}</p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{nav.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick create */}
      <div className="mb-8">
        <QuickCreateForm walletAddress={walletAddress} apiKey={apiKey} onCreated={handleCreated} />
      </div>

      {/* Recent alerts table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            Recent Alerts
          </h2>
          <Link href="/alerts/rules" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', textDecoration: 'none' }}
            className="hover:text-[#9298b8] transition-colors">
            View all →
          </Link>
        </div>

        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[#14161f]"
            style={{ gridTemplateColumns: '140px 1fr 100px 100px 120px 100px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span>Type</span>
            <span>Rule</span>
            <span>Condition</span>
            <span className="text-right">Threshold</span>
            <span className="text-right">Last Triggered</span>
            <span className="text-right">Status</span>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
              Loading alerts…
            </div>
          ) : alerts.length === 0 ? (
            <div className="px-4 py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
              No alerts configured. Create your first alert above.
            </div>
          ) : (
            alerts.map(alert => (
              <div key={alert.id}
                className="grid px-4 py-3 border-b border-[#14161f] last:border-b-0 items-center hover:bg-[#14161f]/50 transition-colors"
                style={{ gridTemplateColumns: '140px 1fr 100px 100px 120px 100px' }}>
                <AlertTypeBadge type={alert.alert_type} />
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {alert.collection_slug ? `${alert.collection_slug}` : alert.wallet_address.slice(0, 10) + '…'}
                </span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                  {CONDITION_LABELS[alert.condition] ?? alert.condition}
                </span>
                <span className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: 'var(--wr-text)' }}>
                  {alert.threshold_eth} ETH
                </span>
                <span className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: alert.last_triggered_at ? '#ffb020' : '#3f3f3f' }}>
                  {alert.last_triggered_at
                    ? new Date(alert.last_triggered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Never'}
                </span>
                <div className="flex justify-end">
                  <StatusDot active={alert.active} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
    </ProGate>
  );
}
