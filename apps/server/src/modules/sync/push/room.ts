import {
  type EntityName,
  MAX_BUDGETS_PER_GROUP,
  MAX_RECURRING_PER_GROUP,
  type Mutation,
} from '@budget/shared';
import { and, count, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { budgets, recurringRules } from '../../../db/schema';
import { type Known, key, unique } from './types';

const CAPS = { budget: MAX_BUDGETS_PER_GROUP, recurring: MAX_RECURRING_PER_GROUP } as const;
type Capped = keyof typeof CAPS;
const isCapped = (entity: EntityName): entity is Capped => entity in CAPS;

/** The groups that get a new (or restored) row of this kind in the push. */
function creating(todo: Mutation[], known: Map<string, Known>, entity: Capped): string[] {
  return unique(
    todo.flatMap((m) => {
      if (m.entity !== entity) return [];
      if (m.op === 'restore') return [m.groupId];
      return m.op === 'upsert' && !known.has(key(entity, m.data.id)) ? [m.data.groupId] : [];
    }),
  );
}

/** How many budgets and rules each group already holds, counted only where one is being added. */
async function usedPlaces(db: Db, todo: Mutation[], known: Map<string, Known>) {
  const used = new Map<string, number>();
  const budgetGroups = creating(todo, known, 'budget');
  const ruleGroups = creating(todo, known, 'recurring');
  if (budgetGroups.length > 0) {
    const rows = await db
      .select({ groupId: budgets.groupId, n: count() })
      .from(budgets)
      .where(and(inArray(budgets.groupId, budgetGroups), isNull(budgets.deletedAt)))
      .groupBy(budgets.groupId);
    for (const row of rows) used.set(`budget:${row.groupId}`, row.n);
  }
  if (ruleGroups.length > 0) {
    const rows = await db
      .select({ groupId: recurringRules.groupId, n: count() })
      .from(recurringRules)
      .where(and(inArray(recurringRules.groupId, ruleGroups), isNull(recurringRules.deletedAt)))
      .groupBy(recurringRules.groupId);
    for (const row of rows) used.set(`recurring:${row.groupId}`, row.n);
  }
  return used;
}

export type Room = Awaited<ReturnType<typeof roomLeft>>;

/** How many more budgets / rules each group may add, for the ones created or restored in this push. */
export async function roomLeft(db: Db, todo: Mutation[], known: Map<string, Known>) {
  // A new row takes a place, and so does a restored one (which is back among the group's rows).
  const used = await usedPlaces(db, todo, known);
  return {
    /** Takes one place for a new row; false when the group is full. Other entities are unlimited. */
    take(entity: EntityName, groupId: string): boolean {
      if (!isCapped(entity)) return true;
      const k = `${entity}:${groupId}`;
      const n = used.get(k) ?? 0;
      if (n >= CAPS[entity]) return false;
      used.set(k, n + 1);
      return true;
    },
    /** Gives a place back when a row is deleted, so the cap is checked against what the push leaves. */
    release(entity: EntityName, groupId: string): void {
      if (!isCapped(entity)) return;
      const k = `${entity}:${groupId}`;
      used.set(k, Math.max(0, (used.get(k) ?? 0) - 1));
    },
  };
}
