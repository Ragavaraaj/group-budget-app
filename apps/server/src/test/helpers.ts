import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** A real app on a fresh in-memory SQLite with the real migrations applied. */
export function createTestApp() {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', APP_VERSION: 'test' });
  const logger = pino({ level: 'silent' });
  const { db, sqlite } = createDb(':memory:');
  runMigrations(db, migrationsFolder);
  const app = createApp({ config, logger, sqlite });
  return { app, db, sqlite, config };
}
