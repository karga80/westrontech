'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { loadSubscription, isSubscriptionActive } from '@/lib/subscriptionStore';
import WestronLogo from '@/components/WestronLogo';

const NAV_LINKS = [
  { label: 'Dashboard', href: '/',        pro: false },
  { label: 'Monitor',   href: '/monitor', pro: true  },
  { label: 'Bulk',      href: '/bulk',    pro: true  },
];


// ─── Navbar ─────────────────────────────────────────────────────────────────

export default function Navbar() {
  const pathname = usePathname();
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    const sync = () => setIsPro(isSubscriptionActive(loadSubscription()));
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const isSettings = pathname === '/settings';
  if (pathname === '/login') return null;

  // Brand v2 dark shell (fixed theme)
  const NAV_BG      = '#0b0c14';
  const NAV_BORDER  = '#14161f';
  const NAV_TEXT    = '#f2f2f7';
  const NAV_MUTED   = '#6e7590';
  const NAV_ACTIVE  = 'var(--wr-accent)';

  return (
    <header
      className="h-14 flex items-center shrink-0 z-50 select-none"
      data-tauri-drag-region
      style={{
        paddingLeft: '100px', paddingRight: '48px',
        backgroundColor: NAV_BG,
        borderBottom: `1px solid ${NAV_BORDER}`,
        transition: 'background-color 0.25s, border-color 0.25s',
      }}
    >
      {/* Left: Logo + nav */}
      <div className="flex items-center" style={{ gap: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <WestronLogo size={22} wordmark variant="gradient" wordColor={NAV_TEXT} />
        </div>
        <nav className="flex items-center" style={{ gap: '2px' }}>
          {NAV_LINKS.map((link) => {
            const isActive = link.href === '/'
              ? pathname === '/'
              : pathname.startsWith(link.href);
            const locked = link.pro && !isPro;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors"
                style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '13px',
                  fontWeight: 500,
                  padding: '14px 16px',
                  borderLeft: isActive ? `2px solid ${NAV_ACTIVE}` : '2px solid transparent',
                  color: isActive ? NAV_ACTIVE : locked ? NAV_MUTED : NAV_MUTED,
                  textDecoration: 'none',
                  opacity: locked ? 0.45 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                {link.label}
                {locked && (
                  <svg width="9" height="10" viewBox="0 0 9 10" fill="none" style={{ flexShrink: 0 }}>
                    <rect x="1" y="4" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M3 4V2.5a1.5 1.5 0 0 1 3 0V4" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right */}
      <div className="ml-auto flex items-center" style={{ gap: '12px' }}>
        {(() => {
          // Settings icon — always visible
          const settingsIcon = (
            <Link href="/settings" aria-label="Settings" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', border: `1px solid ${isSettings ? NAV_ACTIVE : NAV_BORDER}`, flexShrink: 0, color: isSettings ? NAV_ACTIVE : NAV_MUTED, textDecoration: 'none' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </Link>
          );

          if (isSettings) return settingsIcon;

          return (
          <>
            {/* Gas chip */}
            <div
              className="flex items-center border"
              style={{ borderColor: NAV_BORDER, padding: '4px 10px', gap: '6px' }}
            >
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: NAV_MUTED }}>
                GAS
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 500, color: '#00BCD4' }}>
                24 gwei
              </span>
            </div>


            {/* Subscribe CTA / PRO badge */}
            {isPro ? (
              <span style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                color: '#0b0c14', backgroundColor: 'var(--wr-accent)',
                padding: '3px 8px', letterSpacing: '1px', textTransform: 'uppercase',
                flexShrink: 0,
              }}>PRO</span>
            ) : (
              <Link href="/settings" style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                color: '#0b0c14',
                backgroundColor: NAV_ACTIVE,
                padding: '4px 12px', letterSpacing: '0.5px',
                textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap',
              }}>Subscribe</Link>
            )}

            {settingsIcon}
          </>
          );
        })()}
      </div>
    </header>
  );
}
