import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.config.ts: the SQL migrations to apply to the test database. */
      TEST_MIGRATIONS: D1Migration[];
      /** Test-only values for the settings in config.ts (vitest.config.ts sets them). */
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      ALLOWED_EMAILS: string;
      ENABLE_DEV_LOGIN: string;
    }
  }
}
