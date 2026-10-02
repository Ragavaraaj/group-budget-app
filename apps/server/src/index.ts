import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createLogger } from './logger';
import { generateDueExpenses } from './modules/recurring/generate';

const app = createApp();

/**
 * The scheduled job (see `triggers.crons` in wrangler.jsonc): hourly, it turns recurring rules
 * that have come due into expenses.
 */
export async function runScheduled(env: Cloudflare.Env, scheduledTime: number): Promise<void> {
  const logger = createLogger(loadConfig(env).LOG_LEVEL);
  try {
    const result = await generateDueExpenses(createDb(env.DB), scheduledTime);
    logger.info({ ...result }, 'recurring expenses generated');
  } catch (error) {
    // Logged, then rethrown so the run shows as failed in the dashboard.
    logger.error({ err: error }, 'recurring expenses failed');
    throw error;
  }
}

export default {
  // Wrangler serves the static web app for everything outside /api/*.
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
