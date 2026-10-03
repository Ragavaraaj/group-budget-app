import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/ids';
import {
  budgetDataSchema,
  expenseDataSchema,
  recurringDataSchema,
  settlementDataSchema,
} from '../../src/schemas/entities';
import { pushRequestSchema } from '../../src/schemas/mutations';
import { pullQuerySchema } from '../../src/schemas/sync';

const [a, b, group, category] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];

const expense = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  groupId: group,
  occurredOn: '2026-10-02',
  amountMinor: 10_000,
  categoryId: category,
  note: 'dinner',
  splitType: 'equal',
  payers: [{ userId: a, amountMinor: 10_000 }],
  shares: [
    { userId: a, amountMinor: 5_000 },
    { userId: b, amountMinor: 5_000 },
  ],
  ...overrides,
});

describe('expenseDataSchema', () => {
  it('accepts a balanced expense', () => {
    expect(expenseDataSchema.safeParse(expense()).success).toBe(true);
  });

  it('rejects payments that do not add up to the total', () => {
    const result = expenseDataSchema.safeParse(
      expense({ payers: [{ userId: a, amountMinor: 9_999 }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects shares that do not add up, duplicate people and bad dates', () => {
    expect(
      expenseDataSchema.safeParse(expense({ shares: [{ userId: a, amountMinor: 10_001 }] }))
        .success,
    ).toBe(false);
    expect(
      expenseDataSchema.safeParse(
        expense({
          shares: [
            { userId: a, amountMinor: 5_000 },
            { userId: a, amountMinor: 5_000 },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(expenseDataSchema.safeParse(expense({ occurredOn: '2026-02-30' })).success).toBe(false);
  });

  it('rejects zero, negative and fractional totals', () => {
    for (const amountMinor of [0, -5, 10.5]) {
      expect(expenseDataSchema.safeParse(expense({ amountMinor })).success).toBe(false);
    }
  });
});

describe('settlementDataSchema', () => {
  it('cannot settle with yourself', () => {
    const base = {
      id: uuidv7(),
      groupId: group,
      fromUser: a,
      toUser: b,
      amountMinor: 100,
      occurredOn: '2026-10-02',
      note: '',
    };
    expect(settlementDataSchema.safeParse(base).success).toBe(true);
    expect(settlementDataSchema.safeParse({ ...base, toUser: a }).success).toBe(false);
  });
});

describe('pushRequestSchema', () => {
  const upsert = {
    mutationId: uuidv7(),
    baseVersion: null,
    createdAt: Date.now(),
    op: 'upsert',
    entity: 'expense',
    data: expense(),
  };

  it('accepts upserts and tombstones', () => {
    const result = pushRequestSchema.safeParse({
      mutations: [
        upsert,
        {
          mutationId: uuidv7(),
          baseVersion: 3,
          createdAt: Date.now(),
          op: 'delete',
          entity: 'expense',
          id: uuidv7(),
          groupId: group,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('caps a push at 10 mutations and refuses an empty one', () => {
    const many = Array.from({ length: 11 }, () => ({ ...upsert, mutationId: uuidv7() }));
    expect(pushRequestSchema.safeParse({ mutations: many }).success).toBe(false);
    expect(pushRequestSchema.safeParse({ mutations: [] }).success).toBe(false);
  });

  it('rejects an upsert whose data is for a different entity', () => {
    const bad = { ...upsert, entity: 'category' };
    expect(pushRequestSchema.safeParse({ mutations: [bad] }).success).toBe(false);
  });
});

describe('pullQuerySchema', () => {
  it('defaults and clamps', () => {
    expect(pullQuerySchema.parse({})).toEqual({ since: 0, limit: 100 });
    expect(pullQuerySchema.parse({ since: '42', limit: '5' })).toEqual({ since: 42, limit: 5 });
    expect(pullQuerySchema.safeParse({ limit: '9999' }).success).toBe(false);
    expect(pullQuerySchema.safeParse({ since: '-1' }).success).toBe(false);
  });
});

describe('pushRequestSchema duplicates', () => {
  it('refuses the same mutation id twice in one push', () => {
    const one = {
      mutationId: uuidv7(),
      baseVersion: null,
      createdAt: Date.now(),
      op: 'upsert',
      entity: 'expense',
      data: expense(),
    };
    expect(pushRequestSchema.safeParse({ mutations: [one, one] }).success).toBe(false);
  });
});

describe('budgetDataSchema', () => {
  const budget = (overrides: Record<string, unknown> = {}) => ({
    id: uuidv7(),
    groupId: group,
    categoryId: category,
    amountMinor: 500_000,
    ...overrides,
  });

  it('accepts a category budget and an overall one', () => {
    expect(budgetDataSchema.safeParse(budget()).success).toBe(true);
    expect(budgetDataSchema.safeParse(budget({ categoryId: null })).success).toBe(true);
  });

  it('needs a positive whole number of paise', () => {
    for (const amountMinor of [0, -1, 10.5]) {
      expect(budgetDataSchema.safeParse(budget({ amountMinor })).success).toBe(false);
    }
  });
});

describe('recurringDataSchema', () => {
  const rule = (overrides: Record<string, unknown> = {}) => {
    const { occurredOn: _ignored, ...rest } = expense();
    return {
      ...rest,
      frequency: 'monthly',
      startOn: '2026-11-01',
      endOn: null,
      active: true,
      ...overrides,
    };
  };

  it('accepts a balanced monthly rule, with or without an end', () => {
    expect(recurringDataSchema.safeParse(rule()).success).toBe(true);
    expect(recurringDataSchema.safeParse(rule({ endOn: '2027-03-01' })).success).toBe(true);
  });

  it('keeps the same split checks as an expense', () => {
    expect(
      recurringDataSchema.safeParse(rule({ payers: [{ userId: a, amountMinor: 1 }] })).success,
    ).toBe(false);
  });

  it('refuses an end before the start, an unknown frequency and a bad date', () => {
    expect(recurringDataSchema.safeParse(rule({ endOn: '2026-10-01' })).success).toBe(false);
    expect(recurringDataSchema.safeParse(rule({ frequency: 'daily' })).success).toBe(false);
    expect(recurringDataSchema.safeParse(rule({ startOn: '2026-02-30' })).success).toBe(false);
  });

  it('can be pushed as a mutation', () => {
    const result = pushRequestSchema.safeParse({
      mutations: [
        {
          mutationId: uuidv7(),
          baseVersion: null,
          createdAt: 1,
          op: 'upsert',
          entity: 'recurring',
          data: rule(),
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
