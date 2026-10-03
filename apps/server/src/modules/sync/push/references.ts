import { type Known, key, type Members, type Upsert } from './types';

/** No category is fine; a named one must exist in this same group. */
const categoryIsInGroup = (categoryId: string | null, groupId: string, known: Map<string, Known>) =>
  categoryId === null || known.get(key('category', categoryId))?.groupId === groupId;

/** Categories must exist in the same group; people in a split must belong to the group. */
export function referencesAreValid(
  m: Upsert,
  groupId: string,
  members: Members,
  known: Map<string, Known>,
): boolean {
  const ever = members.ever.get(groupId) ?? new Set<string>();
  switch (m.entity) {
    case 'category':
      return true;
    case 'expense': {
      const { categoryId, payers, shares } = m.data;
      if (categoryId !== null && known.get(key('category', categoryId))?.groupId !== groupId) {
        return false;
      }
      return [...payers, ...shares].every((p) => ever.has(p.userId));
    }
    case 'settlement':
      return ever.has(m.data.fromUser) && ever.has(m.data.toUser);
    case 'budget':
      return categoryIsInGroup(m.data.categoryId, groupId, known);
    case 'recurring': {
      const { categoryId, payers, shares } = m.data;
      // A template for future expenses must not name someone who has left: every month it would
      // add to their debt in a group they can't see. A paused rule makes none, so it may still be
      // saved (that is how a member pauses it) while it names them.
      const allowed = m.data.active ? (members.active.get(groupId) ?? new Set<string>()) : ever;
      return (
        categoryIsInGroup(categoryId, groupId, known) &&
        [...payers, ...shares].every((p) => allowed.has(p.userId))
      );
    }
  }
}
