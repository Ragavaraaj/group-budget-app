import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index';

export function createDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL'); // readers don't block the single writer; required by Litestream
  sqlite.pragma('synchronous = NORMAL'); // safe with WAL, much faster than FULL
  sqlite.pragma('foreign_keys = ON'); // SQLite ignores FKs unless asked every connection
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle({ client: sqlite, schema });
  return { db, sqlite };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Sqlite = ReturnType<typeof createDb>['sqlite'];
