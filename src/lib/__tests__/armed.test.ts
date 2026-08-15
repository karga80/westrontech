import {
  isArmedAt,
  formatRemaining,
  explainArmError,
  armKey,
  MAX_ARM_TTL_HOURS,
  DEFAULT_ARM_TTL_HOURS,
} from '../armed';
import type { ArmedStatus } from '../tauri';

function status(over: Partial<ArmedStatus> = {}): ArmedStatus {
  return {
    address: '0xabc',
    armed: true,
    armed_at: 1_000,
    expires_at: 5_000,
    ...over,
  };
}

describe('isArmedAt', () => {
  it('is false when the status has not been read yet', () => {
    // A missing entry means "not read / could not read", never "disarmed" —
    // claiming disarmed on no information is the same class of lie as
    // claiming armed on no information.
    expect(isArmedAt(undefined, 2_000)).toBe(false);
  });
  it('is false when the backend says disarmed', () => {
    expect(isArmedAt(status({ armed: false }), 2_000)).toBe(false);
  });
  it('is true inside the window', () => {
    expect(isArmedAt(status(), 4_999)).toBe(true);
  });
  it('is false the second the window closes', () => {
    expect(isArmedAt(status(), 5_000)).toBe(false);
    expect(isArmedAt(status(), 5_001)).toBe(false);
  });
  it('is false when armed is true but there is no expiry', () => {
    expect(isArmedAt(status({ expires_at: null }), 2_000)).toBe(false);
  });
});

describe('formatRemaining', () => {
  it('says expired at and past the boundary', () => {
    expect(formatRemaining(1_000, 1_000)).toBe('expired');
    expect(formatRemaining(1_000, 1_001)).toBe('expired');
  });
  it('uses days and hours over a day out', () => {
    expect(formatRemaining(2 * 86400 + 5 * 3600, 0)).toBe('2d 5h');
  });
  it('uses hours and minutes under a day', () => {
    expect(formatRemaining(4 * 3600 + 12 * 60, 0)).toBe('4h 12m');
  });
  it('pads seconds in the final hour so the countdown does not jitter', () => {
    expect(formatRemaining(13 * 60 + 5, 0)).toBe('13m 05s');
    expect(formatRemaining(59, 0)).toBe('0m 59s');
  });
});

describe('explainArmError', () => {
  it('explains a cancelled Touch ID prompt and says the rule was not created', () => {
    const msg = explainArmError('User canceled the operation. (-128)');
    expect(msg).toContain('cancelled');
    expect(msg).toContain('not created');
  });

  it('explains the real keystore NOT_FOUND text', () => {
    // This is the exact string the backend produces: keystore::NOT_FOUND
    // wrapped by fetch_and_verify_key. An earlier version of this matcher
    // looked for "not found" / "no such" / "keychain", none of which appear
    // here — so the friendly branch never ran for the case it existed for.
    const raw = 'wallet key unavailable: No matching entry found in secure storage';
    expect(explainArmError(raw)).toContain('Import the wallet first');
  });

  it('still explains the legacy Keychain phrasings', () => {
    expect(explainArmError('key not found in keychain')).toContain('Import the wallet first');
  });

  it('explains an empty stored key', () => {
    expect(explainArmError('wallet key is empty — cannot arm')).toContain('Re-import');
  });

  it('explains a poisoned session store', () => {
    expect(explainArmError('armed-session store is poisoned — restart the app')).toContain(
      'Quit and reopen'
    );
  });

  it('passes an unrecognised error through rather than inventing a reason', () => {
    expect(explainArmError('rpc timeout after 30s')).toBe('rpc timeout after 30s');
  });
});

describe('armKey', () => {
  it('matches the Rust side: trim + lowercase', () => {
    // wallet::armed::norm does the same. If these drift, the same wallet gets
    // two sessions and the screen shows a stale badge for one of them.
    expect(armKey('  0xAbCdEf  ')).toBe('0xabcdef');
    expect(armKey('0xABCDEF')).toBe(armKey('0xabcdef'));
  });
});

describe('ttl constants', () => {
  it('mirror wallet::armed::MAX_TTL_HOURS / DEFAULT_TTL_HOURS', () => {
    expect(MAX_ARM_TTL_HOURS).toBe(168);
    expect(DEFAULT_ARM_TTL_HOURS).toBe(48);
  });
});
