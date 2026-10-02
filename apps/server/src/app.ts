import type { HealthResponse } from '@budget/shared';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Logger } from 'pino';
import type { Config } from './config';
import type { Sqlite } from './db/client';
import { requestLogger } from './middleware/request-logger';

export interface AppDeps {
  config: Config;
  logger: Logger;
  sqlite: Sqlite;
}

/** Builds the Hono app. Tests import this directly and call `app.request()`. */
export function createApp({ config, logger, sqlite }: AppDeps) {
  const app = new Hono();

  app.use(requestLogger(logger));
  app.use(secureHeaders());

  app.get('/api/healthz', (c) => {
    try {
      sqlite.prepare('SELECT 1').get();
    } catch (error) {
      logger.error({ err: error }, 'health check: database unavailable');
      return c.json({ status: 'error', db: 'error' }, 503);
    }
    const body: HealthResponse = {
      status: 'ok',
      db: 'ok',
      version: config.APP_VERSION,
      time: new Date().toISOString(),
    };
    return c.json(body);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
