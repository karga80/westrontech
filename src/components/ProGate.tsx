'use client';

import Link from 'next/link';
import { useSubscription } from '@/lib/useSubscription';

interface ProGateProps {
  feature: string;          // e.g. "Sniping & Automation"
  children: React.ReactNode;
}

// Wraps Pro-only UI. Shows an upgrade wall until subscription is active.
// Falls through immediately when loaded + isPro.
export default function ProGate({ feature, children }: ProGateProps) {
  const { isPro, loaded } = useSubscription();

  if (!loaded) return null; // avoid flash

  if (!isPro) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          padding: '48px',
          fontFamily: 'var(--font-jetbrains)',
        }}
      >
        <div style={{
          width: '48px', height: '48px',
          backgroundColor: 'var(--wr-accent-dim)',
          border: '1px solid var(--wr-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px',
        }}>
          ↑
        </div>

        <div style={{ textAlign: 'center', maxWidth: '380px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--wr-text)', marginBottom: '8px' }}>
            {feature} requires Pro
          </div>
          <div style={{ fontSize: '12px', color: 'var(--wr-text-3)', lineHeight: 1.7 }}>
            Upgrade to access sniping, bulk trading, advanced automation, and real-time alerts.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <Link href="/settings#billing"
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700,
              color: '#000000', backgroundColor: 'var(--wr-accent)',
              padding: '10px 24px', textDecoration: 'none',
            }}>
            Upgrade to Pro →
          </Link>
          <Link href="/"
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
              color: 'var(--wr-text-3)', border: '1px solid var(--wr-border)',
              padding: '10px 18px', textDecoration: 'none',
            }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
