import type { MiddlewareHandler } from 'hono';
import type { Logger } from 'pino';

export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const entry = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    };
    // Health checks run every few seconds; keep them out of the info log.
    if (c.req.path === '/api/healthz') logger.debug(entry, 'request');
    else logger.info(entry, 'request');
  };
}
