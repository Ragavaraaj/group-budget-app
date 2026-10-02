import { z } from 'zod';

/** Env values that are present but blank (`GOOGLE_CLIENT_ID=` in .dev.vars) count as unset. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const envSchema = z
  .object({
    // Secure by default: only an explicit ENVIRONMENT (from .dev.vars or the test config)
    // turns on development behaviour. A deployed Worker never sets it.
    ENVIRONMENT: z.enum(['development', 'test', 'production']).default('production'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    APP_VERSION: z.string().min(1).default('dev'),

    // Google sign-in (docs/auth.md). Without both, Google sign-in is simply unavailable.
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    /** Comma- or space-separated emails allowed to create an account without an invite. */
    ALLOWED_EMAILS: optionalText,
    /** "1" turns on the dev-only sign-in. Ignored in production, whatever it says. */
    ENABLE_DEV_LOGIN: optionalText,
  })
  .transform((env) => ({
    ENVIRONMENT: env.ENVIRONMENT,
    LOG_LEVEL: env.LOG_LEVEL,
    APP_VERSION: env.APP_VERSION,
    isProduction: env.ENVIRONMENT === 'production',
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    allowedEmails: (env.ALLOWED_EMAILS ?? '')
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    // Production can never have dev login, even if the flag is set by mistake.
    devLogin: env.ENVIRONMENT !== 'production' && env.ENABLE_DEV_LOGIN === '1',
  }));

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
