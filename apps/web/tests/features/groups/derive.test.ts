import { uuidv7 } from '@budget/shared';
import { describe, expect, it } from 'vitest';
import { buildActivity, deriveMoney, orderMembers } from '@/features/groups/derive';
import { expenseRow, memberRow } from '../../support/helpers';

const [asha, bala, chitra] = [uuidv7(), uuidv7(), uuidv7()];
const G = uuidv7();

const dinner = (paidBy: string, total: number, shares: Record<string, number>, patch = {}) =>
  expenseRow(G, paidBy, {
    amountMinor: total,
    payers: [{ userId: paidBy, amountMinor: total }],
    shares: Object.entries(shares).map(([userId, amountMinor]) => ({ userId, amountMinor })),
    ...patch,
  });

const settlement = (from: string, to: string, amountMinor: number, patch = {}) => ({
  id: uuidv7(),
  groupId: G,
  fromUser: from,
  toUser: to,
  amountMinor,
  occurredOn: '2026-10-02',
  note: '',
  createdBy: from,
  version: 1,
  updatedAt: 1,
  updatedBy: from,
  deletedAt: null,
  serverSeq: 1,
  ...patch,
});

describe('deriveMoney', () => {
  it('matches a hand calculation for a small trip', () => {
    // Asha pays ₹900 dinner for all three; Bala pays ₹300 cab for Asha and Bala only.
    const expenses = [
      dinner(asha, 90_000, { [asha]: 30_000, [bala]: 30_000, [chitra]: 30_000 }),
      dinner(bala, 30_000, { [asha]: 15_000, [bala]: 15_000 }),
    ];
    const { balances, transfers, total } = deriveMoney(expenses, []);
    // Asha: +900 −300 −150 = +450. Bala: +300 −300 −150 = −150. Chitra: −300.
    expect(Object.fromEntries(balances)).toEqual({
      [asha]: 45_000,
      [bala]: -15_000,
      [chitra]: -30_000,
    });
    expect(total).toBe(120_000);
    expect(transfers).toEqual([
      { from: chitra, to: asha, amountMinor: 30_000 },
      { from: bala, to: asha, amountMinor: 15_000 },
    ]);
  });

  it('recording a payment moves the balances toward zero', () => {
    const expenses = [dinner(asha, 20_000, { [asha]: 10_000, [bala]: 10_000 })];
    const { balances, transfers } = deriveMoney(expenses, [settlement(bala, asha, 10_000)]);
    expect([...balances.values()]).toEqual([0, 0]);
    expect(transfers).toEqual([]);
  });

  it('ignores deleted expenses and deleted payments', () => {
    const live = dinner(asha, 20_000, { [asha]: 10_000, [bala]: 10_000 });
    const gone = dinner(asha, 99_000, { [asha]: 0, [bala]: 99_000 }, { deletedAt: 5 });
    const undone = settlement(bala, asha, 10_000, { deletedAt: 5 });
    const { balances } = deriveMoney([live, gone], [undone]);
    expect(Object.fromEntries(balances)).toEqual({ [asha]: 10_000, [bala]: -10_000 });
  });
});

describe('buildActivity', () => {
  it('says added, edited or deleted from the row itself, newest first', () => {
    const added = dinner(
      asha,
      100,
      { [asha]: 100 },
      { version: 1, updatedAt: 10, updatedBy: asha },
    );
    const edited = dinner(
      asha,
      100,
      { [asha]: 100 },
      { version: 3, updatedAt: 30, updatedBy: bala },
    );
    const deleted = dinner(
      asha,
      100,
      { [asha]: 100 },
      { version: 2, updatedAt: 20, deletedAt: 20, updatedBy: chitra },
    );
    const feed = buildActivity(
      [added, edited, deleted],
      [settlement(bala, asha, 50, { updatedAt: 25, updatedBy: bala })],
    );
    expect(feed.map((f) => [f.kind, f.what, f.by])).toEqual([
      ['edited', 'expense', bala],
      ['added', 'payment', bala],
      ['deleted', 'expense', chitra],
      ['added', 'expense', asha],
    ]);
  });

  it('keeps only the most recent entries', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      dinner(asha, 100, { [asha]: 100 }, { updatedAt: i }),
    );
    const feed = buildActivity(many, [], 50);
    expect(feed).toHaveLength(50);
    expect(feed[0]?.at).toBe(79);
  });
});

describe('orderMembers', () => {
  it('puts you first, then others by name, and people who left last', () => {
    const ordered = orderMembers(
      [
        memberRow(G, chitra, { displayName: 'Chitra' }),
        memberRow(G, bala, { displayName: 'Bala', removedAt: 5 }),
        memberRow(G, asha, { displayName: 'Asha' }),
      ],
      chitra,
    );
    expect(ordered.map((m) => m.displayName)).toEqual(['Chitra', 'Asha', 'Bala']);
  });
});
