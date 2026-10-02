import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { BudgetDb, getMeta, setMeta } from './database';

describe('upgrading the local database', () => {
  it('clears the pull cursor when budgets and recurring rules are added, and keeps the data', async () => {
    const user = `upgrade-${crypto.randomUUID()}`;

    // The database as the first release made it: no budgets or recurring tables, and a cursor
    // that had already moved past rows that release didn't know how to keep.
    const old = new Dexie(`budget-${user}`);
    old.version(1).stores({
      groups: 'id',
      members: '[groupId+userId], groupId, userId',
      categories: 'id, groupId',
      expenses: 'id, groupId, [groupId+occurredOn]',
      settlements: 'id, groupId',
      outbox: '++seq, mutationId, entityKey',
      meta: 'key',
    });
    await old.open();
    await old.table('meta').put({ key: 'cursor', value: 42 });
    await old.table('meta').put({ key: 'monthStartDay', value: 25 });
    await old.table('groups').put({ id: 'g1', name: 'Home' });
    old.close();

    const db = new BudgetDb(user);
    await db.open();
    // The next sync starts from the beginning, so it fetches what was skipped...
    expect(await getMeta(db, 'cursor')).toBeUndefined();
    // ...and nothing else the person had on the device is lost.
    expect(await getMeta(db, 'monthStartDay')).toBe(25);
    expect(await db.groups.get('g1')).toMatchObject({ name: 'Home' });
    expect(await db.budgets.count()).toBe(0);
    expect(await db.recurring.count()).toBe(0);
    db.close();
    await Dexie.delete(db.name);
  });

  it('leaves a database that is already current alone', async () => {
    const user = `current-${crypto.randomUUID()}`;
    const first = new BudgetDb(user);
    await first.open();
    await setMeta(first, 'cursor', 42);
    first.close();

    const again = new BudgetDb(user);
    await again.open();
    expect(await getMeta(again, 'cursor')).toBe(42);
    again.close();
    await Dexie.delete(again.name);
  });
});
