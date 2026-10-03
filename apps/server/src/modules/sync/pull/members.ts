import { and, asc, eq, gt, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { memberships, users } from '../../../db/schema';
import type { MemberJoinRow } from '../mappers';
import type { PullOptions } from './queries';

const memberColumns = {
  groupId: memberships.groupId,
  userId: memberships.userId,
  role: memberships.role,
  joinedAt: memberships.joinedAt,
  removedAt: memberships.removedAt,
  serverSeq: memberships.serverSeq,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  isPlaceholder: users.isPlaceholder,
};

/** Membership rows with the person's name and picture, which travel on the membership. */
const memberRows = (db: Db) =>
  db.select(memberColumns).from(memberships).innerJoin(users, eq(users.id, memberships.userId));

/** The queries about memberships that a page of changes needs. */
export function memberQueries(
  db: Db,
  userId: string,
  { since, limit, groupId }: PullOptions,
  inScope: (column: typeof memberships.groupId) => SQL,
) {
  const take = limit + 1;
  const mine = and(eq(memberships.userId, userId), gt(memberships.serverSeq, since));
  const isMember = and(eq(memberships.userId, userId), isNull(memberships.removedAt));
  const groupIds = () => db.select({ id: memberships.groupId }).from(memberships);
  return {
    /** Everyone's rows in the groups in scope. */
    inGroups: memberRows(db)
      .where(and(gt(memberships.serverSeq, since), inScope(memberships.groupId)))
      .orderBy(asc(memberships.serverSeq))
      .limit(take),
    // The caller's own membership rows, including a removal, which must reach their devices
    // even though they can no longer see the group.
    own: groupId
      ? memberRows(db)
          .where(and(mine, eq(memberships.groupId, groupId)))
          .limit(1)
      : memberRows(db).where(mine).orderBy(asc(memberships.serverSeq)).limit(take),
    /** Whether the caller may read the one group asked for (always empty otherwise). */
    access: groupId
      ? groupIds()
          .where(and(isMember, eq(memberships.groupId, groupId)))
          .limit(1)
      : groupIds().limit(0),
  };
}

/** A member row can come from both member queries; keep the newest, oldest change first. */
export function mergeMembers(...lists: MemberJoinRow[][]): MemberJoinRow[] {
  const byKey = new Map<string, MemberJoinRow>();
  for (const row of lists.flat()) {
    const k = `${row.groupId}:${row.userId}`;
    if ((byKey.get(k)?.serverSeq ?? 0) < row.serverSeq) byKey.set(k, row);
  }
  return [...byKey.values()].sort((a, b) => a.serverSeq - b.serverSeq);
}
