import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { getSessionToken, SESSION_TTL_MS, setSessionCookie } from '../modules/auth/cookies';
import { extendSession, findSession, type UserRecord } from '../modules/auth/repo';

export interface AuthContext {
  user: UserRecord;
}

/**
 * Looks the session cookie up and sets `auth` (or null). Sessions are 30 days, sliding, but are
 * only extended once less than half of that remains: D1 counts every write against a daily
 * quota, and "extend on every request" would be a write per request.
 */
export function session(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('auth', null);
    const token = getSessionToken(c);
    if (token) {
      const now = Date.now();
      const found = await findSession(c.get('db'), token, now);
      if (found) {
        c.set('auth', { user: found.user });
        if (found.expiresAt - now < SESSION_TTL_MS / 2) {
          const expiresAt = now + SESSION_TTL_MS;
          await extendSession(c.get('db'), found.idHash, expiresAt);
          setSessionCookie(c, token, expiresAt);
        }
      }
    }
    await next();
  };
}

/** Use after `session()`: turns "not signed in" into a 401. */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get('auth')) return c.json({ error: 'unauthorized' }, 401);
    return next();
  };
}
