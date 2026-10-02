import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isUuid, uuidv7, uuidv7Timestamp } from './ids';

describe('uuidv7', () => {
  it('has the v7 layout: version nibble 7, RFC 4122 variant', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]);
  });

  it('encodes the timestamp and reads it back', () => {
    const at = Date.UTC(2026, 9, 2, 12, 30, 15, 123);
    expect(uuidv7Timestamp(uuidv7(at))).toBe(at);
  });

  it('sorts by creation time', () => {
    const ids = [1_000, 5_000, 2_000, 9_000].map((t) => uuidv7(t));
    expect([...ids].sort().map(uuidv7Timestamp)).toEqual([1_000, 2_000, 5_000, 9_000]);
  });

  it('is deterministic for a fixed random source', () => {
    const fixed = (bytes: Uint8Array) => bytes.fill(0xab);
    expect(uuidv7(1_700_000_000_000, fixed)).toBe(uuidv7(1_700_000_000_000, fixed));
  });

  it('does not repeat across many calls', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => uuidv7()));
    expect(ids.size).toBe(2_000);
  });

  it('property: always valid and round-trips any 48-bit timestamp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 48 - 1 }), (t) => {
        const id = uuidv7(t);
        return isUuid(id) && uuidv7Timestamp(id) === t;
      }),
    );
  });
});

describe('isUuid', () => {
  it.each([
    '',
    'not-a-uuid',
    '12345678-1234-1234-1234-12345678901',
    'g2345678-1234-4234-8234-123456789012',
  ])('rejects %j', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
