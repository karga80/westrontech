'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { listAlerts, loadAlchemyKey, type AlertRule } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_ALERTS } from '@/lib/emptyData';
import ProGate from '@/components/ProGate';

// ─── Alerts / Feed — matches dMkWk design ────────────────────────────────────

type AlertTab = 'All' | 'Wallet Activity' | 'Price Alerts' | 'Rule';

const TYPE_COLOR: Record<string, string> = {
  portfolio_value: '#FBBF24',
  floor_price:     '#F87171',
  wallet_activity: '#34d399',
};

const TYPE_LABEL: Record<string, string> = {
  portfolio_value: 'Portfolio Alert',
  floor_price:     'Price Alert',
  wallet_activity: 'Wallet Alert',
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ruleToFeedItem(r: AlertRule) {
  const color = TYPE_COLOR[r.alert_type] ?? '#6E6E6E';
  const label = TYPE_LABEL[r.alert_type] ?? r.alert_type;
  const slug  = r.collection_slug ?? r.wallet_address.slice(0, 10) + '…';
  const cond  = r.condition === 'below' ? '↓' : '↑';
  const time  = r.last_triggered_at ? relTime(r.last_triggered_at) : 'Never';
  return {
    color,
    title: `${slug} ${r.condition} ${r.threshold_eth} ETH`,
    desc:  `${label} — ${time}`,
    amount: `${r.threshold_eth} ETH ${cond}`,
    type: r.alert_type,
  };
}

const TABS: AlertTab[] = ['All', 'Wallet Activity', 'Price Alerts', 'Rule'];

export default function AlertsFeedPage() {
  const [tab, setTab] = useState<AlertTab>('All');
  const [allRules, setAllRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const addr = loadWallets()[0]?.address ?? '';
    if (!inTauri) { setAllRules(EMPTY_ALERTS); setLoading(false); return; }
    (async () => {
      await loadAlchemyKey().catch(() => '');
      const data = await listAlerts(addr).catch(() => [] as AlertRule[]);
      setAllRules(data);
      setLoading(false);
    })();
  }, []);

  const feedItems = allRules.map(ruleToFeedItem).filter(item => {
    if (tab === 'Wallet Activity') return item.type === 'wallet_activity';
    if (tab === 'Price Alerts')    return item.type === 'floor_price';
    if (tab === 'Rule')            return item.type === 'portfolio_value';
    return true;
  });

  const activeCount    = allRules.filter(r => r.active).length;
  const triggeredCount = allRules.filter(r => r.last_triggered_at).length;
  const highPriority   = allRules.filter(r => r.threshold_eth > 5).length;

  const stats = [
    { label: 'Active Alerts',  value: loading ? '—' : String(activeCount)    },
    { label: 'Total',          value: loading ? '—' : String(allRules.length) },
    { label: 'High Priority',  value: loading ? '—' : String(highPriority)    },
    { label: 'Ever Triggered', value: loading ? '—' : String(triggeredCount)  },
  ];

  return (
    <ProGate feature="Alerts & Monitoring">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>
      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <Link href="/alerts" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Alerts</Link>
        <span>›</span>
        <span style={{ color: 'var(--wr-text)' }}>Feed</span>
      </div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Alerts</h1>
        <div className="flex items-center gap-2">
          {(['All', 'Wallet Activity', 'Price Alerts', 'Rule'] as AlertTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500,
                padding: '5px 12px',
                color: tab === t ? '#000000' : 'var(--wr-text-3)',
                backgroundColor: tab === t ? '#BEFF00' : 'transparent',
                border: tab === t ? 'none' : '1px solid var(--wr-border)',
                cursor: 'pointer',
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards — gap-as-border */}
      <div className="grid grid-cols-4 overflow-hidden mb-6"
        style={{ backgroundColor: 'var(--wr-border)', border: '1px solid var(--wr-border)', gap: '1px' }}>
        {stats.map(s => (
          <div key={s.label} style={{ backgroundColor: 'var(--wr-surface)', padding: '20px 24px' }}>
            <div style={{ fontFamily: 'var(--font-inter)', fontSize: '28px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '4px' }}>{s.value}</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Alert list */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', overflow: 'hidden' }}>
        {loading ? (
          <div className="px-5 py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>Loading feed…</div>
        ) : feedItems.length === 0 ? (
          <div className="px-5 py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>No alerts in this category.</div>
        ) : feedItems.map((alert, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-4 border-b border-[#1A1A1A] last:border-b-0 hover:bg-[#111111] transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: alert.color, flexShrink: 0 }} />
              <div>
                <div style={{ color: 'var(--wr-text)', fontSize: '13px', fontWeight: 500 }}>{alert.title}</div>
                <div style={{ color: 'var(--wr-text-3)', fontSize: '11px', marginTop: '2px', fontFamily: 'var(--font-jetbrains)' }}>{alert.desc}</div>
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-accent)', flexShrink: 0, marginLeft: '24px' }}>
              {alert.amount}
            </div>
          </div>
        ))}
      </div>

      {/* Nav links to sub-pages */}
      <div className="flex gap-4 mt-6">
        {[
          { href: '/alerts/feed', label: 'Feed', active: true },
          { href: '/alerts/rules', label: 'Rules' },
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
