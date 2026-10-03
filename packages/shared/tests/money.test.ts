import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatPaise, MAX_PAISE, parseRupees, toRupeesString } from '../src/money';

describe('parseRupees', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1234', 123_400],
    ['1,234.5', 123_450],
    ['1,234.50', 123_450],
    ['₹ 1,23,456.78', 12_345_678],
    ['.5', 50],
    ['12.', 1200],
    ['  99.99  ', 9999],
  ])('parses %j as %i paise', (input, expected) => {
    expect(parseRupees(input)).toBe(expected);
  });

  it.each(['', ' ', '.', '-5', '1.234', 'abc', '1e3', '1,2,3.4.5', '12 34x'])(
    'rejects %j',
    (input) => {
      expect(parseRupees(input)).toBeNull();
    },
  );

  it('rejects amounts above the cap and unsafe integers', () => {
    expect(parseRupees('100000000')).toBe(MAX_PAISE);
    expect(parseRupees('100000000.01')).toBeNull();
    expect(parseRupees('99999999999999999999')).toBeNull();
  });

  it('round-trips every paise value through toRupeesString', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_PAISE }), (paise) => {
        expect(parseRupees(toRupeesString(paise))).toBe(paise);
      }),
    );
  });
});

describe('formatPaise', () => {
  it('uses Indian digit grouping and the rupee sign', () => {
    expect(formatPaise(12_345_678)).toBe('₹1,23,456.78');
    expect(formatPaise(10_000_000_000)).toBe('₹10,00,00,000');
  });

  it('hides decimals for whole rupees and shows two otherwise', () => {
    expect(formatPaise(150_000)).toBe('₹1,500');
    expect(formatPaise(150_005)).toBe('₹1,500.05');
    expect(formatPaise(0)).toBe('₹0');
  });

  it('formats negative amounts (balances)', () => {
    expect(formatPaise(-25_050)).toBe('-₹250.50');
  });

  it('never throws for any valid amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: -MAX_PAISE, max: MAX_PAISE }), (paise) => {
        expect(formatPaise(paise)).toContain('₹');
      }),
    );
  });
});

describe('toRupeesString', () => {
  it('omits decimals for whole rupees and pads single-digit paise', () => {
    expect(toRupeesString(12_300)).toBe('123');
    expect(toRupeesString(12_345)).toBe('123.45');
    expect(toRupeesString(12_305)).toBe('123.05');
    expect(toRupeesString(5)).toBe('0.05');
  });

  it('keeps the minus sign of an amount under one rupee', () => {
    expect(toRupeesString(-50)).toBe('-0.50');
    expect(toRupeesString(-150)).toBe('-1.50');
    expect(toRupeesString(-100)).toBe('-1');
  });
});
