import { uuidv7 } from '@budget/shared';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { reserveSeq, runBatch, seqFor } from '../../db/batch';
import type { Db } from '../../db/client';
import { groups, loginAttempts, memberships, oauthStates, sessions, users } from '../../db/schema';
import { createGroupStatements, GROUP_SEQ_COUNT } from '../groups/repo';
import { SESSION_TTL_MS } from './cookies';
import { randomToken, sha256Hex } from './tokens';

/** Who Google (or the dev sign-in) says someone is. */
export interface Identity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

const userColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
};

export async function findUserBySub(db: Db, sub: string): Promise<UserRecord | null> {
  const [user] = await db.select(userColumns).from(users).where(eq(users.googleSub, sub)).limit(1);
  return user ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
  const [user] = await db.select(userColumns).from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function personalGroupIdOf(db: Db, userId: string): Promise<string | null> {
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.createdBy, userId), eq(groups.isPersonal, true)))
    .limit(1);
  return group?.id ?? null;
}

/** First sign-in: the user, their personal ledger and its default categories, atomically. */
export async function provisionUser(db: Db, identity: Identity, now: number): Promise<UserRecord> {
  const userId = uuidv7(now);
  const total = GROUP_SEQ_COUNT;
  await runBatch(db, [
    reserveSeq(db, total),
    db.insert(users).values({
      id: userId,
      googleSub: identity.sub,
      email: identity.email,
      displayName: identity.name,
      avatarUrl: identity.picture,
      createdAt: new Date(now),
      lastLoginAt: new Date(now),
    }),
    ...createGroupStatements(
      db,
      { groupId: uuidv7(now), name: 'Personal', isPersonal: true, ownerId: userId, now },
      total,
    ),
  ]);
  return {
    id: userId,
    email: identity.email,
    displayName: identity.name,
    avatarUrl: identity.picture,
  };
}

/**
 * A returning user: record the login and pick up a changed name or photo. When the profile
 * changed, the person's membership rows get new sequence numbers so their group-mates' devices
 * pull the new name.
 */
export async function recordLogin(
  db: Db,
  user: UserRecord,
  identity: Identity,
  now: number,
): Promise<UserRecord> {
  const profileChanged = user.displayName !== identity.name || user.avatarUrl !== identity.picture;
  const updated = { ...user, displayName: identity.name, avatarUrl: identity.picture };

  const touch = db
    .update(users)
    .set({
      lastLoginAt: new Date(now),
      email: identity.email,
      ...(profileChanged ? { displayName: identity.name, avatarUrl: identity.picture } : {}),
    })
    .where(eq(users.id, user.id));

  if (!profileChanged) {
    await touch;
    return user;
  }

  const mine = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), isNull(memberships.removedAt)));
  await runBatch(db, [
    touch,
    ...(mine.length > 0 ? [reserveSeq(db, mine.length)] : []),
    ...mine.map(({ groupId }, i) =>
      db
        .update(memberships)
        .set({ serverSeq: seqFor(mine.length, i + 1) })
        .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, user.id))),
    ),
  ]);
  return updated;
}

// --- sessions -------------------------------------------------------------------------------

export interface SessionRecord {
  user: UserRecord;
  idHash: string;
  expiresAt: number;
}

export async function createSession(
  db: Db,
  userId: string,
  userAgent: string | undefined,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const expiresAt = now + SESSION_TTL_MS;
  await runBatch(db, [
    // Tidy up this person's old sessions while we're here; cheap and keeps the table small.
    db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date(now)))),
    db.insert(sessions).values({
      idHash: await sha256Hex(token),
      userId,
      expiresAt: new Date(expiresAt),
      userAgent: userAgent?.slice(0, 200) ?? null,
      createdAt: new Date(now),
    }),
  ]);
  return { token, expiresAt };
}

export async function findSession(
  db: Db,
  token: string,
  now: number,
): Promise<SessionRecord | null> {
  const idHash = await sha256Hex(token);
  const [row] = await db
    .select({ ...userColumns, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, idHash)))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= now) return null;
  const { expiresAt, ...user } = row;
  return { user, idHash, expiresAt: expiresAt.getTime() };
}

export async function extendSession(db: Db, idHash: string, expiresAt: number): Promise<void> {
  await db
    .update(sessions)
    .set({ expiresAt: new Date(expiresAt) })
    .where(eq(sessions.idHash, idHash));
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.idHash, await sha256Hex(token)));
}

// --- Google sign-in in progress ---------------------------------------------------------------

export interface OauthState {
  codeVerifier: string;
  attemptHash: string | null;
  inviteToken: string | null;
}

/**
 * Starting a sign-in is open to anyone, so it must stay cheap: one write. Expired rows are swept
 * when a sign-in completes (see `consumeOauthState`) and, on about one start in fifty, here, so the
 * table stays small even if nobody finishes the sign-ins that were started.
 */
export async function saveOauthState(
  db: Db,
  state: string,
  value: OauthState,
  now: number,
  ttlMs: number,
  sweep: boolean = Math.random() < 0.02,
): Promise<void> {
  await runBatch(db, [
    ...(sweep ? [db.delete(oauthStates).where(lt(oauthStates.expiresAt, now))] : []),
    db.insert(oauthStates).values({
      stateHash: await sha256Hex(state),
      codeVerifier: value.codeVerifier,
      attemptHash: value.attemptHash,
      inviteToken: value.inviteToken,
      createdAt: now,
      expiresAt: now + ttlMs,
    }),
  ]);
}

/** Single use: reading a state deletes it, so a replayed callback finds nothing. */
export async function consumeOauthState(
  db: Db,
  state: string,
  now: number,
): Promise<OauthState | null> {
  const [, [row]] = await db.batch([
    db.delete(oauthStates).where(lt(oauthStates.expiresAt, now)), // sweep expired ones
    db
      .delete(oauthStates)
      .where(eq(oauthStates.stateHash, await sha256Hex(state)))
      .returning(),
  ]);
  if (!row || row.expiresAt <= now) return null;
  return {
    codeVerifier: row.codeVerifier,
    attemptHash: row.attemptHash,
    inviteToken: row.inviteToken,
  };
}

// --- attempt-login (installed app) ------------------------------------------------------------

export const ATTEMPT_TTL_MS = 5 * 60 * 1000;

/** The callback finished in a different browser than the app: park the result for the app. */
export async function bindAttempt(
  db: Db,
  attemptHash: string,
  userId: string,
  confirmToken: string,
  inviteToken: string | null,
  now: number,
): Promise<void> {
  const confirmHash = await sha256Hex(confirmToken);
  const fields = {
    userId,
    confirmHash,
    inviteToken,
    createdAt: now,
    expiresAt: now + ATTEMPT_TTL_MS,
    confirmedAt: null,
    consumedAt: null,
  };
  await runBatch(db, [
    db
      .delete(loginAttempts)
      .where(or(lt(loginAttempts.expiresAt, now), isNotNull(loginAttempts.consumedAt))),
    db
      .insert(loginAttempts)
      .values({ idHash: attemptHash, ...fields })
      .onConflictDoUpdate({ target: loginAttempts.idHash, set: fields }),
  ]);
}

/** The person pressed "Continue" on the confirmation page. */
export async function confirmAttempt(db: Db, confirmToken: string, now: number): Promise<boolean> {
  const rows = await db
    .update(loginAttempts)
    .set({ confirmedAt: now, expiresAt: now + ATTEMPT_TTL_MS })
    .where(
      and(
        eq(loginAttempts.confirmHash, await sha256Hex(confirmToken)),
        isNull(loginAttempts.confirmedAt),
        sql`${loginAttempts.expiresAt} > ${now}`,
      ),
    )
    .returning({ idHash: loginAttempts.idHash });
  return rows.length === 1;
}

/**
 * The installed app collects its sign-in. One use only: the update succeeds for one caller. The
 * invite the person arrived with comes back too, so the app can open the join page.
 */
export async function redeemAttempt(
  db: Db,
  secret: string,
  now: number,
): Promise<{ userId: string; inviteToken: string | null } | null> {
  const rows = await db
    .update(loginAttempts)
    .set({ consumedAt: now })
    .where(
      and(
        eq(loginAttempts.idHash, await sha256Hex(secret)),
        isNotNull(loginAttempts.confirmedAt),
        isNotNull(loginAttempts.userId),
        isNull(loginAttempts.consumedAt),
        sql`${loginAttempts.expiresAt} > ${now}`,
      ),
    )
    .returning({ userId: loginAttempts.userId, inviteToken: loginAttempts.inviteToken });
  const row = rows[0];
  return row?.userId ? { userId: row.userId, inviteToken: row.inviteToken } : null;
}
