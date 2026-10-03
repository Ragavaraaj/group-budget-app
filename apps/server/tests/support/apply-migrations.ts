import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before each test file; applying is idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
