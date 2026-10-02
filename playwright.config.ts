import { defineConfig, devices } from '@playwright/test';

const ORIGIN = 'http://localhost:8787';

// Runs against the production-like setup: `wrangler dev` (the real workerd runtime) serving the
// BUILT web app and the API from one origin, exactly as a deployed Worker does. Run
// `npm run build` first (the `e2e` script does). The service worker only exists in a build,
// and offline behaviour is what these tests are for.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    // Lets a sandbox with a pre-installed Chromium run the suite; unset in CI.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run e2e:server -w @budget/server',
    url: `${ORIGIN}/api/healthz`,
    env: { WRANGLER_SEND_METRICS: 'false' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
