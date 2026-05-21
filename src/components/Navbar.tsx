'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from '@/lib/themeContext';
import { loadSubscription, isSubscriptionActive } from '@/lib/subscriptionStore';

const NAV_LINKS = [
  { label: 'Dashboard', href: '/',        pro: false },
  { label: 'Monitor',   href: '/monitor', pro: true  },
  { label: 'Bulk',      href: '/bulk',    pro: true  },
  { label: 'Tasks',     href: '/tasks',     pro: true  },
  { label: 'Sentiment', href: '/sentiment', pro: true  },
];

const ACTIVE_TASKS = [
  {
    icon: '↑',
    title: 'List Bored Ape #3291',
    detail: 'Price: 12.5 ETH · Expires: 7d',
    status: 'Pending',
    statusType: 'accent' as const,
  },
  {
    icon: '↑',
    title: 'Bid on CryptoPunk #5822',
    detail: 'Bid: 80 ETH · Expires: 24h',
    status: 'Pending',
    statusType: 'accent' as const,
  },
  {
    icon: '⇄',
    title: 'Transfer Azuki #1108',
    detail: 'To: Polygon Cold · Now',
    status: 'Processing',
    statusType: 'warn' as const,
  },
];

// ─── Theme Toggle (minimal icon) ────────────────────────────────────────────

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDay = theme === 'day';

  return (
    <button
      onClick={toggle}
      aria-label={isDay ? 'Switch to night mode' : 'Switch to day mode'}
      style={{
        width: '28px',
        height: '28px',
        border: `1px solid ${isDay ? '#D8D8D2' : '#2a2a2a'}`,
        backgroundColor: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'border-color 0.2s',
      }}
    >
      {isDay ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888880" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2"  x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2"  y1="12" x2="5"  y2="12"/>
          <line x1="19" y1="12" x2="22" y2="12"/>
          <line x1="4.22"  y1="4.22"  x2="6.34"  y2="6.34"/>
          <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
          <line x1="4.22"  y1="19.78" x2="6.34"  y2="17.66"/>
          <line x1="17.66" y1="6.34"  x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6E6E6E" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

// ─── Navbar ─────────────────────────────────────────────────────────────────

export default function Navbar() {
  const pathname = usePathname();
  const { theme } = useTheme();
  const isDay = theme === 'day';
  const [tasksOpen, setTasksOpen] = useState(false);
  const tasksRef = useRef<HTMLDivElement>(null);
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    const sync = () => setIsPro(isSubscriptionActive(loadSubscription()));
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const isSettings = pathname === '/settings';
  if (pathname === '/login') return null;

  // Close tasks dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (tasksRef.current && !tasksRef.current.contains(e.target as Node)) setTasksOpen(false);
    }
    if (tasksOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tasksOpen]);

  // Explicit color values — no CSS variable indirection
  const NAV_BG      = isDay ? '#FFFFFF' : '#000000';
  const NAV_BORDER  = isDay ? '#E8E8E3' : '#1A1A1A';
  const NAV_TEXT    = isDay ? '#0D0D0D' : '#FFFFFF';
  const NAV_MUTED   = isDay ? '#8A8A85' : '#6E6E6E';
  const NAV_ACTIVE  = isDay ? '#3D6000' : 'var(--wr-accent)';

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Image
            src="/icon-source.png"
            alt=""
            width={900}
            height={900}
            style={{ height: '22px', width: 'auto', display: 'block' }}
            priority
          />
          <span style={{
            fontFamily: 'var(--font-bellota)',
            fontSize: '18px',
            fontWeight: 700,
            letterSpacing: '4px',
            color: NAV_TEXT,
            textTransform: 'uppercase',
            lineHeight: 1,
          }}>WESTRON</span>
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
        {/* Day / Night toggle */}
        <ThemeToggle />

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

            {/* Tasks indicator chip + dropdown */}
            <div ref={tasksRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setTasksOpen(o => !o)}
                className="flex items-center border"
                style={{
                  borderColor: tasksOpen ? NAV_ACTIVE : NAV_BORDER,
                  padding: '4px 10px',
                  gap: '6px',
                  background: 'none',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: tasksOpen ? NAV_ACTIVE : NAV_MUTED }}>Tasks</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: '#BEFF00', color: '#000000',
                  fontSize: '9px', fontWeight: 700,
                  borderRadius: '8px', padding: '1px 5px',
                  fontFamily: 'var(--font-jetbrains)',
                }}>3</span>
              </button>

              {tasksOpen && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '340px',
                  backgroundColor: 'var(--wr-surface)',
                  border: `1px solid ${NAV_BORDER}`,
                  zIndex: 200,
                  boxShadow: isDay ? '0 8px 32px rgba(0,0,0,0.12)' : '0 8px 32px rgba(0,0,0,0.6)',
                }}>
                  {/* Header */}
                  <div className="flex items-center justify-between" style={{ padding: '14px 16px', borderBottom: `1px solid ${NAV_BORDER}` }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: NAV_TEXT }}>Active Tasks</span>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: NAV_ACTIVE }}>3</span>
                    </div>
                    <Link
                      href="/tasks"
                      onClick={() => setTasksOpen(false)}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: NAV_ACTIVE, textDecoration: 'none' }}
                    >
                      View All →
                    </Link>
                  </div>

                  {/* Task items */}
                  {ACTIVE_TASKS.map((task, i) => {
                    const statusColor = task.statusType === 'warn'
                      ? (isDay ? '#D97706' : '#FBBF24')
                      : NAV_ACTIVE;
                    return (
                    <div key={i} style={{ padding: '12px 16px', borderBottom: i < ACTIVE_TASKS.length - 1 ? `1px solid ${NAV_BORDER}` : 'none' }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2.5">
                          <div style={{
                            width: '26px', height: '26px', flexShrink: 0,
                            backgroundColor: task.statusType === 'warn' ? (isDay ? '#FEF3C7' : '#2a1800') : (isDay ? '#E8FFCC' : '#0a1200'),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '12px', color: statusColor, fontWeight: 700,
                          }}>
                            {task.icon}
                          </div>
                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 500, color: NAV_TEXT }}>{task.title}</span>
                        </div>
                        <span style={{
                          fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                          color: statusColor, border: `1px solid ${statusColor}`,
                          padding: '2px 7px', borderRadius: '20px',
                          display: 'flex', alignItems: 'center', gap: '4px',
                        }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: statusColor, display: 'inline-block', flexShrink: 0 }} />
                          {task.status}
                        </span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: NAV_MUTED, marginBottom: '10px', marginLeft: '34px' }}>
                        {task.detail}
                      </div>
                      <div className="flex items-center gap-2" style={{ marginLeft: '34px' }}>
                        {['Pause', 'Edit'].map(action => (
                          <button key={action} style={{
                            fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 500,
                            color: NAV_MUTED, backgroundColor: 'transparent',
                            border: `1px solid ${NAV_BORDER}`, padding: '3px 10px', cursor: 'pointer',
                          }}>{action}</button>
                        ))}
                        <button style={{
                          fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                          color: isDay ? '#DC2626' : '#F87171', backgroundColor: 'transparent',
                          border: `1px solid ${isDay ? '#DC2626' : '#F87171'}`, padding: '3px 10px', cursor: 'pointer',
                        }}>Cancel</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Subscribe CTA / PRO badge */}
            {isPro ? (
              <span style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                color: '#000000', backgroundColor: 'var(--wr-accent)',
                padding: '3px 8px', letterSpacing: '1px', textTransform: 'uppercase',
                flexShrink: 0,
              }}>PRO</span>
            ) : (
              <Link href="/settings" style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                color: isDay ? '#FFFFFF' : '#000000',
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
