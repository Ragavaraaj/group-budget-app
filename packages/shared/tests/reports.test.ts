import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_OVER_BP,
  BUDGET_WARN_BP,
  budgetLevel,
  evaluateBudgets,
  newestPerCategory,
} from '../src/budgets';
import {
  changeBetween,
  collapseTail,
  dailyAverage,
  daysElapsed,
  type ReportExpense,
  shareBp,
  spendOf,
  summarise,
  trend,
} from '../src/reports';

const expense = (
  occurredOn: string,
  amountMinor: number,
  categoryId: string | null,
  shares: { userId: string; amountMinor: number }[] = [{ userId: 'me', amountMinor }],
  deletedAt: number | null = null,
): ReportExpense => ({ occurredOn, amountMinor, categoryId, shares, deletedAt });

const october = { start: '2026-10-01', endExclusive: '2026-11-01' };

describe('summarise', () => {
  it('totals the period and breaks it down by category, biggest first', () => {
    const summary = summarise(
      [
        expense('2026-10-01', 10_000, 'food'),
        expense('2026-10-15', 25_000, 'rent'),
        expense('2026-10-31', 5_000, 'food'),
        expense('2026-10-20', 2_000, null),
      ],
      { me: 'me', measure: 'mine', ...october },
    );
    expect(summary.totalMinor).toBe(42_000);
    expect(summary.count).toBe(4);
    expect(summary.byCategory).toEqual([
      { categoryId: 'rent', amountMinor: 25_000, count: 1 },
      { categoryId: 'food', amountMinor: 15_000, count: 2 },
      { categoryId: null, amountMinor: 2_000, count: 1 },
    ]);
  });

  it('leaves out other months, the end day itself, and deleted expenses', () => {
    const summary = summarise(
      [
        expense('2026-09-30', 1_000, 'a'),
        expense('2026-11-01', 2_000, 'a'),
        expense('2026-10-10', 4_000, 'a', undefined, 123),
        expense('2026-10-10', 8_000, 'a'),
      ],
      { me: 'me', measure: 'mine', ...october },
    );
    expect(summary.totalMinor).toBe(8_000);
  });

  it("counts only the person's own share under 'mine', and everything under 'total'", () => {
    const dinner = expense(
      '2026-10-05',
      30_000,
      'food',
      [
        { userId: 'me', amountMinor: 10_000 },
        { userId: 'bala', amountMinor: 20_000 },
      ],
      null,
    );
    const notMine = expense('2026-10-06', 9_000, 'food', [{ userId: 'bala', amountMinor: 9_000 }]);

    const mine = summarise([dinner, notMine], { me: 'me', measure: 'mine', ...october });
    expect(mine.totalMinor).toBe(10_000);
    expect(mine.count).toBe(1);

    const total = summarise([dinner, notMine], { me: 'me', measure: 'total', ...october });
    expect(total.totalMinor).toBe(39_000);
    expect(total.count).toBe(2);
    expect(spendOf(dinner, 'bala', 'mine')).toBe(20_000);
  });

  it('category totals always add up to the total', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            amount: fc.integer({ min: 1, max: 5_000_000 }),
            category: fc.constantFrom('a', 'b', 'c', null),
          }),
          { maxLength: 60 },
        ),
        (items) => {
          const expenses = items.map((i) =>
            expense(`2026-10-${String(i.day).padStart(2, '0')}`, i.amount, i.category),
          );
          const summary = summarise(expenses, { me: 'me', measure: 'mine', ...october });
          const sum = summary.byCategory.reduce((total, c) => total + c.amountMinor, 0);
          expect(sum).toBe(summary.totalMinor);
          expect(summary.totalMinor).toBe(items.reduce((total, i) => total + i.amount, 0));
        },
      ),
    );
  });
});

describe('trend', () => {
  it('gives one total per period, zero for empty ones, in the order asked', () => {
    const points = trend(
      [
        expense('2026-08-20', 1_000, 'a'),
        expense('2026-10-02', 5_000, 'a'),
        expense('2026-10-30', 500, 'a'),
        expense('2026-01-01', 99_999, 'a'), // outside the window
      ],
      { me: 'me', measure: 'mine', keys: ['2026-08', '2026-09', '2026-10'] },
    );
    expect(points).toEqual([
      { key: '2026-08', totalMinor: 1_000 },
      { key: '2026-09', totalMinor: 0 },
      { key: '2026-10', totalMinor: 5_500 },
    ]);
  });

  it('follows a salary-cycle start day', () => {
    const points = trend([expense('2026-10-24', 1_000, 'a'), expense('2026-10-25', 2_000, 'a')], {
      me: 'me',
      measure: 'mine',
      keys: ['2026-09', '2026-10'],
      startDay: 25,
    });
    expect(points.map((p) => p.totalMinor)).toEqual([1_000, 2_000]);
  });
});

describe('small helpers', () => {
  it('averages per day and handles a zero-day period', () => {
    expect(dailyAverage(31_000, 31)).toBe(1_000);
    expect(dailyAverage(100, 3)).toBe(33);
    expect(dailyAverage(500, 0)).toBe(0);
  });

  it('counts the days of a period that have passed', () => {
    expect(daysElapsed('2026-10-01', '2026-11-01', '2026-09-30')).toBe(0);
    expect(daysElapsed('2026-10-01', '2026-11-01', '2026-10-01')).toBe(1);
    expect(daysElapsed('2026-10-01', '2026-11-01', '2026-10-10')).toBe(10);
    expect(daysElapsed('2026-10-01', '2026-11-01', '2026-11-01')).toBe(31);
    expect(daysElapsed('2026-10-01', '2026-11-01', '2027-01-01')).toBe(31);
  });

  it('measures shares and changes in basis points', () => {
    expect(shareBp(1, 3)).toBe(3333);
    expect(shareBp(5, 0)).toBe(0);
    expect(changeBetween(10_000, 12_500)).toEqual({ deltaMinor: 2_500, bp: 2_500 });
    expect(changeBetween(10_000, 7_500)).toEqual({ deltaMinor: -2_500, bp: -2_500 });
    expect(changeBetween(0, 500)).toEqual({ deltaMinor: 500, bp: null });
  });

  it('folds the smallest categories into "other"', () => {
    const list = [10, 8, 6, 4, 2].map((n, i) => ({
      categoryId: `c${i}`,
      amountMinor: n * 100,
      count: 1,
    }));
    const { shown, other } = collapseTail(list, 3);
    expect(shown.map((c) => c.categoryId)).toEqual(['c0', 'c1']);
    expect(other).toEqual({ amountMinor: 1_200, count: 3 });
    expect(collapseTail(list, 5).other).toBeNull();
  });
});

describe('budgets', () => {
  it('turns to a warning at 80% and to over at 100%', () => {
    expect(BUDGET_WARN_BP).toBe(8_000);
    expect(BUDGET_OVER_BP).toBe(10_000);
    expect(budgetLevel(7_999, 10_000)).toBe('ok');
    expect(budgetLevel(8_000, 10_000)).toBe('warn');
    expect(budgetLevel(9_999, 10_000)).toBe('warn');
    expect(budgetLevel(10_000, 10_000)).toBe('over');
    expect(budgetLevel(25_000, 10_000)).toBe('over');
  });

  it("checks each budget against the group's spending in the period", () => {
    const statuses = evaluateBudgets(
      [
        { id: 'all', categoryId: null, amountMinor: 100_000 },
        { id: 'food', categoryId: 'food', amountMinor: 20_000 },
        { id: 'fun', categoryId: 'fun', amountMinor: 50_000 },
      ],
      [
        // Someone else's share still counts: a budget belongs to the group.
        expense('2026-10-03', 18_000, 'food', [{ userId: 'bala', amountMinor: 18_000 }]),
        expense('2026-10-09', 4_000, 'food'),
        expense('2026-10-12', 10_000, null),
        expense('2026-09-30', 70_000, 'food'), // last month: not counted
      ],
      october,
    );
    expect(statuses).toEqual([
      {
        budgetId: 'all',
        categoryId: null,
        amountMinor: 100_000,
        spentMinor: 32_000,
        remainingMinor: 68_000,
        usedBp: 3_200,
        level: 'ok',
      },
      {
        budgetId: 'food',
        categoryId: 'food',
        amountMinor: 20_000,
        spentMinor: 22_000,
        remainingMinor: -2_000,
        usedBp: 11_000,
        level: 'over',
      },
      {
        budgetId: 'fun',
        categoryId: 'fun',
        amountMinor: 50_000,
        spentMinor: 0,
        remainingMinor: 50_000,
        usedBp: 0,
        level: 'ok',
      },
    ]);
  });

  it('keeps the most recently changed budget when two exist for one category', () => {
    const kept = newestPerCategory([
      { id: 'a', categoryId: 'food', amountMinor: 1, updatedAt: 10 },
      { id: 'b', categoryId: 'food', amountMinor: 2, updatedAt: 20 },
      { id: 'c', categoryId: null, amountMinor: 3, updatedAt: 5 },
    ]);
    expect(kept.map((b) => b.id).sort()).toEqual(['b', 'c']);
  });
});
