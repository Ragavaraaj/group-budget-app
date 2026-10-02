import type { MeResponse } from '@budget/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, session } from '../../middleware/session';
import { personalGroupIdOf } from './repo';

/** `GET /api/me`: who am I, and which group is my own ledger. */
export function meRoutes() {
  const me = new Hono<AppEnv>();
  me.use(session(), requireAuth());

  me.get('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const personalGroupId = await personalGroupIdOf(c.get('db'), auth.user.id);
    if (!personalGroupId) return c.json({ error: 'no_personal_group' }, 500);
    const body: MeResponse = { user: auth.user, personalGroupId };
    return c.json(body);
  });

  return me;
}
