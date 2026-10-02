import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests, alongside SameSite=Lax cookies: a request that
 * changes anything must come from our own origin. Browsers always send `Origin` on such requests.
 */
export function originCheck(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    const origin = c.req.header('origin');
    if (!origin || origin !== new URL(c.req.url).origin) {
      return c.json({ error: 'bad_origin' }, 403);
    }
    return next();
  };
}
