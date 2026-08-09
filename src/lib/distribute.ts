// Real ETH distribution. Replaces the setTimeout theatre that previously drove
// the Distribute Funds modals: those flipped a row to "Confirmed" after two
// seconds without signing anything, so the screen claimed money had moved when
// nothing had. Every status this module reports comes from an actual
// send_eth call.

import { invoke } from '@tauri-apps/api/core';
import { sendEth } from '@/lib/tauri';

export type SendState = 'queued' | 'submitting' | 'broadcast' | 'failed' | 'skipped';

export interface SendRow {
  id: string;
  name: string;
  address: string;
  valueWei: bigint;
  state: SendState;
  hash?: string;
  error?: string;
}

export interface TransactionPreview {
  authorized: boolean;
  envelope_active: boolean;
  kill_switch: boolean;
  in_scope: boolean;
  reject_code: string | null;
  reject_reason: string | null;
  reject_detail: string | null;
  remaining_wei: string;
  per_tx_ceiling_wei: string;
  hard_cap_wei: string;
  spent_wei: string;
  value_wei: string;
  expires_at: number;
}

/** Zero side effects — asks the envelope engine whether this send would pass. */
export async function previewTransaction(params: {
  to: string;
  valueWei: string;
  calldata?: string | null;
}): Promise<TransactionPreview> {
  return invoke<TransactionPreview>('preview_transaction', {
    to: params.to,
    valueWei: params.valueWei,
    calldata: params.calldata ?? null,
  });
}

/**
 * Parses an ETH decimal string to wei without going through a float.
 * parseFloat('0.1') * 1e18 is not 100000000000000000, and rounding error in a
 * transfer amount is not acceptable.
 */
// BigInt literals (10n) need an ES2020 target; this project builds below that.
const WEI_PER_ETH = BigInt('1000000000000000000');

export function parseEthToWei(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > 18) return null; // more precision than wei can hold
  return BigInt(whole || '0') * WEI_PER_ETH + BigInt((frac + '0'.repeat(18)).slice(0, 18) || '0');
}

export function formatWeiToEth(wei: bigint, dp = 6): string {
  const whole = wei / WEI_PER_ETH;
  const frac = (wei % WEI_PER_ETH).toString().padStart(18, '0').slice(0, dp).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

export const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Sends to each destination in turn, never in parallel.
 *
 * Serial execution is load-bearing, not a style choice: two sends from one
 * address issued concurrently read the same nonce and the second silently
 * replaces the first. The loop also stops at the first failure and marks the
 * rest skipped, so a rejected envelope does not quietly become a partial
 * distribution the user cannot see.
 */
export async function runDistribution(
  fromAddress: string,
  rows: SendRow[],
  apiKey: string,
  onUpdate: (rows: SendRow[]) => void,
): Promise<SendRow[]> {
  const work = rows.map(r => ({ ...r }));
  onUpdate(work.map(r => ({ ...r })));

  for (let i = 0; i < work.length; i++) {
    work[i].state = 'submitting';
    onUpdate(work.map(r => ({ ...r })));

    try {
      const hash = await sendEth(fromAddress, work[i].address, work[i].valueWei.toString(), apiKey);
      work[i].state = 'broadcast';
      work[i].hash = hash;
    } catch (e) {
      work[i].state = 'failed';
      work[i].error = e instanceof Error ? e.message : String(e);
      for (let j = i + 1; j < work.length; j++) work[j].state = 'skipped';
      onUpdate(work.map(r => ({ ...r })));
      return work;
    }
    onUpdate(work.map(r => ({ ...r })));
  }
  return work;
}

/** Turns a backend error into something a user can act on. */
export function explainSendError(raw: string): string {
  const e = raw.toLowerCase();
  if (e.includes('no_envelope') || e.includes('noenvelope')) {
    return 'No spending envelope is active. Create one before sending — Westron refuses to sign without a limit in place.';
  }
  if (e.includes('kill_switch') || e.includes('killswitch')) {
    return 'The kill switch is on. Nothing will be signed until it is cleared.';
  }
  if (e.includes('out_of_scope') || e.includes('outofscope') || e.includes('no_scope')) {
    return 'This destination is not in the active envelope’s scope. Add it to the envelope, or send to an address that is already in scope.';
  }
  if (e.includes('per_tx_ceiling') || e.includes('pertxceiling')) {
    return 'The amount is above the envelope’s per-transaction ceiling. Lower the amount or raise the ceiling.';
  }
  if (e.includes('hard_cap') || e.includes('hardcap')) {
    return 'This would exceed the envelope’s total spend cap. Check how much of the cap is already spent.';
  }
  if (e.includes('expired')) {
    return 'The envelope has expired. Create a new one.';
  }
  if (e.includes('insufficient')) {
    return 'The funding wallet does not hold enough ETH to cover the amount plus gas.';
  }
  if (e.includes('key not found') || e.includes('keychain')) {
    return 'The private key for the funding wallet was not found in the Keychain. Re-import the wallet.';
  }
  return raw;
}
