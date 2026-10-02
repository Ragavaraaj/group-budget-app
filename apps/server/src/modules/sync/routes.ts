import { type PushResponse, pullQuerySchema, pushRequestSchema, uuidSchema } from '@budget/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, session } from '../../middleware/session';
import { afterResponse, executionOf, LIVE_ID, notifyUsers } from '../live/notify';
import { pullChanges } from './pull';
import { pushMutations } from './push';

/** `/api/sync/*`: the two endpoints every device's sync engine talks to. */
export function syncRoutes() {
  const sync = new Hono<AppEnv>();
  sync.use(session(), requireAuth());

  sync.post('/push', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const parsed = pushRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    // The device's own connection id, so the live update doesn't wake the device that pushed.
    const liveId = c.req.header('x-live-id');
    const exclude = liveId && LIVE_ID.test(liveId) ? liveId : null;
    const results = await pushMutations(
      c.get('db'),
      auth.user.id,
      parsed.data.mutations,
      Date.now(),
      (recipients) => afterResponse(executionOf(c), notifyUsers(c.env, recipients, exclude)),
    );
    const body: PushResponse = { results };
    return c.json(body);
  });

  sync.get('/pull', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const query = pullQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'invalid_request' }, 400);

    const groupId = c.req.query('groupId');
    if (groupId !== undefined && !uuidSchema.safeParse(groupId).success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const result = await pullChanges(c.get('db'), auth.user.id, { ...query.data, groupId });
    if (!result) return c.json({ error: 'not_a_member' }, 403);
    return c.json(result);
  });

  return sync;
}
