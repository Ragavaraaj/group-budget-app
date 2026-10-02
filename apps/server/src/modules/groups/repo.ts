import {
  DEFAULT_CATEGORIES,
  INVITE_MAX_USES,
  INVITE_TTL_DAYS,
  MAX_GROUP_MEMBERS,
  MAX_GROUPS_PER_USER,
  uuidv7,
} from '@budget/shared';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { reserveSeq, runBatch, seqFor } from '../../db/batch';
import type { Db } from '../../db/client';
import { categories, groups, invites, memberships, users } from '../../db/schema';
import { randomToken, sha256Hex } from '../auth/tokens';

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

/** A group the person belongs to (or null), with their role. */
export async function findMembership(db: Db, groupId: string, userId: string) {
  const [row] = await db
    .select({
      group: groups,
      role: memberships.role,
      removedAt: memberships.removedAt,
      removedBy: memberships.removedBy,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function activeGroupCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)));
  return row?.n ?? 0;
}

async function activeMemberCount(db: Db, groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.removedAt)));
  return row?.n ?? 0;
}

export type CreateGroupResult =
  | { ok: true; groupId: string }
  | { ok: false; error: 'too_many_groups' | 'id_taken' };

/** A new shared group with the caller as owner. Retrying with the same id is harmless. */
export async function createGroup(
  db: Db,
  ownerId: string,
  input: { id?: string; name: string },
  now: number,
): Promise<CreateGroupResult> {
  const groupId = input.id ?? uuidv7(now);

  const [existing] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (existing) {
    return existing.createdBy === ownerId && !existing.isPersonal
      ? { ok: true, groupId }
      : { ok: false, error: 'id_taken' };
  }
  if ((await activeGroupCount(db, ownerId)) >= MAX_GROUPS_PER_USER) {
    return { ok: false, error: 'too_many_groups' };
  }

  await runBatch(db, [
    reserveSeq(db, GROUP_SEQ_COUNT),
    ...createGroupStatements(
      db,
      { groupId, name: input.name, isPersonal: false, ownerId, now },
      GROUP_SEQ_COUNT,
    ),
  ]);
  return { ok: true, groupId };
}

export async function renameGroup(db: Db, groupId: string, name: string): Promise<void> {
  await runBatch(db, [
    reserveSeq(db, 1),
    db
      .update(groups)
      .set({ name, version: sql`${groups.version} + 1`, serverSeq: seqFor(1, 1) })
      .where(eq(groups.id, groupId)),
  ]);
}

export interface CreatedInvite {
  token: string;
  expiresAt: number;
  maxUses: number;
}

/** The token is returned once; only its hash is kept. */
export async function createInvite(
  db: Db,
  groupId: string,
  createdBy: string,
  now: number,
): Promise<CreatedInvite> {
  const token = randomToken();
  const expiresAt = now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
  await db.insert(invites).values({
    id: uuidv7(now),
    tokenHash: await sha256Hex(token),
    groupId,
    createdBy,
    createdAt: now,
    expiresAt,
    maxUses: INVITE_MAX_USES,
  });
  return { token, expiresAt, maxUses: INVITE_MAX_USES };
}

/** What the join page shows before anyone signs in. */
export async function previewInvite(db: Db, token: string, now: number) {
  const invite = await findUsableInvite(db, await sha256Hex(token), now);
  if (!invite) return null;
  const [row] = await db
    .select({ groupName: groups.name, invitedBy: users.displayName })
    .from(groups)
    .innerJoin(users, eq(users.id, invite.createdBy))
    .where(eq(groups.id, invite.groupId))
    .limit(1);
  return row ?? null;
}

/**
 * The guarded write behind `acceptInvite`: uses the invite up and adds the membership only if
 * the invite still has uses left and the group and the person are under their limits, all in
 * one batch. Exported so tests can race it without the reads in front. Whether it took effect
 * is for the caller to check by looking at the membership afterwards.
 */
export async function joinGuarded(
  db: Db,
  invite: { id: string; groupId: string },
  userId: string,
  now: number,
): Promise<void> {
  // Raw statements: Drizzle's D1 batch only takes its own query builders, and the second
  // statement needs `INSERT ... SELECT ... WHERE changes() > 0`, which they can't express.
  const d1 = db.$client;
  await d1.batch([
    d1.prepare('UPDATE sync_counter SET value = value + 1 WHERE id = 1'),
    d1
      .prepare(
        `UPDATE invites SET used_count = used_count + 1
         WHERE id = ?1
           AND revoked_at IS NULL
           AND expires_at > ?2
           AND used_count < max_uses
           AND (SELECT COUNT(*) FROM memberships WHERE group_id = ?3 AND removed_at IS NULL) < ?4
           AND (SELECT COUNT(*) FROM memberships WHERE user_id = ?5 AND removed_at IS NULL) < ?6`,
      )
      .bind(invite.id, now, invite.groupId, MAX_GROUP_MEMBERS, userId, MAX_GROUPS_PER_USER),
    d1
      .prepare(
        `INSERT INTO memberships (group_id, user_id, role, joined_at, removed_at, removed_by, server_seq)
         SELECT ?1, ?2, 'member', ?3, NULL, NULL, (SELECT value FROM sync_counter WHERE id = 1)
         WHERE changes() > 0
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           removed_at = NULL, removed_by = NULL,
           joined_at = excluded.joined_at, server_seq = excluded.server_seq`,
      )
      .bind(invite.groupId, userId, now),
  ]);
}

export type AcceptInviteResult =
  | { ok: true; groupId: string }
  | { ok: false; error: 'invite_invalid' | 'group_full' | 'too_many_groups' | 'removed' };

/**
 * Joins a group through an invite. The checks before the write give friendly errors, but they
 * are only reads: two people could pass them at the same moment. So the write itself is
 * guarded. One statement uses the invite up only while it still has uses left, is not revoked
 * or expired, and the group and the person are under their limits; the next inserts the
 * membership only if that statement changed a row (`changes()`). D1 runs a batch in one go, so
 * nobody can slip in between.
 */
export async function acceptInvite(
  db: Db,
  token: string,
  userId: string,
  now: number,
): Promise<AcceptInviteResult> {
  const tokenHash = await sha256Hex(token);
  const invite = await findUsableInvite(db, tokenHash, now);
  if (!invite) return { ok: false, error: 'invite_invalid' };

  const membership = await findMembership(db, invite.groupId, userId);
  if (membership && membership.removedAt === null) return { ok: true, groupId: invite.groupId };
  // The owner removed this person: an invite link cannot undo that (the owner can reinstate them).
  if (membership && membership.removedBy !== null && membership.removedBy !== userId) {
    return { ok: false, error: 'removed' };
  }
  if ((await activeMemberCount(db, invite.groupId)) >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: 'group_full' };
  }
  if ((await activeGroupCount(db, userId)) >= MAX_GROUPS_PER_USER) {
    return { ok: false, error: 'too_many_groups' };
  }

  await joinGuarded(db, invite, userId, now);

  // Did it go through, or did someone else take the last place first?
  const after = await findMembership(db, invite.groupId, userId);
  if (after && after.removedAt === null) return { ok: true, groupId: invite.groupId };
  if (!(await findUsableInvite(db, tokenHash, now))) return { ok: false, error: 'invite_invalid' };
  if ((await activeMemberCount(db, invite.groupId)) >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: 'group_full' };
  }
  return { ok: false, error: 'too_many_groups' };
}

/** Ends every invite link for the group that is still open. Returns how many were open. */
export async function revokeInvites(db: Db, groupId: string, now: number): Promise<number> {
  const revoked = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.groupId, groupId), isNull(invites.revokedAt)))
    .returning({ id: invites.id });
  return revoked.length;
}

export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; error: 'not_a_member' | 'forbidden' | 'owner_cannot_leave' | 'not_found' };

/** The owner removes someone, or a member leaves. The row is kept (with `removedAt`) so it syncs. */
export async function removeMember(
  db: Db,
  groupId: string,
  actorId: string,
  targetId: string,
  now: number,
): Promise<RemoveMemberResult> {
  const actor = await findMembership(db, groupId, actorId);
  if (!actor || actor.removedAt !== null) return { ok: false, error: 'not_a_member' };
  if (actor.group.isPersonal) return { ok: false, error: 'forbidden' };

  const leaving = actorId === targetId;
  if (!leaving && actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const target = leaving ? actor : await findMembership(db, groupId, targetId);
  if (!target || target.removedAt !== null) return { ok: false, error: 'not_found' };
  if (target.role === 'owner') return { ok: false, error: 'owner_cannot_leave' };

  await runBatch(db, [
    reserveSeq(db, 1),
    db
      .update(memberships)
      .set({ removedAt: now, removedBy: actorId, serverSeq: seqFor(1, 1) })
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId))),
  ]);
  return { ok: true };
}

export type ReinstateResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'group_full' | 'too_many_groups' };

/**
 * The owner brings back someone they (or they themselves) removed. Done by the owner directly,
 * because an invite link deliberately cannot undo a removal.
 */
export async function reinstateMember(
  db: Db,
  groupId: string,
  ownerId: string,
  targetId: string,
  now: number,
): Promise<ReinstateResult> {
  const actor = await findMembership(db, groupId, ownerId);
  if (!actor || actor.removedAt !== null || actor.role !== 'owner' || actor.group.isPersonal) {
    return { ok: false, error: 'forbidden' };
  }
  const target = await findMembership(db, groupId, targetId);
  if (!target || target.removedAt === null) return { ok: false, error: 'not_found' };
  if ((await activeMemberCount(db, groupId)) >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: 'group_full' };
  }
  if ((await activeGroupCount(db, targetId)) >= MAX_GROUPS_PER_USER) {
    return { ok: false, error: 'too_many_groups' };
  }

  await runBatch(db, [
    reserveSeq(db, 1),
    db
      .update(memberships)
      .set({ removedAt: null, removedBy: null, joinedAt: now, serverSeq: seqFor(1, 1) })
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId))),
  ]);
  return { ok: true };
}
