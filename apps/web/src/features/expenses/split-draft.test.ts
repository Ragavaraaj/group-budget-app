import { describe, expect, it } from 'vitest';
import {
  draftFromExpense,
  newDraft,
  parsePercent,
  percentToString,
  resolveSplit,
  type SplitDraft,
  withType,
} from './split-draft';

const [me, bala, chitra] = ['me', 'bala', 'chitra'];
const base = (patch: Partial<SplitDraft> = {}): SplitDraft => ({
  ...newDraft(me, [me, bala, chitra]),
  ...patch,
});
const paise = (r: ReturnType<typeof resolveSplit>) =>
  r.ok ? r.shares.map((s) => s.amountMinor) : r;

describe('parsePercent', () => {
  it.each([
    ['50', 5000],
    ['33.33', 3333],
    ['33.3', 3330],
    ['100', 10000],
    ['0', 0],
    [' 12.5 ', 1250],
    ['7.', 700],
  ])('%j → %j basis points', (text, expected) => {
    expect(parsePercent(text)).toBe(expected);
  });

  it.each(['', 'abc', '100.01', '101', '-5', '1.234', '1e2'])('rejects %j', (text) => {
    expect(parsePercent(text)).toBeNull();
  });

  it('round-trips through percentToString', () => {
    for (const bp of [0, 1, 50, 1250, 3333, 3330, 10000]) {
      expect(parsePercent(percentToString(bp))).toBe(bp);
    }
  });
});

describe('resolveSplit: who paid', () => {
  it('needs an amount', () => {
    expect(resolveSplit(base(), null)).toEqual({ ok: false, message: 'Enter an amount.' });
    expect(resolveSplit(base(), 0)).toEqual({ ok: false, message: 'Enter an amount.' });
  });

  it('one payer covers the whole amount', () => {
    const r = resolveSplit(base({ payerId: bala }), 30_000);
    expect(r.ok && r.payers).toEqual([{ userId: bala, amountMinor: 30_000 }]);
  });

  it('several payers must add up to the total, and say by how much they miss', () => {
    const draft = base({ multiplePayers: true, payerAmounts: { [me]: '200', [bala]: '50' } });
    expect(resolveSplit(draft, 30_000)).toEqual({
      ok: false,
      message: '₹50 of the payment isn’t assigned yet.',
    });
    expect(
      resolveSplit({ ...draft, payerAmounts: { [me]: '200', [bala]: '150' } }, 30_000),
    ).toEqual({
      ok: false,
      message: 'Payments are ₹50 over the total.',
    });
    const ok = resolveSplit({ ...draft, payerAmounts: { [me]: '200', [bala]: '100' } }, 30_000);
    expect(ok.ok && ok.payers).toEqual([
      { userId: me, amountMinor: 20_000 },
      { userId: bala, amountMinor: 10_000 },
    ]);
  });
});

describe('resolveSplit: equal', () => {
  it('splits between the people included, to the paisa', () => {
    expect(paise(resolveSplit(base(), 10_000))).toEqual([3334, 3333, 3333]);
  });

  it('leaves out people who are unticked', () => {
    const r = resolveSplit(base({ included: [me, chitra] }), 10_000);
    expect(r.ok && r.shares.map((s) => s.userId)).toEqual([me, chitra]);
  });

  it('needs at least one person', () => {
    expect(resolveSplit(base({ included: [] }), 100)).toEqual({
      ok: false,
      message: 'Pick at least one person to split with.',
    });
  });
});

describe('resolveSplit: exact', () => {
  const exact = (values: Record<string, string>) => base({ type: 'exact', values });

  it('takes the amounts when they add up, ignoring blanks and zeros', () => {
    const r = resolveSplit(exact({ [me]: '40', [bala]: '60', [chitra]: '' }), 10_000);
    expect(r.ok && r.shares.map((s) => [s.userId, s.amountMinor])).toEqual([
      [me, 4000],
      [bala, 6000],
    ]);
    expect(resolveSplit(exact({ [me]: '100', [bala]: '0' }), 10_000).ok).toBe(true);
  });

  it('says how much is left, or how much is over', () => {
    expect(resolveSplit(exact({ [me]: '40', [bala]: '30' }), 10_000)).toEqual({
      ok: false,
      message: '₹30 left to assign.',
    });
    expect(resolveSplit(exact({ [me]: '80', [bala]: '30' }), 10_000)).toEqual({
      ok: false,
      message: '₹10 over the total.',
    });
  });

  it('rejects text that is not money', () => {
    expect(resolveSplit(exact({ [me]: 'abc' }), 100)).toEqual({
      ok: false,
      message: 'Check the numbers in the split.',
    });
  });
});

describe('resolveSplit: percent', () => {
  const percent = (values: Record<string, string>) => base({ type: 'percent', values });

  it('splits by percentage', () => {
    const r = resolveSplit(percent({ [me]: '70', [bala]: '30' }), 10_000);
    expect(paise(r)).toEqual([7000, 3000]);
  });

  it('copes with thirds', () => {
    const r = resolveSplit(percent({ [me]: '33.33', [bala]: '33.33', [chitra]: '33.34' }), 10_000);
    expect(r.ok && r.shares.reduce((s, x) => s + x.amountMinor, 0)).toBe(10_000);
  });

  it('says how much of 100% is left', () => {
    expect(resolveSplit(percent({ [me]: '60', [bala]: '30' }), 10_000)).toEqual({
      ok: false,
      message: '10% left to assign.',
    });
    expect(resolveSplit(percent({ [me]: '60', [bala]: '50' }), 10_000)).toEqual({
      ok: false,
      message: '10% over 100%.',
    });
  });
});

describe('resolveSplit: shares', () => {
  it('splits by weight', () => {
    const r = resolveSplit(
      base({ type: 'shares', values: { [me]: '2', [bala]: '1', [chitra]: '1' } }),
      10_000,
    );
    expect(paise(r)).toEqual([5000, 2500, 2500]);
  });

  it('only counts whole numbers', () => {
    expect(resolveSplit(base({ type: 'shares', values: { [me]: '1.5' } }), 100)).toEqual({
      ok: false,
      message: 'Check the numbers in the split.',
    });
  });
});

describe('editing a saved expense', () => {
  it('shows an exact split the way it was typed', () => {
    const draft = draftFromExpense({
      splitType: 'exact',
      payers: [{ userId: me, amountMinor: 10_000 }],
      shares: [
        { userId: me, amountMinor: 2_550 },
        { userId: bala, amountMinor: 7_450 },
      ],
    });
    expect(draft).toMatchObject({
      type: 'exact',
      payerId: me,
      multiplePayers: false,
      values: { [me]: '25.50', [bala]: '74.50' },
    });
    expect(resolveSplit(draft, 10_000).ok).toBe(true);
  });

  it('restores percent and shares weights', () => {
    const percent = draftFromExpense({
      splitType: 'percent',
      payers: [{ userId: me, amountMinor: 10_000 }],
      shares: [
        { userId: me, amountMinor: 3_333, weight: 3333 },
        { userId: bala, amountMinor: 6_667, weight: 6667 },
      ],
    });
    expect(percent.values).toEqual({ [me]: '33.33', [bala]: '66.67' });
    expect(paise(resolveSplit(percent, 10_000))).toEqual([3333, 6667]);

    const shares = draftFromExpense({
      splitType: 'shares',
      payers: [{ userId: me, amountMinor: 900 }],
      shares: [
        { userId: me, amountMinor: 600, weight: 2 },
        { userId: bala, amountMinor: 300, weight: 1 },
      ],
    });
    expect(shares.values).toEqual({ [me]: '2', [bala]: '1' });
  });

  it('restores several payers', () => {
    const draft = draftFromExpense({
      splitType: 'equal',
      payers: [
        { userId: me, amountMinor: 6_000 },
        { userId: bala, amountMinor: 4_000 },
      ],
      shares: [
        { userId: me, amountMinor: 5_000 },
        { userId: bala, amountMinor: 5_000 },
      ],
    });
    expect(draft.multiplePayers).toBe(true);
    expect(draft.payerAmounts).toEqual({ [me]: '60', [bala]: '40' });
  });
});

describe('withType', () => {
  it('starts everyone on one share when switching to shares', () => {
    const draft = withType(base(), 'shares', [me, bala, chitra]);
    expect(draft.values).toEqual({ [me]: '1', [bala]: '1', [chitra]: '1' });
  });

  it('clears typed values when the meaning changes', () => {
    const draft = withType(base({ type: 'exact', values: { [me]: '50' } }), 'percent', [me]);
    expect(draft.values).toEqual({});
  });

  it('does nothing when the type is unchanged', () => {
    const draft = base({ type: 'exact', values: { [me]: '50' } });
    expect(withType(draft, 'exact', [me])).toBe(draft);
  });
});
