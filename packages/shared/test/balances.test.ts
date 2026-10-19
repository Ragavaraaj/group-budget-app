import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeBalances, simplifyDebts, type Transfer } from '../src/balances';
import { computeShares } from '../src/splits';

describe('computeBalances', () => {
  it('Asha pays ₹300 for dinner shared equally between three', () => {
    const balances = computeBalances(
      [
        {
          payers: [{ userId: 'asha', amountMinor: 30_000 }],
          shares: [
            { userId: 'asha', amountMinor: 10_000 },
            { userId: 'bala', amountMinor: 10_000 },
            { userId: 'chitra', amountMinor: 10_000 },
          ],
        },
      ],
      [],
    );
    expect(Object.fromEntries(balances)).toEqual({ asha: 20_000, bala: -10_000, chitra: -10_000 });
  });

  it('a settlement moves money from the payer back toward zero', () => {
    const expenses = [
      {
        payers: [{ userId: 'asha', amountMinor: 20_000 }],
        shares: [
          { userId: 'asha', amountMinor: 10_000 },
          { userId: 'bala', amountMinor: 10_000 },
        ],
      },
    ];
    const settled = computeBalances(expenses, [
      { fromUser: 'bala', toUser: 'asha', amountMinor: 10_000 },
    ]);
    expect(Object.fromEntries(settled)).toEqual({ asha: 0, bala: 0 });
  });

  it('supports several payers on one expense', () => {
    const balances = computeBalances(
      [
        {
          payers: [
            { userId: 'a', amountMinor: 6_000 },
            { userId: 'b', amountMinor: 4_000 },
          ],
          shares: [
            { userId: 'a', amountMinor: 5_000 },
            { userId: 'b', amountMinor: 5_000 },
          ],
        },
      ],
      [],
    );
    expect(Object.fromEntries(balances)).toEqual({ a: 1_000, b: -1_000 });
  });
});

describe('simplifyDebts', () => {
  it('returns nothing when everyone is square', () => {
    expect(simplifyDebts(new Map([['a', 0]]))).toEqual([]);
  });

  it('chains a → b → c into a → c', () => {
    // a owes b 100, b owes c 100: b nets to zero.
    const transfers = simplifyDebts(
      new Map([
        ['a', -10_000],
        ['b', 0],
        ['c', 10_000],
      ]),
    );
    expect(transfers).toEqual([{ from: 'a', to: 'c', amountMinor: 10_000 }]);
  });

  it('is deterministic when amounts tie', () => {
    const balances = new Map([
      ['b', -5_000],
      ['a', -5_000],
      ['d', 5_000],
      ['c', 5_000],
    ]);
    expect(simplifyDebts(balances)).toEqual(simplifyDebts(new Map([...balances].reverse())));
  });
});

describe('properties', () => {
  const userIds = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'];

  const expenseArb = fc
    .record({
      amount: fc.integer({ min: 1, max: 5_000_000 }),
      payer: fc.constantFrom(...userIds),
      participants: fc.subarray(userIds, { minLength: 1 }),
    })
    .map(({ amount, payer, participants }) => {
      const split = computeShares(
        'equal',
        amount,
        participants.map((userId) => ({ userId })),
      );
      if (!split.ok) throw new Error('split failed');
      return { payers: [{ userId: payer, amountMinor: amount }], shares: split.shares };
    });

  const settlementArb = fc
    .record({
      from: fc.constantFrom(...userIds),
      to: fc.constantFrom(...userIds),
      amount: fc.integer({ min: 1, max: 1_000_000 }),
    })
    .filter(({ from, to }) => from !== to)
    .map(({ from, to, amount }) => ({ fromUser: from, toUser: to, amountMinor: amount }));

  it('balances across a group always sum to zero', () => {
    fc.assert(
      fc.property(
        fc.array(expenseArb, { maxLength: 40 }),
        fc.array(settlementArb, { maxLength: 10 }),
        (expenses, settlements) => {
          const sum = [...computeBalances(expenses, settlements).values()].reduce(
            (a, b) => a + b,
            0,
          );
          return sum === 0;
        },
      ),
    );
  });

  it('applying the suggested transfers clears every balance, in at most n-1 payments', () => {
    fc.assert(
      fc.property(fc.array(expenseArb, { minLength: 1, maxLength: 40 }), (expenses) => {
        const balances = computeBalances(expenses, []);
        const transfers: Transfer[] = simplifyDebts(balances);
        const cleared = computeBalances(
          expenses,
          transfers.map((t) => ({
            fromUser: t.from,
            toUser: t.to,
            amountMinor: t.amountMinor,
          })),
        );
        const involved = [...balances.values()].filter((v) => v !== 0).length;
        return (
          [...cleared.values()].every((v) => v === 0) &&
          transfers.length <= Math.max(0, involved - 1) &&
          transfers.every((t) => t.amountMinor > 0 && t.from !== t.to)
        );
      }),
    );
  });
});
