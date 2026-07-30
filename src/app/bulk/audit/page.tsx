'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Tag, type TagVariant } from '@/components/Tag';
import ProGate from '@/components/ProGate';

// ─── Audit Log — matches eoRUF design ────────────────────────────────────────

const AUDIT_STATUS_VARIANT: Record<string, TagVariant> = {
  completed:  'success',
  failed:     'danger',
  warning:    'warning',
  broadcast:  'info',
  triggered:  'info',
};

const ENTRIES = [
  { time: '2024-05-16 18:75:52', type: 'auto_executed',   entity: 'FROI-086 / Audit Log',                status: 'completed', owner: '● Product-Owner', detail: null },
  { time: '2024-05-12 03:47:53', type: 'status_error',    entity: 'Factory/Unforested / NFI Quota',       status: 'broadcast', owner: '● Product-Owner', detail: null },
  { time: '2024-05-18 08:17:60', type: 'security_blocked', entity: 'Agent invoke event: Apr/NFD7',        status: 'failed',    owner: '● N Update', detail: {
    inputBody: 'TfmLookupID: fA→d238\nMFd_status: 43/4\nAquid: 45Fd',
    outputData: 'CC: [1334W] M1.8LL_081\nPre_model_Abs_init 14\npayload_status: 18Mu\nExpired_update: False\nFailed_status: 17.3',
  }},
  { time: '2024-05-13 14:42:49', type: 'trial_discovered', entity: '⊕ Clover-Abjustmenly / Auth-8',       status: 'broadcast', owner: '● Product-Owner', detail: null },
  { time: '2024-05-12 01:2h:14', type: 'total_fee_total',  entity: '⊕ Factor-Onboarding / Step-3',        status: 'triggered', owner: '● Product-Owner', detail: null },
];

export default function AuditLogPage() {
  const [expanded, setExpanded] = useState<number | null>(2);

  return (
    <ProGate feature="Audit Log">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '12px' }}>
        <Link href="/bulk" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>← Back to Bulk Actions</Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Audit Log</h1>
          <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '4px' }}>Track all automated and manual transaction actions within 30-day window</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 overflow-hidden mb-6"
        style={{ backgroundColor: 'var(--wr-border)', border: '1px solid var(--wr-border)', gap: '1px' }}>
        {[
          { label: 'Total Entries', value: '14,832', color: 'var(--wr-text)' },
          { label: 'Success Rate',  value: '98.3%',  color: '#4fe9b4' },
          { label: 'Errors Logged', value: '4',       color: '#ff8a96' },
          { label: 'Last Action',   value: '12s ago', color: 'var(--wr-text)' },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: 'var(--wr-surface)', padding: '20px 24px' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '24px', fontWeight: 600, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5">
        {[
          { label: 'Nov 15 - 2024', icon: '📅' },
          { label: 'Feb 12 - 2024', icon: '📅' },
          { label: 'Action Type', icon: '↓' },
          { label: 'Outcome', icon: '↓' },
        ].map(f => (
          <button key={f.label} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '6px 12px', cursor: 'pointer' }}>
            {f.label} {f.icon !== '📅' && f.icon}
          </button>
        ))}
        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginLeft: 'auto' }}>7,247 results</span>
        <button style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', overflow: 'hidden' }}>
        <div className="grid px-5 py-2.5 border-b border-[#14161f]"
          style={{ gridTemplateColumns: '1.4fr 1.2fr 3fr 0.8fr 1.2fr', columnGap: '16px', backgroundColor: 'var(--wr-surface)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
          <span>Timestamp</span><span>Action Type</span><span>Entity</span><span>Status</span><span>Owner / Result</span>
        </div>

        {ENTRIES.map((e, i) => {
          const variant = AUDIT_STATUS_VARIANT[e.status] ?? 'neutral';
          const isExpanded = expanded === i;
          return (
            <div key={i} className="border-b border-[#14161f] last:border-b-0">
              <div className="grid px-5 py-4 hover:bg-[#14161f] transition-colors items-center cursor-pointer"
                style={{ gridTemplateColumns: '1.4fr 1.2fr 3fr 0.8fr 1.2fr', columnGap: '16px' }}
                onClick={() => setExpanded(isExpanded ? null : i)}>
                <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{e.time}</span>
                <Tag variant={variant} size="xs">{e.type.replace(/_/g, ' ')}</Tag>
                <span style={{ color: 'var(--wr-text)', fontSize: '12px' }}>{e.entity}</span>
                <Tag variant={variant} size="xs">{e.status}</Tag>
                <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{e.owner}</span>
              </div>
              {/* Expanded detail */}
              {isExpanded && e.detail && (
                <div className="px-5 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '12px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)', whiteSpace: 'pre' }}>
                      {e.detail.inputBody}
                    </div>
                    <div style={{ backgroundColor: '#2a0a0a', border: '1px solid #ff8a96', padding: '12px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', whiteSpace: 'pre' }}>
                      {e.detail.outputData}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-1 mt-5">
        {[1, 2, 3, '...', 5].map((p, i) => (
          <button key={i} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', width: '28px', height: '28px', backgroundColor: p === 1 ? '#7c5cff' : 'var(--wr-surface)', color: p === 1 ? '#0b0c14' : 'var(--wr-text-3)', border: '1px solid var(--wr-border)', cursor: 'pointer' }}>
            {p}
          </button>
        ))}
      </div>
    </main>
    </ProGate>
  );
}
