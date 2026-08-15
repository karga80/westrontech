import { isSimulatedHash, isRealTxHash } from '../txHash';

const REAL = '0x' + 'a1'.repeat(32);

describe('isSimulatedHash', () => {
  it('recognises the exact string the Rust engine emits', () => {
    // sniping/engine.rs: format!("0xSIMULATED_snipe_{}_{}", rule.id, n)
    expect(isSimulatedHash('0xSIMULATED_snipe_rule-1_1723680000')).toBe(true);
  });
  it('is case-insensitive so a reformat of the prefix cannot silently unhide it', () => {
    expect(isSimulatedHash('0xsimulated_snipe_x')).toBe(true);
  });
  it('is false for a real hash and for nothing at all', () => {
    expect(isSimulatedHash(REAL)).toBe(false);
    expect(isSimulatedHash(null)).toBe(false);
    expect(isSimulatedHash(undefined)).toBe(false);
    expect(isSimulatedHash('')).toBe(false);
  });
});

describe('isRealTxHash', () => {
  it('accepts a 32-byte hex hash', () => {
    expect(isRealTxHash(REAL)).toBe(true);
  });
  it('rejects the simulated placeholder — this is what keeps it off Etherscan', () => {
    expect(isRealTxHash('0xSIMULATED_snipe_rule-1_1723680000')).toBe(false);
  });
  it('rejects near-misses rather than linking something unverifiable', () => {
    expect(isRealTxHash('0x' + 'a1'.repeat(31))).toBe(false); // too short
    expect(isRealTxHash('0x' + 'a1'.repeat(33))).toBe(false); // too long
    expect(isRealTxHash('a1'.repeat(32))).toBe(false); // no 0x
    expect(isRealTxHash('0x' + 'zz'.repeat(32))).toBe(false); // not hex
    expect(isRealTxHash(null)).toBe(false);
  });
});
