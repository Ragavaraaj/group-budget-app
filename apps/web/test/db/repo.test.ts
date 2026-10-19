import { uuidv7 } from '@budget/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetDb } from '@/db/database';
import {
  deleteBudget,
  deleteExpense,
  deleteRecurring,
  onLocalWrite,
  restoreExpense,
  restoreRecurring,
  saveBudget,
  saveCategory,
  saveExpense,
  saveRecurring,
} from '@/db/repo';

const ME = uuidv7();
const GROUP = uuidv7();
let db: BudgetDb;

beforeEach(async () => {
  db = new BudgetDb(`test-${uuidv7()}`);
  await db.open();
});

const expense = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  groupId: GROUP,
  occurredOn: '2026-10-02',
  amountMinor: 12_500,
  categoryId: null,
  note: 'chai',
  splitType: 'equal' as const,
  payers: [{ userId: ME, amountMinor: 12_500 }],
  shares: [{ userId: ME, amountMinor: 12_500 }],
  ...overrides,
});

describe('saving an expense', () => {
  it('shows it locally at once and queues one change, with no network involved', async () => {
    const data = expense();
    await saveExpense(db, ME, data);

    expect(await db.expenses.get(data.id)).toMatchObject({
      amountMinor: 12_500,
      createdBy: ME,
      updatedBy: ME,
      version: 0,
      serverSeq: 0,
      deletedAt: null,
    });
    const queue = await db.outbox.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      entity: 'expense',
      entityId: data.id,
      groupId: GROUP,
      op: 'upsert',
      baseVersion: null,
      entityKey: `expense:${data.id}`,
    });
    expect(queue[0]?.data).toEqual(data);
  });

  it('gives every queued change its own id, in the order the changes were made', async () => {
    const [a, b] = [expense({ note: 'a' }), expense({ note: 'b' })];
    await saveExpense(db, ME, a);
    await saveExpense(db, ME, b);
    const queue = await db.outbox.orderBy('seq').toArray();
    expect(queue.map((e) => e.entityId)).toEqual([a.id, b.id]);
    expect(new Set(queue.map((e) => e.mutationId)).size).toBe(2);
  });

  it('tells the sync engine something is waiting', async () => {
    const heard = vi.fn();
    const off = onLocalWrite(heard);
    await saveExpense(db, ME, expense());
    off();
    await saveExpense(db, ME, expense());
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('editing', () => {
  it('builds on the version the server last gave this row', async () => {
    const data = expense();
    await saveExpense(db, ME, data);
    await db.outbox.clear(); // pretend it was sent
    await db.expenses.update(data.id, { version: 3, serverSeq: 40 });

    await saveExpense(db, ME, { ...data, note: 'fixed' });
    expect((await db.outbox.toArray())[0]?.baseVersion).toBe(3);
    expect((await db.expenses.get(data.id))?.note).toBe('fixed');
    expect((await db.expenses.get(data.id))?.version).toBe(3); // unchanged until the server answers
  });

  it('chains several queued edits so the server does not call the later ones stale', async () => {
    const data = expense();
    await saveExpense(db, ME, data);
    await db.outbox.clear();
    await db.expenses.update(data.id, { version: 3, serverSeq: 40 });

    await saveExpense(db, ME, { ...data, note: 'one' });
    await saveExpense(db, ME, { ...data, note: 'two' });
    await saveExpense(db, ME, { ...data, note: 'three' });
    const bases = (await db.outbox.orderBy('seq').toArray()).map((e) => e.baseVersion);
    expect(bases).toEqual([3, 4, 5]);
  });

  it('keeps "no base version" for a row the server has never seen, however often it is edited', async () => {
    const data = expense();
    await saveExpense(db, ME, data);
    await saveExpense(db, ME, { ...data, note: 'again' });
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => e.baseVersion)).toEqual([
      null,
      null,
    ]);
  });

  it('keeps who created the row when someone else edits it', async () => {
    const other = uuidv7();
    const data = expense();
    await saveExpense(db, other, data);
    await saveExpense(db, ME, { ...data, note: 'mine now' });
    expect(await db.expenses.get(data.id)).toMatchObject({ createdBy: other, updatedBy: ME });
  });
});

describe('deleting and undoing', () => {
  it('marks the row deleted (kept as a tombstone) and queues a delete', async () => {
    const data = expense();
    await saveExpense(db, ME, data);
    await db.outbox.clear();
    await db.expenses.update(data.id, { version: 1, serverSeq: 5 });

    await deleteExpense(db, ME, data.id);
    expect((await db.expenses.get(data.id))?.deletedAt).toBeGreaterThan(0);
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({
        op: 'delete',
        entity: 'expense',
        entityId: data.id,
        groupId: GROUP,
        baseVersion: 1,
      }),
    ]);
  });

  it('undo queues a restore on top of the delete', async () => {
    const data = expense();
    await saveExpense(db, ME, data);
    await db.outbox.clear();
    await db.expenses.update(data.id, { version: 1, serverSeq: 5 });

    await deleteExpense(db, ME, data.id);
    await restoreExpense(db, ME, data.id);
    expect((await db.expenses.get(data.id))?.deletedAt).toBeNull();
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => [e.op, e.baseVersion])).toEqual([
      ['delete', 1],
      ['restore', 2],
    ]);
  });

  it('ignores a delete for a row that does not exist', async () => {
    await deleteExpense(db, ME, uuidv7());
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('categories', () => {
  it('saves a category and queues it', async () => {
    const id = uuidv7();
    await saveCategory(db, ME, {
      id,
      groupId: GROUP,
      name: 'Chai',
      icon: 'utensils',
      color: '#aabbcc',
      archived: false,
    });
    expect(await db.categories.get(id)).toMatchObject({ name: 'Chai', version: 0 });
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ entity: 'category', op: 'upsert' }),
    ]);
  });
});

describe('budgets and recurring rules', () => {
  const budget = (overrides: Record<string, unknown> = {}) => ({
    id: uuidv7(),
    groupId: GROUP,
    categoryId: null,
    amountMinor: 500_000,
    ...overrides,
  });
  const rule = (overrides: Record<string, unknown> = {}) => ({
    id: uuidv7(),
    groupId: GROUP,
    frequency: 'monthly' as const,
    startOn: '2026-11-01',
    endOn: null,
    active: true,
    amountMinor: 8_000_00,
    categoryId: null,
    note: 'Rent',
    splitType: 'equal' as const,
    payers: [{ userId: ME, amountMinor: 8_000_00 }],
    shares: [{ userId: ME, amountMinor: 8_000_00 }],
    ...overrides,
  });

  it('saves a budget locally and queues it, like any other change', async () => {
    const data = budget();
    await saveBudget(db, ME, data);
    expect(await db.budgets.get(data.id)).toMatchObject({ amountMinor: 500_000, version: 0 });
    expect(await db.outbox.toArray()).toMatchObject([{ entity: 'budget', op: 'upsert' }]);
  });

  it('deletes a budget with a tombstone that is queued too', async () => {
    const data = budget();
    await saveBudget(db, ME, data);
    await deleteBudget(db, ME, data.id);
    expect((await db.budgets.get(data.id))?.deletedAt).not.toBeNull();
    expect((await db.outbox.toArray()).map((e) => e.op)).toEqual(['upsert', 'delete']);
  });

  it('keeps the server-managed fields of a rule when it is edited on this device', async () => {
    const data = rule();
    await saveRecurring(db, ME, data);
    // The server made an occurrence and the pull brought that back.
    await db.recurring.update(data.id, {
      lastGeneratedOn: '2026-11-01',
      version: 1,
      serverSeq: 5,
      createdBy: 'someone-else',
    });
    await db.outbox.clear();

    await saveRecurring(db, ME, { ...data, note: 'Rent (new flat)' });
    expect(await db.recurring.get(data.id)).toMatchObject({
      note: 'Rent (new flat)',
      lastGeneratedOn: '2026-11-01',
      createdBy: 'someone-else',
      version: 1,
    });
    expect(await db.outbox.toArray()).toMatchObject([{ entity: 'recurring', baseVersion: 1 }]);
  });

  it('deletes a rule and brings it back again', async () => {
    const data = rule();
    await saveRecurring(db, ME, data);
    await deleteRecurring(db, ME, data.id);
    expect((await db.recurring.get(data.id))?.deletedAt).not.toBeNull();
    await restoreRecurring(db, ME, data.id);
    expect((await db.recurring.get(data.id))?.deletedAt).toBeNull();
  });
});
