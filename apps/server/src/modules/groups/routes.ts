import {
  acceptInviteRequestSchema,
  type CreateInviteResponse,
  createGroupRequestSchema,
  type ListInvitesResponse,
  placeholderNameRequestSchema,
  renameGroupRequestSchema,
  transferOwnershipRequestSchema,
  uuidSchema,
} from '@budget/shared';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, session } from '../../middleware/session';
import { activeMemberIds, afterResponse, executionOf, notifyUsers } from '../live/notify';
import {
  acceptInvite,
  addPlaceholder,
  createGroup,
  createInvite,
  deleteGroup,
  findMembership,
  listOpenInvites,
  previewInvite,
  reinstateMember,
  removeMember,
  renameGroup,
  renamePlaceholder,
  revokeInvite,
  revokeInvites,
  transferOwnership,
} from './repo';

/**
 * `/api/groups/*`: the actions that need the server's say-so, so they are online-only. The
 * results reach every device through the normal pull (groups and members are synced rows).
 */
export function groupRoutes() {
  const groups = new Hono<AppEnv>();
  groups.use(session(), requireAuth());

  /** Tells the group's members (and any extra people, such as someone just removed). */
  const tellMembers = (c: Context<AppEnv>, groupId: string, extra: string[] = []) =>
    afterResponse(
      executionOf(c),
      activeMemberIds(c.get('db'), [groupId]).then((members) =>
        notifyUsers(c.env, [...members, ...extra]),
      ),
    );

  groups.post('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const parsed = createGroupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await createGroup(c.get('db'), auth.user.id, parsed.data, Date.now());
    if (!result.ok) return c.json({ error: result.error }, 409);
    afterResponse(executionOf(c), notifyUsers(c.env, [auth.user.id]));
    return c.json({ groupId: result.groupId }, 201);
  });

  groups.patch('/:groupId', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const parsed = renameGroupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!groupId.success || !parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const membership = await findMembership(c.get('db'), groupId.data, auth.user.id);
    if (!membership || membership.removedAt !== null) return c.json({ error: 'not_found' }, 404);
    if (membership.role !== 'owner' || membership.group.isPersonal) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await renameGroup(c.get('db'), groupId.data, parsed.data.name);
    tellMembers(c, groupId.data);
    return c.json({ groupId: groupId.data });
  });

  groups.post('/:groupId/invites', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    if (!groupId.success) return c.json({ error: 'invalid_request' }, 400);

    const membership = await findMembership(c.get('db'), groupId.data, auth.user.id);
    if (!membership || membership.removedAt !== null) return c.json({ error: 'not_found' }, 404);
    if (membership.role !== 'owner' || membership.group.isPersonal) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const invite: CreateInviteResponse = await createInvite(
      c.get('db'),
      groupId.data,
      auth.user.id,
      Date.now(),
    );
    return c.json(invite, 201);
  });

  // The links that can still be used, so the owner can end them one by one.
  groups.get('/:groupId/invites', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    if (!groupId.success) return c.json({ error: 'invalid_request' }, 400);

    const membership = await findMembership(c.get('db'), groupId.data, auth.user.id);
    if (!membership || membership.removedAt !== null) return c.json({ error: 'not_found' }, 404);
    if (membership.role !== 'owner' || membership.group.isPersonal) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const body: ListInvitesResponse = {
      invites: await listOpenInvites(c.get('db'), groupId.data, Date.now()),
    };
    return c.json(body);
  });

  groups.delete('/:groupId/invites/:inviteId', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const inviteId = uuidSchema.safeParse(c.req.param('inviteId'));
    if (!groupId.success || !inviteId.success) return c.json({ error: 'invalid_request' }, 400);

    const membership = await findMembership(c.get('db'), groupId.data, auth.user.id);
    if (!membership || membership.removedAt !== null) return c.json({ error: 'not_found' }, 404);
    if (membership.role !== 'owner' || membership.group.isPersonal) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const revoked = await revokeInvite(c.get('db'), groupId.data, inviteId.data, Date.now());
    return revoked ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  // Ends every open invite link of the group (the owner's "stop the links I sent" button).
  groups.delete('/:groupId/invites', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    if (!groupId.success) return c.json({ error: 'invalid_request' }, 400);

    const membership = await findMembership(c.get('db'), groupId.data, auth.user.id);
    if (!membership || membership.removedAt !== null) return c.json({ error: 'not_found' }, 404);
    if (membership.role !== 'owner' || membership.group.isPersonal) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const revoked = await revokeInvites(c.get('db'), groupId.data, Date.now());
    return c.json({ revoked });
  });

  groups.post('/:groupId/placeholders', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const parsed = placeholderNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!groupId.success || !parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await addPlaceholder(
      c.get('db'),
      groupId.data,
      auth.user.id,
      parsed.data.name,
      Date.now(),
    );
    if (!result.ok)
      return c.json({ error: result.error }, result.error === 'forbidden' ? 403 : 409);
    tellMembers(c, groupId.data);
    return c.json({ userId: result.userId }, 201);
  });

  groups.patch('/:groupId/placeholders/:userId', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const userId = uuidSchema.safeParse(c.req.param('userId'));
    const parsed = placeholderNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!groupId.success || !userId.success || !parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const result = await renamePlaceholder(
      c.get('db'),
      groupId.data,
      auth.user.id,
      userId.data,
      parsed.data.name,
    );
    if (!result.ok)
      return c.json({ error: result.error }, result.error === 'forbidden' ? 403 : 404);
    tellMembers(c, groupId.data);
    return c.json({ ok: true });
  });

  groups.post('/:groupId/transfer', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const parsed = transferOwnershipRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!groupId.success || !parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await transferOwnership(
      c.get('db'),
      groupId.data,
      auth.user.id,
      parsed.data.userId,
    );
    if (result.ok) {
      tellMembers(c, groupId.data);
      return c.json({ ok: true });
    }
    const status = { forbidden: 403, not_found: 404, invalid_target: 409 }[result.error];
    return c.json({ error: result.error }, status as 403 | 404 | 409);
  });

  groups.delete('/:groupId', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    if (!groupId.success) return c.json({ error: 'invalid_request' }, 400);

    // Who to tell has to be read first: afterwards nobody is a member any more.
    const members = await activeMemberIds(c.get('db'), [groupId.data]);
    const result = await deleteGroup(c.get('db'), groupId.data, auth.user.id, Date.now());
    if (!result.ok) return c.json({ error: result.error }, 403);
    afterResponse(executionOf(c), notifyUsers(c.env, members));
    return c.json({ ok: true });
  });

  groups.post('/:groupId/members/:userId/reinstate', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const userId = uuidSchema.safeParse(c.req.param('userId'));
    if (!groupId.success || !userId.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await reinstateMember(
      c.get('db'),
      groupId.data,
      auth.user.id,
      userId.data,
      Date.now(),
    );
    if (result.ok) {
      tellMembers(c, groupId.data);
      return c.json({ ok: true });
    }
    const status = { forbidden: 403, not_found: 404, group_full: 409, too_many_groups: 409 }[
      result.error
    ];
    return c.json({ error: result.error }, status as 403 | 404 | 409);
  });

  groups.delete('/:groupId/members/:userId', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const groupId = uuidSchema.safeParse(c.req.param('groupId'));
    const userId = uuidSchema.safeParse(c.req.param('userId'));
    if (!groupId.success || !userId.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await removeMember(
      c.get('db'),
      groupId.data,
      auth.user.id,
      userId.data,
      Date.now(),
    );
    if (result.ok) {
      // The person who left or was removed is no longer a member, but needs to hear of it too.
      tellMembers(c, groupId.data, [userId.data]);
      return c.json({ ok: true });
    }
    const status = { not_a_member: 404, not_found: 404, forbidden: 403, owner_cannot_leave: 409 }[
      result.error
    ];
    return c.json({ error: result.error }, status as 404 | 403 | 409);
  });

  return groups;
}

/** `/api/invites/*` */
export function inviteRoutes() {
  const invites = new Hono<AppEnv>();

  // Public: lets the join page say which group you were invited to before you sign in. The token
  // is 256 random bits, so guessing one is not a thing.
  invites.get('/preview', async (c) => {
    const token = c.req.query('token') ?? '';
    if (token.length < 16 || token.length > 128) return c.json({ valid: false });
    const preview = await previewInvite(c.get('db'), token, Date.now());
    return c.json(preview ? { valid: true, ...preview } : { valid: false });
  });

  invites.post('/accept', session(), requireAuth(), async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const parsed = acceptInviteRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await acceptInvite(c.get('db'), parsed.data.token, auth.user.id, Date.now());
    if (!result.ok) {
      const status = { invite_invalid: 404, removed: 403, group_full: 409, too_many_groups: 409 }[
        result.error
      ];
      return c.json({ error: result.error }, status as 403 | 404 | 409);
    }
    afterResponse(
      executionOf(c),
      activeMemberIds(c.get('db'), [result.groupId]).then((members) => notifyUsers(c.env, members)),
    );
    return c.json({ groupId: result.groupId });
  });

  return invites;
}
