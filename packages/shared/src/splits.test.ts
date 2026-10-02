import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateByWeights,
  BASIS_POINTS_TOTAL,
  computeShares,
  type SplitParticipant,
  splitRemainder,
} from './splits';

const people = (n: number, value?: (i: number) => number | undefined): SplitParticipant[] =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, value: value?.(i) }));

const total = (shares: { amountMinor: number }[]) => shares.reduce((s, x) => s + x.amountMinor, 0);

describe('equal split', () => {
  it('divides evenly when it can', () => {
    const result = computeShares('equal', 30_000, people(3));
    expect(result).toEqual({
      ok: true,
      shares: [
        { userId: 'u0', amountMinor: 10_000 },
        { userId: 'u1', amountMinor: 10_000 },
        { userId: 'u2', amountMinor: 10_000 },
      ],
    });
  });

  it('gives the leftover paise to the first people, one each', () => {
    // ₹100.00 / 3 = 33.33 + 33.33 + 33.34 in the exact maths; here 10000 = 3333*3 + 1.
    const result = computeShares('equal', 10_000, people(3));
    expect(result.ok && result.shares.map((s) => s.amountMinor)).toEqual([3334, 3333, 3333]);
  });

  it('handles a single person', () => {
    const result = computeShares('equal', 1, people(1));
    expect(result.ok && result.shares).toEqual([{ userId: 'u0', amountMinor: 1 }]);
  });

  it('handles more people than paise', () => {
    const result = computeShares('equal', 2, people(5));
    expect(result.ok && result.shares.map((s) => s.amountMinor)).toEqual([1, 1, 0, 0, 0]);
  });
});

describe('shares split', () => {
  it('splits by weight: 2 : 1 : 1 of ₹100', () => {
    const result = computeShares(
      'shares',
      10_000,
      people(3, (i) => (i === 0 ? 2 : 1)),
    );
    expect(result.ok && result.shares.map((s) => s.amountMinor)).toEqual([5000, 2500, 2500]);
    expect(result.ok && result.shares.map((s) => s.weight)).toEqual([2, 1, 1]);
  });

  it('rejects zero, negative, fractional or missing weights', () => {
    for (const value of [0, -1, 1.5, undefined]) {
      expect(
        computeShares(
          'shares',
          100,
          people(2, () => value),
        ),
      ).toEqual({
        ok: false,
        error: 'invalid_value',
      });
    }
  });
});

describe('percent split', () => {
  it('uses basis points and must total 100%', () => {
    const ok = computeShares(
      'percent',
      10_000,
      people(2, (i) => (i === 0 ? 7_000 : 3_000)),
    );
    expect(ok.ok && ok.shares.map((s) => s.amountMinor)).toEqual([7000, 3000]);

    const bad = computeShares(
      'percent',
      10_000,
      people(2, () => 4_000),
    );
    expect(bad).toEqual({ ok: false, error: 'sum_mismatch' });
  });

  it('33.33% x3 plus the missing basis point still adds up to the paisa', () => {
    const weights = [3_333, 3_333, 3_334];
    const result = computeShares(
      'percent',
      100_000,
      people(3, (i) => weights[i]),
    );
    expect(result.ok && total(result.shares)).toBe(100_000);
  });
});

describe('exact split', () => {
  it('takes the amounts as entered when they add up', () => {
    const result = computeShares(
      'exact',
      10_000,
      people(2, (i) => (i === 0 ? 2_500 : 7_500)),
    );
    expect(result.ok && result.shares.map((s) => s.amountMinor)).toEqual([2500, 7500]);
  });

  it('allows a zero share but not a mismatch', () => {
    expect(
      computeShares(
        'exact',
        100,
        people(2, (i) => (i === 0 ? 0 : 100)),
      ).ok,
    ).toBe(true);
    expect(
      computeShares(
        'exact',
        100,
        people(2, () => 40),
      ),
    ).toEqual({
      ok: false,
      error: 'sum_mismatch',
    });
  });
});

describe('validation', () => {
  it('rejects bad totals, no participants and duplicates', () => {
    expect(computeShares('equal', 0, people(2))).toEqual({ ok: false, error: 'invalid_total' });
    expect(computeShares('equal', 10.5, people(2))).toEqual({ ok: false, error: 'invalid_total' });
    expect(computeShares('equal', 100, [])).toEqual({ ok: false, error: 'no_participants' });
    expect(computeShares('equal', 100, [{ userId: 'a' }, { userId: 'a' }])).toEqual({
      ok: false,
      error: 'duplicate_participant',
    });
  });
});

describe('splitRemainder', () => {
  it('reports what is left to assign', () => {
    expect(
      splitRemainder(
        'exact',
        10_000,
        people(2, () => 3_000),
      ),
    ).toBe(4_000);
    expect(
      splitRemainder(
        'percent',
        10_000,
        people(2, () => 3_000),
      ),
    ).toBe(BASIS_POINTS_TOTAL - 6_000);
    expect(splitRemainder('equal', 10_000, people(2))).toBe(0);
  });
});

describe('properties', () => {
  const totalArb = fc.integer({ min: 1, max: 10_000_000_000 });

  it('equal: shares always add up to the total and differ by at most one paisa', () => {
    fc.assert(
      fc.property(totalArb, fc.integer({ min: 1, max: 50 }), (amount, n) => {
        const result = computeShares('equal', amount, people(n));
        if (!result.ok) return false;
        const amounts = result.shares.map((s) => s.amountMinor);
        return total(result.shares) === amount && Math.max(...amounts) - Math.min(...amounts) <= 1;
      }),
    );
  });

  it('shares: always add up, and a bigger weight never gets less', () => {
    fc.assert(
      fc.property(
        totalArb,
        fc.array(fc.integer({ min: 1, max: 1_000 }), { minLength: 1, maxLength: 50 }),
        (amount, weights) => {
          const result = computeShares(
            'shares',
            amount,
            people(weights.length, (i) => weights[i]),
          );
          if (!result.ok || total(result.shares) !== amount) return false;
          return result.shares.every((a) =>
            result.shares.every(
              (b) => (a.weight ?? 0) <= (b.weight ?? 0) || a.amountMinor >= b.amountMinor,
            ),
          );
        },
      ),
    );
  });

  it('percent: any split of 100% adds up to the total', () => {
    fc.assert(
      fc.property(
        totalArb,
        fc
          .array(fc.integer({ min: 1, max: 9_999 }), { minLength: 2, maxLength: 20 })
          .map((raw) => {
            // Scale arbitrary positives so they sum to exactly 10000, keeping each at least 1.
            const sum = raw.reduce((a, b) => a + b, 0);
            const scaled = raw.map((x) => Math.max(1, Math.floor((x * BASIS_POINTS_TOTAL) / sum)));
            scaled[0] = (scaled[0] ?? 0) + BASIS_POINTS_TOTAL - scaled.reduce((a, b) => a + b, 0);
            return scaled;
          })
          .filter((weights) => weights.every((w) => w > 0)),
        (amount, weights) => {
          const result = computeShares(
            'percent',
            amount,
            people(weights.length, (i) => weights[i]),
          );
          return result.ok && total(result.shares) === amount;
        },
      ),
    );
  });

  it('allocateByWeights never produces a negative or fractional amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000_000 }),
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 50 }),
        (amount, weights) => {
          const amounts = allocateByWeights(amount, weights);
          return (
            amounts.reduce((a, b) => a + b, 0) === amount &&
            amounts.every((x) => Number.isInteger(x) && x >= 0)
          );
        },
      ),
    );
  });
});
