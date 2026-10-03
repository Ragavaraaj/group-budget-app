import { uuidv7 } from '@budget/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPull, BACKFILL_PREFIX } from '@/db/apply';
import { BudgetDb, getMeta } from '@/db/database';
import { saveBudget, saveExpense } from '@/db/repo';
import {
  budgetRow,
  categoryRow,
  emptyPull,
  expenseRow,
  groupRow,
  memberRow,
  recurringRow,
} from '../support/helpers';

const ME = uuidv7();
const OTHER = uuidv7();
const G = uuidv7();
let db: BudgetDb;

beforeEach(async () => {
  db = new BudgetDb(`test-${uuidv7()}`);
  await db.open();
});

const apply = (response: ReturnType<typeof emptyPull>, since = 0, updateCursor = true) =>
  applyPull(db, response, { me: ME, since, updateCursor });

describe('applyPull', () => {
  it('stores everything and moves the cursor', async () => {
    const e = expenseRow(G, ME, { serverSeq: 7 });
    const result = await apply(
      emptyPull({
        cursor: 7,
        groups: [groupRow(G, ME, { serverSeq: 2 })],
        members: [memberRow(G, ME, { serverSeq: 3 })],
        categories: [categoryRow(G, ME, { serverSeq: 4 })],
        expenses: [e],
      }),
    );
    expect(result.applied).toBe(4);
    expect(await db.expenses.get(e.id)).toEqual(e);
    expect(await getMeta(db, 'cursor')).toBe(7);
  });

  it('never moves the cursor backwards', async () => {
    await apply(emptyPull({ cursor: 50 }));
    await apply(emptyPull({ cursor: 20 }));
    expect(await getMeta(db, 'cursor')).toBe(50);
  });

  it('keeps tombstones, so history and the activity feed can still show them', async () => {
    const e = expenseRow(G, ME, { deletedAt: 99, version: 2, serverSeq: 9 });
    await apply(emptyPull({ cursor: 9, expenses: [e] }));
    expect((await db.expenses.get(e.id))?.deletedAt).toBe(99);
  });

  it('does not replace a row with an older version of itself', async () => {
    const newer = expenseRow(G, ME, { note: 'new', serverSeq: 20, version: 3 });
    await apply(emptyPull({ expenses: [newer] }));
    await apply(emptyPull({ expenses: [{ ...newer, note: 'old', serverSeq: 10, version: 2 }] }));
    expect((await db.expenses.get(newer.id))?.note).toBe('new');
  });

  it('leaves a row alone while this device still has unsent edits to it', async () => {
    const e = expenseRow(G, ME, { note: 'server', serverSeq: 5 });
    await apply(emptyPull({ expenses: [e] }));
    await saveExpense(db, ME, { ...e, note: 'my unsent edit' });

    await apply(
      emptyPull({ expenses: [{ ...e, note: 'someone elses edit', version: 2, serverSeq: 8 }] }),
    );
    expect((await db.expenses.get(e.id))?.note).toBe('my unsent edit');
  });

  it('keeps other people’s membership rows, including those who left', async () => {
    await apply(
      emptyPull({
        members: [memberRow(G, ME), memberRow(G, OTHER, { removedAt: 123, serverSeq: 4 })],
      }),
    );
    expect((await db.members.get([G, OTHER]))?.removedAt).toBe(123);
  });
});

describe('being removed from a group', () => {
  it('deletes everything about the group, including its queued changes, and says so', async () => {
    const other = uuidv7();
    await apply(
      emptyPull({
        groups: [groupRow(G, ME, { name: 'Goa trip' }), groupRow(other, ME, { name: 'Home' })],
        members: [memberRow(G, ME), memberRow(other, ME)],
        expenses: [expenseRow(G, ME), expenseRow(other, ME)],
        categories: [categoryRow(G, ME)],
      }),
    );
    await saveExpense(db, ME, { ...expenseRow(G, ME), serverSeq: undefined } as never);

    const result = await apply(
      emptyPull({ cursor: 30, members: [memberRow(G, ME, { removedAt: 99, serverSeq: 30 })] }),
      10,
    );
    expect(result.removedFrom).toEqual(['Goa trip']);
    expect(await db.groups.get(G)).toBeUndefined();
    expect(await db.expenses.where('groupId').equals(G).count()).toBe(0);
    expect(await db.categories.where('groupId').equals(G).count()).toBe(0);
    expect(await db.members.where('groupId').equals(G).count()).toBe(0);
    expect(
      await db.outbox
        .where('entityKey')
        .notEqual('')
        .filter((e) => e.groupId === G)
        .count(),
    ).toBe(0);
    // The other group is untouched.
    expect(await db.groups.get(other)).toBeDefined();
    expect(await db.expenses.where('groupId').equals(other).count()).toBe(1);
  });

  it('does not apply leftover rows for a group the person was removed from', async () => {
    const e = expenseRow(G, ME);
    await apply(
      emptyPull({
        members: [memberRow(G, ME, { removedAt: 5 })],
        expenses: [e],
      }),
    );
    expect(await db.expenses.get(e.id)).toBeUndefined();
  });
});

describe('joining a group after the first sync', () => {
  it('queues a backfill, because the group’s history is older than the cursor', async () => {
    await apply(emptyPull({ cursor: 100, groups: [groupRow(uuidv7(), ME)] }), 0);
    await apply(emptyPull({ cursor: 200, members: [memberRow(G, ME, { serverSeq: 150 })] }), 100);
    expect(await getMeta(db, `${BACKFILL_PREFIX}${G}`)).toBe(0);
  });

  it('does not, during the very first sync, which fetches everything anyway', async () => {
    await apply(emptyPull({ cursor: 10, members: [memberRow(G, ME)] }), 0);
    expect(await getMeta(db, `${BACKFILL_PREFIX}${G}`)).toBeUndefined();
  });

  it('does not for a group already known, or for other people joining', async () => {
    await apply(
      emptyPull({ cursor: 10, groups: [groupRow(G, ME)], members: [memberRow(G, ME)] }),
      0,
    );
    await apply(emptyPull({ cursor: 20, members: [memberRow(G, OTHER, { serverSeq: 15 })] }), 10);
    expect(await getMeta(db, `${BACKFILL_PREFIX}${G}`)).toBeUndefined();
  });

  it('does not move the global cursor when applying a backfill page', async () => {
    await apply(emptyPull({ cursor: 100 }), 0);
    await apply(
      emptyPull({ cursor: 5, expenses: [expenseRow(G, ME, { serverSeq: 5 })] }),
      0,
      false,
    );
    expect(await getMeta(db, 'cursor')).toBe(100);
  });
});

describe('applyPull: budgets and recurring rules', () => {
  it('stores them like any other synced row', async () => {
    const b = budgetRow(G, ME, { serverSeq: 3 });
    const r = recurringRow(G, ME, { serverSeq: 4, lastGeneratedOn: '2026-10-01' });
    await apply(emptyPull({ cursor: 4, budgets: [b], recurring: [r] }));
    expect(await db.budgets.get(b.id)).toEqual(b);
    expect(await db.recurring.get(r.id)).toEqual(r);
  });

  it('leaves a budget alone while this device has an unsent edit of it', async () => {
    const b = budgetRow(G, ME, { serverSeq: 3, amountMinor: 100 });
    await apply(emptyPull({ cursor: 3, budgets: [b] }));
    await saveBudget(db, ME, { id: b.id, groupId: G, categoryId: null, amountMinor: 999 });

    await apply(emptyPull({ cursor: 8, budgets: [{ ...b, amountMinor: 555, serverSeq: 8 }] }));
    expect((await db.budgets.get(b.id))?.amountMinor).toBe(999);
  });

  it('takes a newer version of a rule, including what the server worked out', async () => {
    const r = recurringRow(G, ME, { serverSeq: 4 });
    await apply(emptyPull({ cursor: 4, recurring: [r] }));
    await apply(
      emptyPull({
        cursor: 9,
        recurring: [{ ...r, lastGeneratedOn: '2026-12-01', serverSeq: 9 }],
      }),
    );
    expect((await db.recurring.get(r.id))?.lastGeneratedOn).toBe('2026-12-01');
  });

  it('removes them with the rest of a group when the person is removed from it', async () => {
    const b = budgetRow(G, ME);
    const r = recurringRow(G, ME);
    await apply(
      emptyPull({
        cursor: 2,
        groups: [groupRow(G, OTHER)],
        members: [memberRow(G, ME)],
        budgets: [b],
        recurring: [r],
      }),
    );
    await apply(
      emptyPull({
        cursor: 6,
        members: [memberRow(G, ME, { removedAt: 5, serverSeq: 6 })],
      }),
      2,
    );
    expect(await db.budgets.count()).toBe(0);
    expect(await db.recurring.count()).toBe(0);
  });
});
