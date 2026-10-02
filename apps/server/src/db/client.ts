import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema/index';

/**
 * Wraps the D1 binding with Drizzle. Cheap: build one per request.
 *
 * D1 has no interactive transactions (no BEGIN/COMMIT from the Worker). The only atomic
 * primitive is `db.batch([...])`: a list of statements that commit or roll back together, so
 * do reads and validation first, then write everything in one batch.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
