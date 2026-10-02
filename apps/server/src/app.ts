import type { HealthResponse } from '@budget/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { type Config, loadConfig } from './config';
import { createDb, type Db } from './db/client';
import { createLogger, type Logger } from './logger';
import { originCheck } from './middleware/origin-check';
import { requestLogger } from './middleware/request-logger';
import type { AuthContext } from './middleware/session';
import { meRoutes } from './modules/auth/me';
import { authRoutes } from './modules/auth/routes';

export interface AppEnv {
  Bindings: Cloudflare.Env;
  Variables: { config: Config; logger: Logger; db: Db; auth: AuthContext | null };
}

/** Builds the Hono app. The Worker exports it; tests call `app.request(path, init, env)`. */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const config = loadConfig(c.env);
    c.set('config', config);
    c.set('logger', createLogger(config.LOG_LEVEL));
    c.set('db', createDb(c.env.DB));
    await next();
  });
  app.use(requestLogger());
  app.use(secureHeaders());

  // API responses carry per-user data: never let a browser or proxy cache them.
  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  // Anything that changes state must come from our own origin (CSRF, on top of SameSite cookies).
  app.use('/api/*', originCheck());

  app.route('/api/auth', authRoutes());
  app.route('/api/me', meRoutes());

  app.get('/api/healthz', async (c) => {
    try {
      await c.get('db').run(sql`select 1`);
    } catch (error) {
      c.get('logger').error({ err: error }, 'health check: database unavailable');
      return c.json({ status: 'error', db: 'error' }, 503);
    }
    const body: HealthResponse = {
      status: 'ok',
      db: 'ok',
      version: c.get('config').APP_VERSION,
      time: new Date().toISOString(),
    };
    return c.json(body);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    c.get('logger').error({ err: error, path: c.req.path }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
