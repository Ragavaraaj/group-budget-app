import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd (the real Workers runtime) against a simulated D1 that has the real
// migrations applied, so they catch anything that works in Node but not on Cloudflare.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./drizzle', import.meta.url)));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            LOG_LEVEL: 'silent',
            APP_VERSION: 'test',
            GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'test-client-secret',
            ALLOWED_EMAILS: 'owner@example.com',
            ENABLE_DEV_LOGIN: '1',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
