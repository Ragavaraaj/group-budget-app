import { DEFAULT_CATEGORIES, uuidv7 } from '@budget/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { seqFor } from '../../db/batch';
import type { Db } from '../../db/client';
import { categories, groups, invites, memberships } from '../../db/schema';

type Statement = BatchItem<'sqlite'>;

/** How many `server_seq` numbers creating a group uses: the group, its owner, its categories. */
export const GROUP_SEQ_COUNT = 2 + DEFAULT_CATEGORIES.length;

export interface NewGroup {
  groupId: string;
  name: string;
  isPersonal: boolean;
  ownerId: string;
  now: number;
}

/**
 * The statements that create a group with its owner and the default categories. The caller
 * reserves `total` sequence numbers (see `reserveSeq`) and says where in that block these start,
 * so a sign-up can create the user and their personal ledger in one atomic batch.
 */
export function createGroupStatements(
  db: Db,
  group: NewGroup,
  total: number,
  startIndex = 1,
): Statement[] {
  const { groupId, name, isPersonal, ownerId, now } = group;
  return [
    db.insert(groups).values({
      id: groupId,
      name,
      isPersonal,
      createdBy: ownerId,
      createdAt: now,
      version: 1,
      serverSeq: seqFor(total, startIndex),
    }),
    db.insert(memberships).values({
      groupId,
      userId: ownerId,
      role: 'owner',
      joinedAt: now,
      removedAt: null,
      serverSeq: seqFor(total, startIndex + 1),
    }),
    ...DEFAULT_CATEGORIES.map((category, i) =>
      db.insert(categories).values({
        id: uuidv7(now),
        groupId,
        name: category.name,
        icon: category.icon,
        color: category.color,
        archived: false,
        version: 1,
        updatedAt: now,
        updatedBy: ownerId,
        deletedAt: null,
        serverSeq: seqFor(total, startIndex + 2 + i),
      }),
    ),
  ];
}

/** An invite that can still be used: not revoked, not expired, not used up. */
export async function findUsableInvite(db: Db, tokenHash: string, now: number) {
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now),
        sql`${invites.usedCount} < ${invites.maxUses}`,
      ),
    )
    .limit(1);
  return invite ?? null;
}
