'use client';

import { useEffect, useState } from 'react';
import {
  bulkUpdateNotifications, updateTrackedNftNotifications,
  DEFAULT_NOTIFICATIONS, type TrackedNft, type TrackedNftNotifications,
} from '@/lib/trackedNftStore';

/**
 * Notification rule editor. Operates on either:
 *  - a single `TrackedNft` (edit that NFT's rules), or
 *  - an array of tracked-NFT ids (apply the same rule set to all of them).
 *
 * The same component powers the per-NFT bell icon and the bulk "Add to
 * tracked (N)" flow on the collection detail page.
 */
export interface TrackedNftNotificationModalProps {
  open: boolean;
  onClose: () => void;
  /** Single-NFT edit target (preferred when editing one NFT). */
  target?: TrackedNft | null;
  /** Bulk edit targets — list of tracked-NFT ids to update in one shot. */
  targetIds?: string[];
  /** Optional title override. Default derives from target. */
  title?: string;
  /** Optional initial notification config (used for bulk where defaults seed). */
  initialNotifications?: TrackedNftNotifications;
}

export function TrackedNftNotificationModal({
  open, onClose, target = null, targetIds, title, initialNotifications,
}: TrackedNftNotificationModalProps): React.ReactElement | null {
  // Seed the form state from whichever source we were handed. When the modal
  // re-opens with a different target, reseed — the `open` + `target?.id` dep
  // list keeps us in sync without leaving stale form state.
  const [form, setForm] = useState<TrackedNftNotifications>(
    () => target?.notifications ?? initialNotifications ?? DEFAULT_NOTIFICATIONS,
  );
  const [thresholdText, setThresholdText] = useState<string>(
    () => (target?.notifications.onListedBelow ?? initialNotifications?.onListedBelow ?? '').toString() || '',
  );

  useEffect(() => {
    if (!open) return;
    const base = target?.notifications ?? initialNotifications ?? DEFAULT_NOTIFICATIONS;
    setForm(base);
    setThresholdText(base.onListedBelow != null ? String(base.onListedBelow) : '');
  }, [open, target?.id, initialNotifications]);

  if (!open) return null;

  const isBulk = Array.isArray(targetIds) && targetIds.length > 0;
  const heading = title
    ?? (isBulk
      ? `Notifications — ${targetIds!.length} NFT${targetIds!.length > 1 ? 's' : ''}`
      : target
        ? `Notifications — ${target.name}`
        : 'Notifications');

  const setField = <K extends keyof TrackedNftNotifications>(key: K, value: TrackedNftNotifications[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const parsedThreshold = thresholdText.trim() === '' ? null : Number(thresholdText);
    const final: TrackedNftNotifications = {
      ...form,
      onListedBelow: Number.isFinite(parsedThreshold) && parsedThreshold! > 0 ? parsedThreshold : null,
    };
    if (isBulk) {
      bulkUpdateNotifications(targetIds!, final);
    } else if (target) {
      updateTrackedNftNotifications(target.contract, target.tokenId, final);
    }
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--wr-surface)', border: '1px solid var(--wr-border)',
          width: '440px', maxWidth: '92vw', zIndex: 9999,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: 'var(--wr-text-3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Tracking Rules
          </span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: 4 }}
            aria-label="Close">×</button>
        </div>
        <div style={{ padding: '14px 18px 4px' }}>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>
            {heading}
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: '10px 18px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <ToggleRow
            label="Notify when listed"
            checked={form.onListed}
            onChange={v => setField('onListed', v)}
          />
          <div>
            <ToggleRow
              label="Notify when listed below"
              checked={thresholdText.trim() !== '' && form.onListedBelow !== null}
              onChange={v => {
                if (v) {
                  const parsed = Number(thresholdText);
                  setField('onListedBelow', Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                } else {
                  setField('onListedBelow', null);
                }
              }}
              trailing={(
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="text" inputMode="decimal" value={thresholdText}
                    placeholder="0.00"
                    onChange={e => {
                      const v = e.target.value.replace(/[^0-9.]/g, '');
                      setThresholdText(v);
                      const parsed = Number(v);
                      setField('onListedBelow', Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                    }}
                    style={{
                      width: '72px', textAlign: 'right',
                      fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600,
                      color: 'var(--wr-text)', backgroundColor: 'var(--wr-overlay)',
                      border: '1px solid var(--wr-border)', padding: '5px 8px', outline: 'none',
                    }}
                  />
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>ETH</span>
                </div>
              )}
            />
          </div>
          <ToggleRow
            label="Notify when sold"
            checked={form.onSold}
            onChange={v => setField('onSold', v)}
          />
          <ToggleRow
            label="Notify when transferred"
            checked={form.onTransferred}
            onChange={v => setField('onTransferred', v)}
          />
        </div>

        {/* Actions */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose}
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
              color: 'var(--wr-text-3)', backgroundColor: 'transparent',
              border: '1px solid var(--wr-border)', padding: '7px 16px', cursor: 'pointer',
            }}>Cancel</button>
          <button onClick={handleSave}
            className="btn-cta"
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
              color: '#000', backgroundColor: '#BEFF00',
              border: '1px solid #BEFF00', padding: '7px 18px', cursor: 'pointer',
            }}>Save Rules</button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function ToggleRow({
  label, checked, onChange, trailing,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        style={{
          width: '30px', height: '16px', borderRadius: '10px',
          backgroundColor: checked ? '#BEFF00' : 'var(--wr-overlay)',
          position: 'relative', border: '1px solid var(--wr-border)',
          padding: 0, cursor: 'pointer', flexShrink: 0,
          transition: 'background-color 0.15s',
        }}
      >
        <div style={{
          position: 'absolute',
          top: '1px',
          left: checked ? '15px' : '1px',
          width: '12px', height: '12px',
          backgroundColor: '#000', borderRadius: '50%',
          transition: 'left 0.15s',
        }} />
      </button>
      <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>{label}</span>
      {trailing}
    </label>
  );
}
