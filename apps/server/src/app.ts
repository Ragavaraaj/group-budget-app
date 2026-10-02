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
import { groupRoutes, inviteRoutes } from './modules/groups/routes';
import { syncRoutes } from './modules/sync/routes';

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
  // Same policy as the static files (public/_headers). It matters beyond tidiness: with the
  // default `no-referrer`, a browser sends `Origin: null` on a form POST from one of the pages
  // the Worker serves itself, and the origin check would refuse the sign-in confirmation.
  app.use(secureHeaders({ referrerPolicy: 'strict-origin-when-cross-origin' }));

  // API responses carry per-user data: never let a browser or proxy cache them.
  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  // Anything that changes state must come from our own origin (CSRF, on top of SameSite cookies).
  app.use('/api/*', originCheck());

  app.route('/api/auth', authRoutes());
  app.route('/api/me', meRoutes());
  app.route('/api/sync', syncRoutes());
  app.route('/api/groups', groupRoutes());
  app.route('/api/invites', inviteRoutes());

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
    // The logger is set by the first middleware, which is also what throws on invalid
    // configuration; in that case there is no logger yet, so fall back to a plain one.
    const logger = (c.get('logger') as Logger | undefined) ?? createLogger('error');
    logger.error({ err: error, path: c.req.path }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
