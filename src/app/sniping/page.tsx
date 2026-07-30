'use client';

import { useState, useEffect } from 'react';
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
  type EnvelopeStatus,
  type SnipeRule,
  type SnipeRuleInput,
  type SnipeResult,
  type SnipeOpportunity,
} from '@/lib/tauri';
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
}

function EnvelopePanel({ isTauri }: EnvelopePanelProps) {
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
      'Kill switch will immediately halt all automated transactions. Continue?'
    );
    if (!confirmed) return;
    setActionLoading('kill');
    setError(null);
    try {
      await activateKillSwitch();
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

// ─── Snipe Rule Row ───────────────────────────────────────────────────────────

interface SnipeRuleRowProps {
  rule: SnipeRule;
  result: SnipeResult | undefined;
  onToggle: () => void;
  onDelete: () => void;
}

function SnipeRuleRow({ rule, result, onToggle, onDelete }: SnipeRuleRowProps) {
  let rowHighlight = '';
  if (result) {
    if (result.triggered) rowHighlight = 'bg-[#00d68f09] border-l-2 border-[#4fe9b4]';
    else if (result.error) rowHighlight = 'bg-red-500/5 border-l-2 border-[#ff8a96]';
  }

  return (
    <div className={`px-6 py-4 flex items-center gap-4 hover:bg-[#14161f]/40 transition-colors ${rowHighlight}`}>
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
        <p className="text-xs text-[#2b2e3f] mt-0.5 font-mono truncate">
          {rule.wallet_address.slice(0, 10)}...{rule.wallet_address.slice(-6)}
        </p>
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
              <span style={{ marginLeft: '4px' }}>
                — tx <span style={{ fontFamily: 'var(--font-jetbrains)', color: '#90a6ff' }}>{result.tx_hash.slice(0, 10)}…</span>
                <a href={`https://etherscan.io/tx/${result.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: '4px', color: 'var(--wr-text-3)', display: 'inline-flex', verticalAlign: 'middle' }} className="hover:text-[#9298b8] transition-colors">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
              </span>
            ) : ''}
          </p>
        )}
      </div>

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
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

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

  const handleCreateRule = async () => {
    if (!isTauri) {
      const price = parseFloat(targetPrice);
      const qty = parseInt(maxQty, 10);
      if (!collectionSlug.trim() || isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) {
        setFormError('Tüm alanları doğru doldurun.');
        return;
      }
      const newRule: SnipeRule = {
        id: `demo-${Date.now()}`,
        collection_slug: collectionSlug.trim(),
        target_price_eth: price,
        max_quantity: qty,
        wallet_address: ruleWallet || '0xd8dA...6045',
        active: true,
        triggered_count: 0,
        created_at: new Date().toISOString(),
      };
      setRules(prev => [newRule, ...prev]);
      setCollectionSlug('');
      setTargetPrice('');
      setMaxQty('1');
      return;
    }
    if (!collectionSlug.trim()) {
      setFormError('Collection slug gerekli.');
      return;
    }
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      setFormError('Gecerli bir ETH fiyati girin.');
      return;
    }
    const qty = parseInt(maxQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setFormError('Max quantity en az 1 olmali.');
      return;
    }
    if (!isValidEthAddress(ruleWallet)) {
      setFormError('Gecersiz Ethereum adresi.');
      return;
    }

    setFormLoading(true);
    setFormError(null);
    try {
      const input: SnipeRuleInput = {
        collection_slug: collectionSlug.trim(),
        target_price_eth: price,
        max_quantity: qty,
        wallet_address: ruleWallet.trim(),
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
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setFormLoading(false);
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
      setCheckResults({
        'mock-snipe-001': { rule_id: 'mock-snipe-001', collection_slug: 'azuki', floor_price_eth: 3.82, triggered: false },
        'mock-snipe-002': { rule_id: 'mock-snipe-002', collection_slug: 'doodles-official', floor_price_eth: 0.91, triggered: false },
      });
      return;
    }
    if (!apiKey.trim()) {
      setCheckError('Alchemy API key gerekli.');
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

        {/* Authorization Envelope */}
        <EnvelopePanel isTauri={isTauri} />

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
          </div>

          {formError && (
            <div className="mb-4 bg-[#ff4d5e11] border border-[#ff8a96]/30 rounded-[6px] px-4 py-3 text-[#ff8a96] text-sm">
              {formError}
            </div>
          )}

          <button
            onClick={handleCreateRule}
            disabled={formLoading}
            className="bg-[#7c5cff] text-black font-semibold px-6 py-2 rounded-[6px] text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {formLoading ? 'Creating...' : 'Create Snipe Rule'}
          </button>
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
