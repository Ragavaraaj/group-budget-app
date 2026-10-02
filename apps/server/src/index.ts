import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createLogger } from './logger';
import { handleLive } from './modules/live/connect';
import { activeMemberIds, notifyUsers } from './modules/live/notify';
import { generateDueExpenses } from './modules/recurring/generate';

export { LiveHub } from './modules/live/hub';

const app = createApp();

/**
 * The scheduled job (see `triggers.crons` in wrangler.jsonc): hourly, it turns recurring rules
 * that have come due into expenses, and tells the people in those groups.
 */
export async function runScheduled(env: Cloudflare.Env, scheduledTime: number): Promise<void> {
  const logger = createLogger(loadConfig(env).LOG_LEVEL);
  try {
    const db = createDb(env.DB);
    const { groupIds, ...result } = await generateDueExpenses(db, scheduledTime);
    logger.info({ ...result }, 'recurring expenses generated');
    if (groupIds.length > 0) await notifyUsers(env, await activeMemberIds(db, groupIds));
  } catch (error) {
    // Logged, then rethrown so the run shows as failed in the dashboard.
    logger.error({ err: error }, 'recurring expenses failed');
    throw error;
  }
}

export default {
  fetch(request, env, ctx) {
    // The live-updates WebSocket is answered here, not by the Hono app (see handleLive).
    if (new URL(request.url).pathname === '/api/live') return handleLive(request, env);
    // Wrangler serves the static web app for everything outside /api/*.
    return app.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
