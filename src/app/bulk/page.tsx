'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import ProGate from '@/components/ProGate';
import EthIcon from '@/components/EthIcon';

// ─── Bulk Actions Page — matches ZN6Ma design ─────────────────────────────────

interface ActionCard {
  accent: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
}

const CARDS: ActionCard[] = [
  {
    accent: '#BEFF00',
    icon: <EthIcon size={22} color="#BEFF00" />,
    title: 'Bulk List',
    description: 'List your bulk NFTs to marketplaces simultaneously, at one price',
    features: [
      'Multi-marketplace support',
      'Auto floor price matching',
      'Batch royalty settings',
      'Gas optimization',
    ],
    cta: 'Start Listing →',
    href: '/bulk/list',
  },
  {
    accent: '#06B6D4',
    icon: <span style={{fontSize:'22px',color:'#06B6D4'}}>⬆</span>,
    title: 'Bulk Bid',
    description: 'Place bids on multiple listings, for the best prices simultaneously',
    features: [
      'Collection-wide bidding',
      'Trait-based bid filters',
      'Auto bid adjustment',
      'Expiry management',
    ],
    cta: 'Start Bidding →',
    href: '/bulk/bulk-bid',
  },
  {
    accent: '#F87171',
    icon: <span style={{fontSize:'22px',color:'#F87171'}}>✕</span>,
    title: 'Bulk Cancel',
    description: 'Cancel multiple active bids or lists to both receive its payment/queue',
    features: [
      'Cancel listings & bids together',
      'Cross-marketplace batch cancel',
      'Smart gas bundling',
      'Expiry-based auto-cancel',
    ],
    cta: 'Start Cancelling →',
    href: '/bulk/cancel',
  },
];

export default function BuildPage() {
  const router = useRouter();
  const content = (
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '48px' }}>

      {/* Page header */}
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '28px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '6px' }}>
          Bulk Actions
        </h1>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-text-3)' }}>
          Execute batch operations across multiple NFTs at once
        </p>
      </div>

      {/* 3 Action Cards */}
      <div className="grid grid-cols-3" style={{ gap: '24px' }}>
        {CARDS.map((card) => (
          <div
            key={card.title}
            className="flex flex-col"
            style={{
              backgroundColor: 'var(--wr-surface)',
              border: '1px solid var(--wr-border)',
              borderRadius: '12px',
              padding: '32px',
              gap: '24px',
              cursor: 'pointer',
            }}
          >
            {/* Header: icon + title + desc */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Icon box */}
              <div style={{
                width: '48px', height: '48px',
                borderRadius: '12px',
                backgroundColor: card.accent + '26',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px', color: card.accent,
                flexShrink: 0,
              }}>
                {card.icon}
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>
                {card.title}
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text-3)', lineHeight: 1.5 }}>
                {card.description}
              </div>
            </div>

            {/* Feature checklist */}
            <ul style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
              {card.features.map((f) => (
                <li key={f} className="flex items-center" style={{ gap: '10px' }}>
                  <span style={{ color: card.accent, fontSize: '14px', flexShrink: 0 }}>✓</span>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-2)' }}>{f}</span>
                </li>
              ))}
            </ul>

            {/* CTA button */}
            <button
              onClick={() => router.push(card.href)}
              className="flex items-center justify-center hover:opacity-90 transition-opacity"
              style={{
                height: '48px',
                borderRadius: '8px',
                backgroundColor: card.accent,
                color: '#0A0A0A',
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '14px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                gap: '8px',
              }}
            >
              {card.cta}
            </button>
          </div>
        ))}
      </div>
    </main>
  );

  return <ProGate feature="Bulk Actions">{content}</ProGate>;
}
