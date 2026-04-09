'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { listAlerts, loadAlchemyKey, type AlertRule } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { MOCK_ALERTS } from '@/lib/mockData';
import { Tag, type TagVariant } from '@/components/Tag';
import ProGate from '@/components/ProGate';

// ─── Alerts / History — matches MCnvA design ────────────────────────────────

type HistoryTab = 'All' | 'Wallet' | 'Price' | 'Rule' | 'Custom';

const HISTORY_TABS: HistoryTab[] = ['All', 'Wallet', 'Price', 'Rule', 'Custom'];

const ALERT_STATUS_VARIANT: Record<string, TagVariant> = {
  Triggered: 'info',
  Paused:    'warning',
  Active:    'success',
  Inactive:  'danger',
};

const TYPE_TO_TAB: Record<string, HistoryTab> = {
  wallet_activity: 'Wallet',
  floor_price:     'Price',
  portfolio_value: 'Rule',
};

function ruleToEntry(r: AlertRule) {
  const triggered = r.last_triggered_at
    ? new Date(r.last_triggered_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const wallet = r.wallet_address.slice(0, 6) + '…' + r.wallet_address.slice(-4);
  const slug   = r.collection_slug ? `[${r.collection_slug}] ` : '';
  const rule   = `${slug}${r.alert_type.replace('_', ' ')} ${r.condition} ${r.threshold_eth} ETH`;
  const status = r.last_triggered_at ? 'Triggered' : r.active ? 'Active' : 'Inactive';
  const tab    = TYPE_TO_TAB[r.alert_type] ?? 'Rule';
  return { date: triggered, wallet, rule, amount: `${r.threshold_eth} ETH`, status, tab };
}

export default function AlertHistoryPage() {
  const [tab, setTab]     = useState<HistoryTab>('All');
  const [entries, setEntries] = useState<ReturnType<typeof ruleToEntry>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const addr = loadWallets()[0]?.address ?? '';
    if (!inTauri) { setEntries(MOCK_ALERTS.map(ruleToEntry)); setLoading(false); return; }
    (async () => {
      await loadAlchemyKey().catch(() => '');
      const rules = await listAlerts(addr).catch(() => [] as AlertRule[]);
      setEntries(rules.map(ruleToEntry));
      setLoading(false);
    })();
  }, []);

  const visible = entries.filter(e => tab === 'All' || e.tab === tab);

  return (
    <ProGate feature="Alerts & Monitoring">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>
      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <Link href="/alerts" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Alerts</Link>
        <span>›</span>
        <span style={{ color: 'var(--wr-text)' }}>History</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Alert History</h1>
        <div className="flex items-center gap-2">
          <div style={{ border: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)', padding: '6px 12px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)' }}>
            {entries.length} total rules
          </div>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', border: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)', padding: '6px 12px' }}>
            {entries.filter(e => e.status === 'Triggered').length} triggered
          </span>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-[#1A1A1A] mb-5">
        {HISTORY_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500,
              padding: '8px 16px', marginBottom: '-1px',
              color: tab === t ? 'var(--wr-accent)' : '#6E6E6E',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--wr-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}>
            {t}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', overflow: 'hidden' }}>
        <div className="grid px-5 py-2.5 border-b border-[#1A1A1A]"
          style={{ gridTemplateColumns: '1.4fr 0.8fr 3fr 0.8fr 0.9fr', columnGap: '16px', backgroundColor: 'var(--wr-surface)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
          <span>Triggered</span><span>Address</span><span>Rule / Name</span><span>Amount</span><span>Status</span>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>Loading history…</div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>No alert history in this category.</div>
        ) : visible.map((e, i) => (
          <div key={i} className="grid px-5 py-4 border-b border-[#1A1A1A] last:border-b-0 hover:bg-[#111111] transition-colors"
            style={{ gridTemplateColumns: '1.4fr 0.8fr 3fr 0.8fr 0.9fr', columnGap: '16px', alignItems: 'center' }}>
            <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{e.date}</span>
            <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{e.wallet}</span>
            <span style={{ color: 'var(--wr-text)', fontSize: '12px', paddingRight: '16px' }}>{e.rule}</span>
            <span style={{ color: 'var(--wr-accent)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', fontWeight: 600 }}>{e.amount}</span>
            <Tag variant={ALERT_STATUS_VARIANT[e.status] ?? 'neutral'}>{e.status}</Tag>
          </div>
        ))}
      </div>

      <div className="flex gap-4 mt-6">
        {[
          { href: '/alerts/feed', label: 'Feed' },
          { href: '/alerts/rules', label: 'Rules' },
          { href: '/alerts/history', label: 'History', active: true },
        ].map(link => (
          <Link key={link.href} href={link.href}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'active' in link ? 'var(--wr-accent)' : '#6E6E6E', textDecoration: 'none' }}>
            {link.label}
          </Link>
        ))}
      </div>
    </main>
    </ProGate>
  );
}
