import { formatBlockNum, parseHexBlock, formatChangePct } from '../formatters';

describe('formatBlockNum', () => {
  it('returns MAX_SAFE_INTEGER for dash sentinel', () => {
    expect(formatBlockNum('—')).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('returns MAX_SAFE_INTEGER for empty string', () => {
    expect(formatBlockNum('')).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('returns MAX_SAFE_INTEGER for undefined', () => {
    expect(formatBlockNum(undefined)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('parses comma-formatted number', () => {
    expect(formatBlockNum('12,345')).toBe(12345);
  });
  it('parses plain number string', () => {
    expect(formatBlockNum('12345')).toBe(12345);
  });
});

describe('parseHexBlock', () => {
  it('returns 0 for undefined', () => {
    expect(parseHexBlock(undefined)).toBe(0);
  });
  it('returns 0 for empty string', () => {
    expect(parseHexBlock('')).toBe(0);
  });
  it('returns 0 for malformed hex', () => {
    expect(parseHexBlock('0xZZZZ')).toBe(0);
  });
  it('parses 0xc3500 as 800000', () => {
    expect(parseHexBlock('0xc3500')).toBe(800000);
  });
});

describe('formatChangePct', () => {
  it('returns dash for null', () => {
    expect(formatChangePct(null)).toBe('—');
  });
  it('returns dash for undefined', () => {
    expect(formatChangePct(undefined)).toBe('—');
  });
  it('returns dash for Infinity', () => {
    expect(formatChangePct(Infinity)).toBe('—');
  });
  it('returns dash for NaN', () => {
    expect(formatChangePct(NaN)).toBe('—');
  });
  it('formats positive percentage', () => {
    expect(formatChangePct(1.5)).toBe('+1.50%');
  });
  it('formats negative percentage', () => {
    expect(formatChangePct(-2.3)).toBe('-2.30%');
  });
});
