import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });

const { db, sqlite } = createDb(config.DATABASE_PATH);
// Resolves to apps/server/drizzle both from src/ (dev) and dist/ (production build).
runMigrations(db, fileURLToPath(new URL('../drizzle', import.meta.url)));
logger.info({ path: config.DATABASE_PATH }, 'database ready, migrations applied');

const app = createApp({ config, logger, sqlite });
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  logger.info(
    { host: info.address, port: info.port, version: config.APP_VERSION },
    'server listening',
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
