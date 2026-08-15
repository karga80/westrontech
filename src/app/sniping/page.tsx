'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getEnvelopeStatus,
  createEnvelope,
  revokeEnvelope,
  activateKillSwitch,
  loadAlchemyKey,
  createSnipeRule,
  listSnipeRules,
  deleteSnipeRule,
  setSnipeRuleActive,
  runSnipeCheck,
  armWalletForTasks,
  disarmWalletForTasks,
  walletArmedStatus,
  schedulerStatus,
  setSchedulerEnabled,
  type EnvelopeStatus,
  type SnipeRule,
  type SnipeRuleInput,
  type SnipeResult,
  type SnipeOpportunity,
  type ArmedStatus,
  type SchedulerStatus,
} from '@/lib/tauri';
import {
  isArmedAt,
  formatRemaining,
  formatExpiryClock,
  explainArmError,
  armKey,
  DEFAULT_ARM_TTL_HOURS,
  MAX_ARM_TTL_HOURS,
} from '@/lib/armed';
import { isSimulatedHash, isRealTxHash } from '@/lib/txHash';
import { EMPTY_SNIPE_RULES } from '@/lib/emptyData';
import ProGate from '@/components/ProGate';

const isValidEthAddress = (addr: string): boolean =>
  /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

function weiToEth(weiStr: string): number {
  try {
    return Number(BigInt(weiStr)) / 1e18;
  } catch {
    return 0;
  }
}

function formatEth(eth: number): string {
  return eth.toFixed(4);
}

function formatExpiry(expiresAt: number): string {
  const d = new Date(expiresAt * 1000);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return 'Expired';
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

// ─── Authorization Envelope Panel ────────────────────────────────────────────

interface EnvelopePanelProps {
  isTauri: boolean;
  /** Fired after the kill switch lands — it also drops every armed wallet. */
  onKillSwitch: () => void;
}

function EnvelopePanel({ isTauri, onKillSwitch }: EnvelopePanelProps) {
  const [status, setStatus] = useState<EnvelopeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [perTxCeiling, setPerTxCeiling] = useState('0.1');
  const [hardCap, setHardCap] = useState('1.0');
  const [ttlHours, setTtlHours] = useState('24');
  const [scopeAddresses, setScopeAddresses] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const loadStatus = async () => {
    if (!isTauri) { setStatus(null); return; }
    setLoading(true);
    setError(null);
    try {
      const s = await getEnvelopeStatus();
      setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);

  const handleRevoke = async () => {
    if (!isTauri) return;
    setActionLoading('revoke');
    setError(null);
    try {
      await revokeEnvelope();
      await loadStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleKillSwitch = async () => {
    if (!isTauri) return;
    const confirmed = window.confirm(
      'Kill switch will immediately halt all automated transactions.\n\n' +
        'It also disarms every armed wallet: the keys held in memory for scheduled ' +
        'rules are dropped, and each wallet has to be re-armed with Touch ID before ' +
        'any rule can fire again.\n\nContinue?'
    );
    if (!confirmed) return;
    setActionLoading('kill');
    setError(null);
    try {
      await activateKillSwitch();
      onKillSwitch();
      await loadStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateEnvelope = async () => {
    const perTx = parseFloat(perTxCeiling);
    const cap = parseFloat(hardCap);
    const ttl = parseInt(ttlHours, 10);

    if (isNaN(perTx) || perTx <= 0) {
      setCreateError('Per-tx ceiling must be a positive number.');
      return;
    }
    if (isNaN(cap) || cap <= 0) {
      setCreateError('Hard cap must be a positive number.');
      return;
    }
    if (perTx > cap) {
      setCreateError('Per-tx ceiling cannot exceed hard cap.');
      return;
    }
    if (isNaN(ttl) || ttl <= 0) {
      setCreateError('TTL must be a positive integer (hours).');
      return;
    }

    const scope = scopeAddresses
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    setCreateLoading(true);
    setCreateError(null);
    try {
      await createEnvelope({
        per_tx_ceiling_eth: perTx,
        hard_cap_eth: cap,
        ttl_hours: ttl,
        scope_addresses: scope,
      });
      setShowCreateForm(false);
      setScopeAddresses('');
      await loadStatus();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  const isKillSwitchActive = status?.kill_switch === true;
  const isActive = status?.active === true && !isKillSwitchActive;
  const hasEnvelope = status !== null;

  let borderClass = 'border-[#14161f]';
  let badgeClass = 'bg-[#14161f] text-[#9298b8]';
  let badgeLabel = 'NO ENVELOPE';

  if (isKillSwitchActive) {
    borderClass = 'border-[#ff8a96]';
    badgeClass = 'bg-red-500/20 text-[#ff8a96]';
    badgeLabel = 'KILL SWITCH ACTIVE';
  } else if (isActive) {
    borderClass = 'border-[#4fe9b4]';
    badgeClass = 'bg-[#00d68f22] text-[#4fe9b4]';
    badgeLabel = 'ACTIVE';
  }

  const spentEth = status ? weiToEth(status.spent_wei) : 0;
  const hardCapEth = status ? weiToEth(status.hard_cap_wei) : 0;
  const perTxEth = status ? weiToEth(status.hard_cap_wei) : 0;
  const spentPct = hardCapEth > 0 ? Math.min((spentEth / hardCapEth) * 100, 100) : 0;
  const filledBars = Math.round(spentPct / 10);

  return (
    <div className={`bg-[#14161f] border ${borderClass} rounded-[8px] p-6 mb-6 transition-colors`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[#9298b8] uppercase tracking-wider">
            Authorization Envelope
          </h2>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${badgeClass}`}>
            {badgeLabel}
          </span>
        </div>
        {loading && (
          <span className="text-xs text-[#6e7590]">Loading...</span>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-[#ff4d5e11] border border-[#ff8a96]/30 rounded-[6px] px-4 py-3 text-[#ff8a96] text-sm">
          {error}
        </div>
      )}

      {!isTauri && (
        <p className="text-[#2b2e3f] text-sm mb-4">
          Tauri environment required — envelope management unavailable in browser mode.
        </p>
      )}

      {isTauri && hasEnvelope && status && (
        <div className="mb-4">
          <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
            <div>
              <p className="text-[#6e7590] text-xs uppercase tracking-wider mb-1">Per-tx Ceiling</p>
              <p className="text-white font-medium">{formatEth(perTxEth)} ETH</p>
            </div>
            <div>
              <p className="text-[#6e7590] text-xs uppercase tracking-wider mb-1">Hard Cap</p>
              <p className="text-white font-medium">{formatEth(hardCapEth)} ETH</p>
            </div>
            <div>
              <p className="text-[#6e7590] text-xs uppercase tracking-wider mb-1">Expires</p>
              <p className="text-white font-medium">{formatExpiry(status.expires_at)}</p>
            </div>
          </div>

          <div className="mb-1 flex items-center justify-between text-xs text-[#6e7590]">
            <span>Spent: {formatEth(spentEth)} ETH / {formatEth(hardCapEth)} ETH</span>
            <span>{spentPct.toFixed(0)}%</span>
          </div>
          <div className="flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-sm ${
                  i < filledBars ? 'bg-[#7c5cff]' : 'bg-[#14161f]'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {isTauri && !hasEnvelope && !loading && (
        <p className="text-[#6e7590] text-sm mb-4">
          No active envelope. Create one to enable automated transactions.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-[#7c5cff] text-black font-semibold px-4 py-2 rounded-[6px] text-sm hover:opacity-90 transition-colors"
          >
            Create Envelope
          </button>
        )}
        {hasEnvelope && isActive && (
          <button
            onClick={handleRevoke}
            disabled={actionLoading === 'revoke'}
            className="bg-[#14161f] text-[#9298b8] font-semibold px-4 py-2 rounded-[6px] text-sm hover:bg-[#14161f] disabled:opacity-50 transition-colors"
          >
            {actionLoading === 'revoke' ? 'Revoking...' : 'Revoke'}
          </button>
        )}
        {hasEnvelope && !isKillSwitchActive && (
          <button
            onClick={handleKillSwitch}
            disabled={actionLoading === 'kill'}
            className="bg-[#ff8a96] text-white font-semibold px-4 py-2 rounded-[6px] text-sm hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {actionLoading === 'kill' ? 'Activating...' : 'Kill Switch'}
          </button>
        )}
      </div>

      {/* Inline create form */}
      {showCreateForm && (
        <div className="mt-5 pt-5 border-t border-[#14161f]">
          <h3 className="text-xs font-semibold text-[#9298b8] uppercase tracking-wider mb-4">
            New Envelope
          </h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">Per-tx Ceiling (ETH)</label>
              <input
                type="number"
                value={perTxCeiling}
                onChange={e => setPerTxCeiling(e.target.value)}
                placeholder="0.1"
                min="0"
                step="0.01"
                className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">Hard Cap (ETH)</label>
              <input
                type="number"
                value={hardCap}
                onChange={e => setHardCap(e.target.value)}
                placeholder="1.0"
                min="0"
                step="0.1"
                className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">TTL (hours)</label>
              <input
                type="number"
                value={ttlHours}
                onChange={e => setTtlHours(e.target.value)}
                placeholder="24"
                min="1"
                step="1"
                className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-[#6e7590] mb-1.5">
              Scope Addresses (comma-separated, optional)
            </label>
            <input
              type="text"
              value={scopeAddresses}
              onChange={e => setScopeAddresses(e.target.value)}
              placeholder="0x..., 0x... (leave blank for any)"
              className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-3 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
            />
          </div>
          {createError && (
            <div className="mb-4 bg-[#ff4d5e11] border border-[#ff8a96]/30 rounded-[6px] px-4 py-3 text-[#ff8a96] text-sm">
              {createError}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleCreateEnvelope}
              disabled={createLoading}
              className="bg-[#7c5cff] text-black font-semibold px-4 py-2 rounded-[6px] text-sm hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              {createLoading ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
              className="bg-[#14161f] text-[#9298b8] font-semibold px-4 py-2 rounded-[6px] text-sm hover:bg-[#14161f] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Simulation notice ────────────────────────────────────────────────────────

/**
 * Permanent, non-dismissible. The snipe engine does not touch the chain yet
 * (`src-tauri/src/sniping/engine.rs` produces a simulated hash and sends the
 * transaction to the wallet itself), so a triggered rule has NOT bought
 * anything. This banner comes down when real Seaport fulfilment is wired up —
 * not before.
 */
function SimulationNotice() {
  return (
    <div className="mb-6 rounded-[8px] border border-[#ffb85c]/40 bg-[#ffb85c0f] px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#ffb85c22] text-[#ffb85c]">
          Simulation
        </span>
        <div className="text-sm leading-relaxed text-[#d8bd94]">
          <p className="font-medium text-[#ffb85c]">
            A triggered rule does not buy anything yet.
          </p>
          <p className="mt-1 text-[#9298b8]">
            Sniping runs against real floor prices and real guardrails, but the purchase
            itself is not sent to the chain — no ETH moves and no NFT arrives. Any
            transaction hash shown for a trigger is simulated, not an on-chain receipt.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Scheduler banner ─────────────────────────────────────────────────────────

/**
 * The snipe loop ships OFF. While it is off, rules are stored but never
 * checked — nothing fires on its own. Saying nothing here is the exact silent
 * failure the honesty rules forbid: the user creates a rule, sees it listed as
 * "active", and waits for something that will never happen.
 */
function SchedulerBanner({ isTauri }: { isTauri: boolean }) {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isTauri) { setStatus(null); return; }
    setError(null);
    try {
      setStatus(await schedulerStatus());
    } catch (e: unknown) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [isTauri]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await setSchedulerEnabled(enabled));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri) return null;

  if (error) {
    return (
      <div className="mb-6 rounded-[8px] border border-[#ff8a96]/40 bg-[#ff4d5e11] px-5 py-4 text-sm text-[#ff8a96]">
        Could not read the scheduler state, so this screen cannot tell you whether rules
        are being checked: {error}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="mb-6 rounded-[8px] border border-[#14161f] bg-[#14161f] px-5 py-4 text-sm text-[#6e7590]">
        Reading scheduler state…
      </div>
    );
  }

  const lastCheck = status.last_check_at
    ? new Date(status.last_check_at).toLocaleString()
    : null;
  const skipped = status.last_cycle?.skipped_reason ?? null;

  return (
    <div
      className={`mb-6 rounded-[8px] border px-5 py-4 ${
        status.enabled
          ? 'border-[#4fe9b4]/30 bg-[#00d68f09]'
          : 'border-[#ff8a96]/40 bg-[#ff4d5e11]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm">
          {status.enabled ? (
            <>
              <p className="font-medium text-[#4fe9b4]">
                Scheduler is on — active rules are checked every {status.interval_secs}s.
              </p>
              <p className="mt-1 text-[#6e7590]">
                {lastCheck ? `Last check: ${lastCheck}` : 'No cycle has run yet.'}
                {status.cycles_run > 0 && ` · ${status.cycles_run} cycles this session`}
              </p>
              {skipped && (
                <p className="mt-1 text-[#ffb85c]">
                  Last cycle did no work: {skipped}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-medium text-[#ff8a96]">
                Scheduler is off — no rule will ever fire on its own.
              </p>
              <p className="mt-1 text-[#9298b8]">
                Rules below are stored, but nothing checks them. Turn the scheduler on, or
                use Run Check Now for a single manual pass.
              </p>
            </>
          )}
        </div>
        <button
          onClick={() => toggle(!status.enabled)}
          disabled={busy}
          className={`shrink-0 rounded-[6px] px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
            status.enabled
              ? 'bg-[#14161f] text-[#9298b8] hover:text-white'
              : 'bg-[#7c5cff] text-black hover:opacity-90'
          }`}
        >
          {busy ? 'Saving…' : status.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}

// ─── Armed badge ──────────────────────────────────────────────────────────────

interface ArmedBadgeProps {
  status: ArmedStatus | undefined;
  /** Set when the status could not be read — never render "Disarmed" on a guess. */
  unknown: boolean;
  nowSec: number;
}

function ArmedBadge({ status, unknown, nowSec }: ArmedBadgeProps) {
  if (unknown || !status) {
    return (
      <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#14161f] text-[#6e7590]">
        Arming unknown
      </span>
    );
  }
  const armed = isArmedAt(status, nowSec);
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        armed ? 'bg-[#00d68f22] text-[#4fe9b4]' : 'bg-[#ff4d5e22] text-[#ff8a96]'
      }`}
      title={
        armed && status.expires_at !== null
          ? `Armed until ${formatExpiryClock(status.expires_at)}`
          : 'This wallet cannot sign — rules on it will not fire.'
      }
    >
      {armed && status.expires_at !== null
        ? `Armed · ${formatRemaining(status.expires_at, nowSec)}`
        : 'Disarmed'}
    </span>
  );
}

// ─── Snipe Rule Row ───────────────────────────────────────────────────────────

interface SnipeRuleRowProps {
  rule: SnipeRule;
  result: SnipeResult | undefined;
  armedStatus: ArmedStatus | undefined;
  armedUnknown: boolean;
  nowSec: number;
  rearmBusy: boolean;
  onRearm: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function SnipeRuleRow({
  rule,
  result,
  armedStatus,
  armedUnknown,
  nowSec,
  rearmBusy,
  onRearm,
  onToggle,
  onDelete,
}: SnipeRuleRowProps) {
  let rowHighlight = '';
  if (result) {
    if (result.triggered) rowHighlight = 'bg-[#00d68f09] border-l-2 border-[#4fe9b4]';
    else if (result.error) rowHighlight = 'bg-red-500/5 border-l-2 border-[#ff8a96]';
  }

  // A disarmed wallet cannot sign, so the rule is inert whatever its toggle
  // says. Greying it out is the honest reading — but it is recoverable, so the
  // row also carries the one click that fixes it.
  const armed = isArmedAt(armedStatus, nowSec);
  const inert = !armedUnknown && !armed;

  return (
    <div className={`px-6 py-4 flex items-center gap-4 hover:bg-[#14161f]/40 transition-colors ${rowHighlight} ${inert ? 'opacity-60' : ''}`}>
      {/* Collection badge */}
      <span className="shrink-0 text-xs px-2 py-0.5 rounded font-medium font-mono" style={{ backgroundColor: 'var(--tag-purple-bg)', color: 'var(--tag-purple-text)', border: '1px solid var(--tag-purple-border)' }}>
        {rule.collection_slug}
      </span>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[#9298b8]">Floor below</span>
          <span className="text-[#4fe9b4] font-medium">{rule.target_price_eth} ETH</span>
          <span className="text-[#6e7590]">|</span>
          <span className="text-[#9298b8]">Max qty:</span>
          <span className="text-white">{rule.max_quantity}</span>
          <span className="text-[#6e7590]">|</span>
          <span className="text-[#9298b8]">Triggered:</span>
          <span className="text-white">{rule.triggered_count}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="text-xs text-[#2b2e3f] font-mono truncate">
            {rule.wallet_address.slice(0, 10)}...{rule.wallet_address.slice(-6)}
          </p>
          <ArmedBadge status={armedStatus} unknown={armedUnknown} nowSec={nowSec} />
        </div>
        {inert && (
          <p className="mt-1 text-xs text-[#ff8a96]">
            This wallet is disarmed — the rule cannot fire until you re-arm it with Touch ID.
          </p>
        )}
        {result && (
          <p className={`text-xs mt-1 ${
            result.triggered
              ? 'text-[#4fe9b4]'
              : result.error
              ? 'text-[#ff8a96]'
              : 'text-[#6e7590]'
          }`}>
            {result.triggered && 'Triggered'}
            {!result.triggered && !result.error && 'No match'}
            {result.error && `Error: ${result.error}`}
            {result.triggered && result.tx_hash ? (
              !isRealTxHash(result.tx_hash) ? (
                // The engine still returns `0xSIMULATED_...`: nothing was signed
                // and nothing was broadcast. Linking that to Etherscan would
                // send the user to a "transaction not found" page and let them
                // conclude the chain is lagging rather than that no trade
                // happened — so it is named for what it is, and not linked.
                // Anything else that is not a 32-byte hash gets the same
                // treatment: an unlinkable value is not evidence of a trade.
                <span style={{ marginLeft: '4px' }} className="text-[#ffb46b]">
                  {isSimulatedHash(result.tx_hash)
                    ? '— simulated, nothing was sent'
                    : '— no verifiable transaction hash'}
                </span>
              ) : (
                <span style={{ marginLeft: '4px' }}>
                  — tx <span style={{ fontFamily: 'var(--font-jetbrains)', color: '#90a6ff' }}>{result.tx_hash.slice(0, 10)}…</span>
                  <a href={`https://etherscan.io/tx/${result.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '4px', color: 'var(--wr-text-3)', display: 'inline-flex', verticalAlign: 'middle' }} className="hover:text-[#9298b8] transition-colors">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </a>
                </span>
              )
            ) : ''}
          </p>
        )}
      </div>

      {/* Re-arm — one click, and it prompts Touch ID again on purpose */}
      {inert && (
        <button
          onClick={onRearm}
          disabled={rearmBusy}
          className="shrink-0 rounded-[6px] bg-[#7c5cff] px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {rearmBusy ? 'Waiting for Touch ID…' : 'Re-arm'}
        </button>
      )}

      {/* Active toggle */}
      <button
        onClick={onToggle}
        className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
          rule.active ? 'bg-[#7c5cff]' : 'bg-[#14161f]'
        }`}
        aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            rule.active ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="shrink-0 text-[#2b2e3f] hover:text-[#ff8a96] transition-colors text-sm px-2 py-1 rounded hover:bg-[#ff4d5e11]"
        aria-label="Delete snipe rule"
      >
        Delete
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SnipingPage() {
  const [address, setAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isTauri, setIsTauri] = useState(false);

  // Create form
  const [collectionSlug, setCollectionSlug] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [maxQty, setMaxQty] = useState('1');
  const [ruleWallet, setRuleWallet] = useState('');
  const [armTtlHours, setArmTtlHours] = useState(String(DEFAULT_ARM_TTL_HOURS));
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Armed sessions, keyed by lowercased address (the same key Rust uses).
  // A missing entry means "not read yet / could not read" — never "disarmed".
  const [armedMap, setArmedMap] = useState<Record<string, ArmedStatus>>({});
  const [armedError, setArmedError] = useState<string | null>(null);
  const [armBusy, setArmBusy] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  // Rules list
  const [rules, setRules] = useState<SnipeRule[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Snipe check results (keyed by rule_id)
  const [checkResults, setCheckResults] = useState<Record<string, SnipeResult>>({});
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Real-time snipe opportunities from stream
  const [liveOpportunities, setLiveOpportunities] = useState<SnipeOpportunity[]>([]);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setIsTauri(inTauri);
    const saved = localStorage.getItem('westron_address');
    if (saved) {
      setAddress(saved);
      setRuleWallet(saved);
    }
    if (inTauri) {
      loadAlchemyKey().then(k => { if (k) setApiKey(k); }).catch(() => {});

      // Listen for real-time snipe opportunities from the stream engine
      let unlisten: (() => void) | undefined;
      (async () => {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<SnipeOpportunity>('snipe-opportunity', ({ payload }) => {
          setLiveOpportunities(prev => [payload, ...prev].slice(0, 20));
        });
      })();
      return () => { unlisten?.(); };
    }
  }, []);

  // The countdown has to be visibly live: an armed window that silently lapses
  // while the screen still says "Armed" is exactly the kind of stale claim that
  // makes a user think a rule will fire when it cannot.
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Ordering guard. Answers about a wallet arrive from two places at once: the
  // 30s poll and the user's own Arm/Disarm click. They can overtake each other
  // — a poll that left before the click can come back after it — and the loser
  // must not win. Without this, clicking Disarm shows "Disarmed" and then the
  // badge flips back to "Armed" for a wallet whose key is already gone, which
  // is the screen claiming a rule can fire when it cannot.
  //
  // Every read takes a ticket *before* it starts; a write only lands if no
  // newer ticket has already written that address.
  const nextTicket = useRef(0);
  const appliedTicket = useRef<Record<string, number>>({});

  const applyArmed = useCallback((statuses: ArmedStatus[], ticket: number) => {
    const fresh = statuses.filter(
      s => (appliedTicket.current[armKey(s.address)] ?? 0) <= ticket
    );
    if (fresh.length === 0) return;
    fresh.forEach(s => { appliedTicket.current[armKey(s.address)] = ticket; });
    setArmedMap(prev => {
      const next = { ...prev };
      fresh.forEach(s => { next[armKey(s.address)] = s; });
      return next;
    });
  }, []);

  const refreshArmed = useCallback(async (addresses: string[]) => {
    if (!isTauri) return;
    const unique = Array.from(
      new Set(addresses.filter(isValidEthAddress).map(armKey))
    );
    if (unique.length === 0) return;
    const ticket = ++nextTicket.current;
    try {
      const statuses = await Promise.all(unique.map(a => walletArmedStatus(a)));
      applyArmed(statuses, ticket);
      setArmedError(null);
    } catch (e: unknown) {
      // Do not fall back to "disarmed": that is a claim, and the wrong one
      // would either hide a live key or hide a dead rule.
      setArmedError(e instanceof Error ? e.message : String(e));
    }
  }, [isTauri, applyArmed]);

  const loadRules = async (addr: string) => {
    if (!isTauri) { setRules(EMPTY_SNIPE_RULES); return; }
    setListLoading(true);
    setListError(null);
    try {
      const result = await listSnipeRules(addr);
      setRules(result);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  };

  const handleAddressChange = (val: string) => {
    setAddress(val);
    if (isValidEthAddress(val)) {
      localStorage.setItem('westron_address', val);
      setRuleWallet(val);
      loadRules(val);
    }
  };

  // A saved address used to be restored without ever loading its rules, so the
  // list looked empty until the field was retyped.
  useEffect(() => {
    if (isTauri && isValidEthAddress(address)) loadRules(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);

  useEffect(() => {
    refreshArmed([ruleWallet, ...rules.map(r => r.wallet_address)]);
  }, [refreshArmed, ruleWallet, rules]);

  // Catches disarms that did not come from this screen — the kill switch from
  // another window, or an expiry the backend has already dropped.
  useEffect(() => {
    if (!isTauri) return;
    const id = setInterval(() => {
      refreshArmed([ruleWallet, ...rules.map(r => r.wallet_address)]);
    }, 30_000);
    return () => clearInterval(id);
  }, [isTauri, refreshArmed, ruleWallet, rules]);

  /**
   * Arm, then create. The Touch ID prompt comes out of `armWalletForTasks`, and
   * the rule is only written if it succeeded — a rule on an unarmed wallet is
   * stored but inert, which is the silent failure this flow exists to prevent.
   * On a cancelled prompt the form is left exactly as typed.
   */
  const handleArmAndCreate = async () => {
    if (!isTauri) {
      setFormError('Scheduled rules need the desktop app — the browser build has no key store and cannot arm a wallet.');
      return;
    }
    if (!collectionSlug.trim()) {
      setFormError('Collection slug is required.');
      return;
    }
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      setFormError('Enter a target price in ETH greater than zero.');
      return;
    }
    const qty = parseInt(maxQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setFormError('Max quantity must be at least 1.');
      return;
    }
    if (!isValidEthAddress(ruleWallet)) {
      setFormError('That is not a valid Ethereum address.');
      return;
    }
    const ttl = parseInt(armTtlHours, 10);
    if (isNaN(ttl) || ttl < 1 || ttl > MAX_ARM_TTL_HOURS) {
      setFormError(`Arm the wallet for between 1 and ${MAX_ARM_TTL_HOURS} hours.`);
      return;
    }

    const wallet = ruleWallet.trim();
    setFormLoading(true);
    setFormError(null);

    let armed: ArmedStatus;
    const ticket = ++nextTicket.current;
    try {
      armed = await armWalletForTasks(wallet, ttl);
    } catch (e: unknown) {
      setFormError(explainArmError(e instanceof Error ? e.message : String(e)));
      setFormLoading(false);
      await refreshArmed([wallet]);
      return;
    }
    applyArmed([armed], ticket);

    try {
      const input: SnipeRuleInput = {
        collection_slug: collectionSlug.trim(),
        target_price_eth: price,
        max_quantity: qty,
        wallet_address: wallet,
      };
      const newId = await createSnipeRule(input);
      const newRule: SnipeRule = {
        id: newId,
        collection_slug: input.collection_slug,
        target_price_eth: input.target_price_eth,
        max_quantity: input.max_quantity,
        wallet_address: input.wallet_address,
        active: true,
        triggered_count: 0,
        created_at: new Date().toISOString(),
      };
      setRules(prev => [newRule, ...prev]);
      setCollectionSlug('');
      setTargetPrice('');
      setMaxQty('1');
    } catch (e: unknown) {
      // The wallet stays armed here on purpose: the approval was real, and the
      // panel above now says so. Only the rule failed.
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setFormLoading(false);
    }
  };

  /** Re-arm an existing rule's wallet. Prompts Touch ID again, always. */
  const handleArm = async (wallet: string) => {
    if (!isTauri) return;
    const ttl = parseInt(armTtlHours, 10);
    setArmBusy(armKey(wallet));
    setArmedError(null);
    const ticket = ++nextTicket.current;
    try {
      const status = await armWalletForTasks(
        wallet,
        isNaN(ttl) ? DEFAULT_ARM_TTL_HOURS : ttl
      );
      applyArmed([status], ticket);
    } catch (e: unknown) {
      setArmedError(explainArmError(e instanceof Error ? e.message : String(e)));
    } finally {
      setArmBusy(null);
    }
  };

  const handleDisarm = async (wallet: string) => {
    if (!isTauri) return;
    setArmBusy(armKey(wallet));
    setArmedError(null);
    const ticket = ++nextTicket.current;
    try {
      const status = await disarmWalletForTasks(wallet);
      applyArmed([status], ticket);
    } catch (e: unknown) {
      setArmedError(e instanceof Error ? e.message : String(e));
    } finally {
      setArmBusy(null);
    }
  };

  const handleToggleRule = async (rule: SnipeRule) => {
    if (!isTauri) { setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r)); return; }
    const newActive = !rule.active;
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: newActive } : r));
    try {
      await setSnipeRuleActive(rule.id, newActive);
    } catch {
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: rule.active } : r));
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!isTauri) { setRules(prev => prev.filter(r => r.id !== id)); return; }
    setRules(prev => prev.filter(r => r.id !== id));
    try {
      await deleteSnipeRule(id);
    } catch {
      if (isValidEthAddress(address)) loadRules(address);
    }
  };

  const handleRunCheck = async () => {
    if (!isTauri) {
      setCheckError('A snipe check reads live floor prices through the desktop app — the browser build cannot run one.');
      return;
    }
    if (!apiKey.trim()) {
      setCheckError('An Alchemy API key is required to read floor prices.');
      return;
    }
    setCheckLoading(true);
    setCheckError(null);
    try {
      const results = await runSnipeCheck(apiKey);
      const resultMap: Record<string, SnipeResult> = {};
      for (const r of results) {
        resultMap[r.rule_id] = r;
      }
      setCheckResults(resultMap);
    } catch (e: unknown) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckLoading(false);
    }
  };

  const addressInvalid = address.length >= 3 && !isValidEthAddress(address);
  const addressBorderClass = addressInvalid
    ? 'border-[#ff8a96] focus:border-[#ff8a96]'
    : 'border-[#14161f] focus:border-[#7c5cff]';

  const ruleWalletInvalid = ruleWallet.length >= 3 && !isValidEthAddress(ruleWallet);
  const ruleWalletBorderClass = ruleWalletInvalid
    ? 'border-[#ff8a96] focus:border-[#ff8a96]'
    : 'border-[#14161f] focus:border-[#7c5cff]';

  const triggeredCount = Object.values(checkResults).filter(r => r.triggered).length;
  const errorCount = Object.values(checkResults).filter(r => Boolean(r.error)).length;

  const ruleWalletKey = isValidEthAddress(ruleWallet) ? armKey(ruleWallet) : null;
  const ruleWalletArmed = ruleWalletKey ? armedMap[ruleWalletKey] : undefined;
  const ruleWalletIsArmed = isArmedAt(ruleWalletArmed, nowSec);
  const armedUnknown = Boolean(armedError) || (ruleWalletKey !== null && !ruleWalletArmed);

  return (
    <ProGate feature="Sniping & Automation">
    <main className="min-h-full bg-[#0b0c14] text-white">
      <div className="px-12 py-8">
        {/* Wallet + API key input */}
        <div className="mb-6 flex gap-3">
          <input
            type="text"
            value={address}
            onChange={e => handleAddressChange(e.target.value)}
            placeholder="0x... wallet address"
            className={`flex-1 bg-[#14161f] border rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none transition-colors ${addressBorderClass}`}
          />
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Alchemy API key"
            className="w-48 bg-[#14161f] border border-[#14161f] rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
          />
        </div>

        {/* Two things the user must know before creating anything here */}
        <SimulationNotice />
        <SchedulerBanner isTauri={isTauri} />

        {/* Authorization Envelope */}
        <EnvelopePanel
          isTauri={isTauri}
          onKillSwitch={() => {
            // The backend drops every armed wallet with the kill switch; read
            // the real state back rather than assuming it.
            refreshArmed([ruleWallet, ...rules.map(r => r.wallet_address)]);
          }}
        />

        {/* Create Snipe Rule */}
        <div className="bg-[#14161f] border border-[#14161f] rounded-[8px] p-6 mb-6">
          <h2 className="text-sm font-semibold text-[#9298b8] uppercase tracking-wider mb-4">
            Create Snipe Rule
          </h2>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">Collection Slug</label>
              <input
                type="text"
                value={collectionSlug}
                onChange={e => setCollectionSlug(e.target.value)}
                placeholder="e.g. boredapeyachtclub"
                className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">Target Price (ETH)</label>
              <div className="relative">
                <input
                  type="number"
                  value={targetPrice}
                  onChange={e => setTargetPrice(e.target.value)}
                  placeholder="e.g. 5.0"
                  min="0"
                  step="0.01"
                  className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff] pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6e7590]">
                  ETH
                </span>
              </div>
              <p className="text-xs text-[#2b2e3f] mt-1">Snipe when floor drops below this</p>
            </div>
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">Max Quantity</label>
              <input
                type="number"
                value={maxQty}
                onChange={e => setMaxQty(e.target.value)}
                placeholder="1"
                min="1"
                step="1"
                className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">Wallet</label>
              <input
                type="text"
                value={ruleWallet}
                onChange={e => setRuleWallet(e.target.value)}
                placeholder="0x... address"
                className={`w-full bg-[#14161f] border rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none transition-colors ${ruleWalletBorderClass}`}
              />
            </div>
            <div>
              <label className="block text-xs text-[#6e7590] mb-1.5">
                Keep armed for (hours)
              </label>
              <input
                type="number"
                value={armTtlHours}
                onChange={e => setArmTtlHours(e.target.value)}
                min="1"
                max={MAX_ARM_TTL_HOURS}
                step="1"
                className="w-full bg-[#14161f] border border-[#14161f] rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e7590] focus:outline-none focus:border-[#7c5cff]"
              />
              <p className="text-xs text-[#2b2e3f] mt-1">
                Max {MAX_ARM_TTL_HOURS}h. Quitting Westron ends it sooner.
              </p>
            </div>
          </div>

          {/* ── Arming state for the wallet this rule will use ── */}
          {isTauri && ruleWalletKey && (
            <div
              className={`mb-4 rounded-[6px] border px-4 py-3 ${
                armedUnknown
                  ? 'border-[#14161f] bg-[#14161f]'
                  : ruleWalletIsArmed
                  ? 'border-[#4fe9b4]/30 bg-[#00d68f09]'
                  : 'border-[#ff8a96]/30 bg-[#ff4d5e11]'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <ArmedBadge
                      status={ruleWalletArmed}
                      unknown={armedUnknown}
                      nowSec={nowSec}
                    />
                    <span className="font-mono text-xs text-[#6e7590]">
                      {ruleWallet.slice(0, 10)}…{ruleWallet.slice(-6)}
                    </span>
                  </div>
                  {armedUnknown ? (
                    <p className="mt-2 text-[#9298b8]">
                      {armedError
                        ? `Could not read this wallet's arming state: ${armedError}`
                        : 'Reading this wallet’s arming state…'}
                    </p>
                  ) : ruleWalletIsArmed && ruleWalletArmed?.expires_at ? (
                    <p className="mt-2 text-[#9298b8]">
                      This wallet is armed until{' '}
                      <span className="text-white">
                        {formatExpiryClock(ruleWalletArmed.expires_at)}
                      </span>
                      . Rules on it can sign without asking again during that window.
                    </p>
                  ) : (
                    <p className="mt-2 text-[#9298b8]">
                      This wallet cannot sign. Arm & Create takes one Touch ID approval and
                      opens the window.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-[#6e7590]">
                    The key is held in memory only. <span className="text-[#ffb85c]">Quitting
                    Westron — or shutting the Mac down — disarms it immediately</span>, and
                    rules stop firing until you arm it again. Every arming asks for Touch ID
                    again, including extending one that is already open.
                  </p>
                </div>
                {ruleWalletIsArmed && (
                  <button
                    onClick={() => handleDisarm(ruleWallet)}
                    disabled={armBusy === ruleWalletKey}
                    className="shrink-0 rounded-[6px] bg-[#14161f] px-4 py-2 text-sm font-semibold text-[#9298b8] transition-colors hover:text-white disabled:opacity-50"
                  >
                    {armBusy === ruleWalletKey ? 'Disarming…' : 'Disarm'}
                  </button>
                )}
              </div>
            </div>
          )}

          {formError && (
            <div className="mb-4 bg-[#ff4d5e11] border border-[#ff8a96]/30 rounded-[6px] px-4 py-3 text-[#ff8a96] text-sm">
              {formError}
            </div>
          )}

          <button
            onClick={handleArmAndCreate}
            disabled={formLoading}
            className="bg-[#7c5cff] text-black font-semibold px-6 py-2 rounded-[6px] text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {formLoading ? 'Waiting for Touch ID…' : 'Arm & Create'}
          </button>
          <p className="mt-2 text-xs text-[#6e7590]">
            Creating a rule asks for Touch ID once and keeps the key in memory for the
            window above.
          </p>
        </div>

        {/* Snipe Rules List */}
        <div className="bg-[#14161f] border border-[#14161f] rounded-[8px] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#14161f] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[#9298b8] uppercase tracking-wider">
                Snipe Rules
              </h2>
              {rules.length > 0 && (
                <span className="text-xs text-[#6e7590]">
                  {rules.length} rule{rules.length !== 1 ? 's' : ''}
                </span>
              )}
              {Object.keys(checkResults).length > 0 && (
                <div className="flex gap-2">
                  {triggeredCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-[#00d68f22] text-[#4fe9b4]">
                      {triggeredCount} triggered
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-500/20 text-[#ff8a96]">
                      {errorCount} error{errorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleRunCheck}
              disabled={checkLoading}
              className="bg-[#7c5cff] text-black font-semibold px-4 py-1.5 rounded-[6px] text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {checkLoading ? 'Checking...' : 'Run Check Now'}
            </button>
          </div>

          {checkError && (
            <div className="px-6 py-3 text-[#ff8a96] text-sm border-b border-[#14161f] bg-red-500/5">
              {checkError}
            </div>
          )}

          {listError && (
            <div className="px-6 py-4 text-[#ff8a96] text-sm">
              {listError}
            </div>
          )}

          {listLoading && (
            <div className="px-6 py-8 text-center text-[#2b2e3f] text-sm">
              Loading rules...
            </div>
          )}

          {!listLoading && rules.length === 0 && !listError && (
            <div className="px-6 py-12 text-center text-[#2b2e3f] text-sm">
              No snipe rules configured. Create one above.
            </div>
          )}

          {!listLoading && rules.length > 0 && (
            <div className="divide-y divide-gray-800">
              {rules.map(rule => (
                <SnipeRuleRow
                  key={rule.id}
                  rule={rule}
                  result={checkResults[rule.id]}
                  armedStatus={armedMap[armKey(rule.wallet_address)]}
                  armedUnknown={
                    Boolean(armedError) || !armedMap[armKey(rule.wallet_address)]
                  }
                  nowSec={nowSec}
                  rearmBusy={armBusy === armKey(rule.wallet_address)}
                  onRearm={() => handleArm(rule.wallet_address)}
                  onToggle={() => handleToggleRule(rule)}
                  onDelete={() => handleDeleteRule(rule.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Live Snipe Opportunities (from Stream) ── */}
        {liveOpportunities.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold tracking-[0.15em] text-[#7c5cff] uppercase">Live Opportunities</h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#00d68f14] text-[#4fe9b4] border border-[#00d68f44]">
                  {liveOpportunities.length}
                </span>
              </div>
              <button
                onClick={() => setLiveOpportunities([])}
                className="text-[10px] text-[#2b2e3f] hover:text-[#ff8a96] transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="bg-[#111] border border-[#14161f] rounded-[6px] divide-y divide-[#14161f]">
              {liveOpportunities.map((opp, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1">
                    <div className="text-xs font-medium text-white">{opp.collection_slug}</div>
                    {opp.item?.metadata?.name && (
                      <div className="text-[10px] text-[#6e7590] mt-0.5">{opp.item.metadata.name}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-[#4fe9b4]">{opp.listing_price_eth.toFixed(4)} ETH</div>
                    <div className="text-[10px] text-[#6e7590]">target ≤ {opp.target_price_eth.toFixed(4)}</div>
                  </div>
                  {opp.item?.permalink && (
                    <a
                      href={opp.item.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-semibold px-2.5 py-1 text-black bg-[#7c5cff] hover:opacity-90 transition-opacity shrink-0"
                    >
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
    </ProGate>
  );
}
