import {
  addDays,
  MAX_BUDGETS_PER_GROUP,
  MAX_RECURRING_PER_GROUP,
  RECURRING_MAX_BACKFILL_DAYS,
  toIndiaDate,
  uuidv7,
} from '@budget/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../../../test/helpers';
import {
  categoriesOf,
  createSharedGroup,
  expenseData,
  join,
  makeInvite,
  type Person,
  pullAll,
  push,
  signedIn,
  tombstone,
  upsert,
} from '../../../test/sync-helpers';
import { budgets, recurringRules } from '../../db/schema';

let alice: Person;
let bob: Person;
let groupId: string;
let categoryId: string;

beforeEach(async () => {
  await resetDb();
  alice = await signedIn('alice@example.com', 'Alice');
  bob = await signedIn('bob@example.com', 'Bob');
  groupId = alice.personalGroupId;
  categoryId = (await categoriesOf(alice, groupId))[0]?.id ?? '';
});

const today = () => toIndiaDate(new Date());

const budgetData = (
  group: string,
  overrides: Partial<{ id: string; categoryId: string | null; amountMinor: number }> = {},
) => ({ id: uuidv7(), groupId: group, categoryId: null, amountMinor: 500_000, ...overrides });

function ruleData(
  group: string,
  payerId: string,
  overrides: Record<string, unknown> = {},
): { id: string; groupId: string } & Record<string, unknown> {
  const { occurredOn: _day, ...expense } = expenseData(group, payerId, { note: 'Rent' });
  return {
    ...expense,
    frequency: 'monthly',
    startOn: today(),
    endOn: null,
    active: true,
    ...overrides,
  };
}

const ruleRow = async (id: string) =>
  (await db.select().from(recurringRules).where(eq(recurringRules.id, id)))[0];

describe('budgets', () => {
  it('stores an overall budget and a category budget and sends them to a pull', async () => {
    const overall = budgetData(groupId);
    const food = budgetData(groupId, { categoryId, amountMinor: 200_000 });
    const results = await push(alice, [upsert('budget', overall), upsert('budget', food)]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);

    const pulled = await pullAll(alice);
    expect(pulled.budgets.map((b) => b.id).sort()).toEqual([overall.id, food.id].sort());
    expect(pulled.budgets.find((b) => b.id === food.id)).toMatchObject({
      categoryId,
      amountMinor: 200_000,
      version: 1,
      updatedBy: alice.id,
    });
  });

  it('edits in place and bumps the version', async () => {
    const data = budgetData(groupId);
    await push(alice, [upsert('budget', data)]);
    const [edit] = await push(alice, [upsert('budget', { ...data, amountMinor: 750_000 }, 1)]);
    expect(edit).toMatchObject({ status: 'applied', version: 2 });
    const row = (await db.select().from(budgets).where(eq(budgets.id, data.id)))[0];
    expect(row?.amountMinor).toBe(750_000);
  });

  it("refuses a category from another group and a group that isn't yours", async () => {
    const bobsCategory = (await categoriesOf(bob, bob.personalGroupId))[0]?.id ?? '';
    const [wrongCategory] = await push(alice, [
      upsert('budget', budgetData(groupId, { categoryId: bobsCategory })),
    ]);
    expect(wrongCategory).toMatchObject({ status: 'rejected', reason: 'invalid_reference' });

    const [notMember] = await push(alice, [upsert('budget', budgetData(bob.personalGroupId))]);
    expect(notMember).toMatchObject({ status: 'rejected', reason: 'not_a_member' });
  });

  it('deletes with a tombstone and undoes it with restore', async () => {
    const data = budgetData(groupId);
    await push(alice, [upsert('budget', data)]);
    const [deleted] = await push(alice, [tombstone('delete', 'budget', data.id, groupId, 1)]);
    expect(deleted).toMatchObject({ status: 'applied', version: 2 });
    expect((await pullAll(alice)).budgets[0]?.deletedAt).not.toBeNull();

    const [edit] = await push(alice, [upsert('budget', { ...data, amountMinor: 1 }, 2)]);
    expect(edit).toMatchObject({ status: 'rejected', reason: 'deleted' });

    const [restored] = await push(alice, [tombstone('restore', 'budget', data.id, groupId, 2)]);
    expect(restored).toMatchObject({ status: 'applied', version: 3 });
  });

  it('lets any member of a shared group set a budget', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const [result] = await push(bob, [upsert('budget', budgetData(shared))]);
    expect(result?.status).toBe('applied');
    expect((await pullAll(alice)).budgets.some((b) => b.updatedBy === bob.id)).toBe(true);
  });

  it('stops a group at its limit but still lets existing ones be edited', async () => {
    const all = Array.from({ length: MAX_BUDGETS_PER_GROUP }, () => budgetData(groupId));
    for (let i = 0; i < all.length; i += 10) {
      const results = await push(
        alice,
        all.slice(i, i + 10).map((data) => upsert('budget', data)),
      );
      expect(results.every((r) => r.status === 'applied')).toBe(true);
    }
    const [extra] = await push(alice, [upsert('budget', budgetData(groupId))]);
    expect(extra).toMatchObject({ status: 'rejected', reason: 'limit_reached' });

    const first = all[0] as ReturnType<typeof budgetData>;
    const [edit] = await push(alice, [upsert('budget', { ...first, amountMinor: 1_000 }, 1)]);
    expect(edit?.status).toBe('applied');
  });
});

describe('recurring rules', () => {
  it('stores a rule with the date the next expense is due', async () => {
    const data = ruleData(groupId, alice.id, { categoryId, startOn: addDays(today(), 3) });
    const [result] = await push(alice, [upsert('recurring', data)]);
    expect(result).toMatchObject({ status: 'applied', version: 1 });

    const row = await ruleRow(data.id);
    expect(row).toMatchObject({
      frequency: 'monthly',
      startOn: addDays(today(), 3),
      active: true,
      createdBy: alice.id,
      lastGeneratedOn: null,
      nextDueOn: addDays(today(), 3),
    });

    const pulled = (await pullAll(alice)).recurring[0];
    expect(pulled).toMatchObject({ id: data.id, lastGeneratedOn: null, categoryId });
    expect(pulled).not.toHaveProperty('nextDueOn');
  });

  it('is due from its start date, even when that is a little in the past', async () => {
    const start = addDays(today(), -10);
    const data = ruleData(groupId, alice.id, { startOn: start, frequency: 'weekly' });
    await push(alice, [upsert('recurring', data)]);
    expect((await ruleRow(data.id))?.nextDueOn).toBe(start);
  });

  it('never reaches back further than the backfill window', async () => {
    const data = ruleData(groupId, alice.id, {
      startOn: addDays(today(), -400),
      frequency: 'weekly',
    });
    await push(alice, [upsert('recurring', data)]);
    const due = (await ruleRow(data.id))?.nextDueOn as string;
    expect(due >= addDays(today(), -RECURRING_MAX_BACKFILL_DAYS)).toBe(true);
    expect(due <= today()).toBe(true);
  });

  it('has no next date while paused, and starts from today when switched on again', async () => {
    const data = ruleData(groupId, alice.id, { startOn: addDays(today(), -60) });
    await push(alice, [upsert('recurring', data)]);

    await push(alice, [upsert('recurring', { ...data, active: false }, 1)]);
    expect(await ruleRow(data.id)).toMatchObject({ active: false, nextDueOn: null });

    await push(alice, [upsert('recurring', { ...data, active: true }, 2)]);
    const row = await ruleRow(data.id);
    // It does not catch up on what was missed: the next date is today or later.
    expect((row?.nextDueOn as string) >= today()).toBe(true);
    expect(row?.lastGeneratedOn).toBe(addDays(today(), -1));
  });

  it('has no next date once the end date has passed', async () => {
    const data = ruleData(groupId, alice.id, {
      startOn: addDays(today(), -20),
      endOn: addDays(today(), -10),
      frequency: 'monthly',
    });
    await push(alice, [upsert('recurring', data)]);
    const row = await ruleRow(data.id);
    expect(row?.nextDueOn).toBe(addDays(today(), -20)); // the one occurrence inside its life
  });

  it('keeps who created it when someone else edits it', async () => {
    const shared = await createSharedGroup(alice);
    await join(bob, (await makeInvite(alice, shared)).token);
    const data = ruleData(shared, alice.id, {
      shares: [{ userId: alice.id, amountMinor: 10_000 }],
    });
    await push(alice, [upsert('recurring', data)]);
    await push(bob, [upsert('recurring', { ...data, amountMinor: 10_000, note: 'Rent (new)' }, 1)]);
    const row = await ruleRow(data.id);
    expect(row).toMatchObject({ createdBy: alice.id, updatedBy: bob.id, note: 'Rent (new)' });
  });

  it('refuses a stranger in the split and a category from another group', async () => {
    const [stranger] = await push(alice, [
      upsert(
        'recurring',
        ruleData(groupId, alice.id, { shares: [{ userId: bob.id, amountMinor: 10_000 }] }),
      ),
    ]);
    expect(stranger).toMatchObject({ status: 'rejected', reason: 'invalid_reference' });

    const bobsCategory = (await categoriesOf(bob, bob.personalGroupId))[0]?.id ?? '';
    const [wrongCategory] = await push(alice, [
      upsert('recurring', ruleData(groupId, alice.id, { categoryId: bobsCategory })),
    ]);
    expect(wrongCategory).toMatchObject({ status: 'rejected', reason: 'invalid_reference' });
  });

  it('deletes with a tombstone', async () => {
    const data = ruleData(groupId, alice.id);
    await push(alice, [upsert('recurring', data)]);
    const [deleted] = await push(alice, [tombstone('delete', 'recurring', data.id, groupId, 1)]);
    expect(deleted).toMatchObject({ status: 'applied', version: 2 });
    expect((await ruleRow(data.id))?.deletedAt).not.toBeNull();
  });

  it('stops a group at its limit', async () => {
    for (let i = 0; i < MAX_RECURRING_PER_GROUP; i += 10) {
      const results = await push(
        alice,
        Array.from({ length: 10 }, () => upsert('recurring', ruleData(groupId, alice.id))),
      );
      expect(results.every((r) => r.status === 'applied')).toBe(true);
    }
    const [extra] = await push(alice, [upsert('recurring', ruleData(groupId, alice.id))]);
    expect(extra).toMatchObject({ status: 'rejected', reason: 'limit_reached' });
  });
});
