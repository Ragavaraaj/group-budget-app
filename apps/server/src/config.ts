import { z } from 'zod';

const envSchema = z.object({
  // Secure by default: only an explicit ENVIRONMENT (from .dev.vars or the test config)
  // turns on development behaviour. A deployed Worker never sets it.
  ENVIRONMENT: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('dev'),
});

export type Config = z.infer<typeof envSchema>;

const cache = new WeakMap<object, Config>();

/**
 * Parses configuration from the Worker's `env` bindings. Bindings that aren't config
 * (the database, assets) are ignored. Memoised per `env` object, which is stable per isolate.
 */
export function loadConfig(env: object): Config {
  const cached = cache.get(env);
  if (cached) return cached;

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid Worker configuration:\n${z.prettifyError(parsed.error)}`);
  }
  cache.set(env, parsed.data);
  return parsed.data;
}
