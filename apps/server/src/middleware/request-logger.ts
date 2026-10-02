import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';

export function requestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const entry = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    };
    // Health checks are frequent; keep them out of the info log.
    const logger = c.get('logger');
    if (c.req.path === '/api/healthz') logger.debug(entry, 'request');
    else logger.info(entry, 'request');
  };
}
