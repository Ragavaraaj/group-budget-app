import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://localhost:4173';
const API_URL = 'http://127.0.0.1:3000';

// Runs against the *production* builds (`npm run build` first): the service worker only exists
// there, and offline behaviour is exactly what these tests are for.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    // Lets a sandbox with a pre-installed Chromium run the suite; unset in CI.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'npm run start -w @budget/server',
      url: `${API_URL}/api/healthz`,
      env: { DATABASE_PATH: ':memory:', LOG_LEVEL: 'warn', PORT: '3000' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run preview -w @budget/web',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
