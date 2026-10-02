import type { Browser, BrowserContext, Page } from '@playwright/test';

let counter = 0;

/** A fresh address per test, so tests never meet each other's data (the e2e database persists). */
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}-${Date.now().toString(36)}-${counter}@example.com`;
}

/**
 * Signs the page's browser context in through the dev-only endpoint, which exists only because
 * the e2e server runs with ENVIRONMENT=development and ENABLE_DEV_LOGIN=1.
 */
export async function devSignIn(page: Page, email: string, name?: string): Promise<void> {
  const origin = new URL(page.url() === 'about:blank' ? 'http://localhost:8787' : page.url())
    .origin;
  const response = await page.request.post(`${origin}/api/auth/dev-login`, {
    data: { email, name },
    headers: { origin },
  });
  if (!response.ok()) throw new Error(`dev login failed: ${response.status()}`);
}

/** A second person on a second device: its own context, so its own cookies and local database. */
export async function newPerson(
  browser: Browser,
  email: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8787' });
  const page = await context.newPage();
  await devSignIn(page, email, name);
  return { context, page };
}

/** Waits for the sync chip to say everything has reached the server. */
export async function waitForSynced(page: Page): Promise<void> {
  await page
    .getByRole('status')
    .filter({ hasText: /^Synced$/ })
    .waitFor();
}
