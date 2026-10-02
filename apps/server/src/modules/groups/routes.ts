import {
  acceptInviteRequestSchema,
  type CreateInviteResponse,
  createGroupRequestSchema,
  renameGroupRequestSchema,
  uuidSchema,
} from '@budget/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, session } from '../../middleware/session';
import {
  acceptInvite,
  createGroup,
  createInvite,
  findMembership,
  previewInvite,
  reinstateMember,
  removeMember,
  renameGroup,
  revokeInvites,
} from './repo';

/**
 * `/api/groups/*`: the actions that need the server's say-so, so they are online-only. The
 * results reach every device through the normal pull (groups and members are synced rows).
 */
export function groupRoutes() {
  const groups = new Hono<AppEnv>();
  groups.use(session(), requireAuth());

  groups.post('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const parsed = createGroupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const result = await createGroup(c.get('db'), auth.user.id, parsed.data, Date.now());
    if (!result.ok) return c.json({ error: result.error }, 409);
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
    if (result.ok) return c.json({ ok: true });
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
    if (result.ok) return c.json({ ok: true });
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
    return c.json({ groupId: result.groupId });
  });

  return invites;
}
