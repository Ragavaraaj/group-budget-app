import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.config.ts: the SQL migrations to apply to the test database. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
