import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The policy that ships in deploy/Caddyfile, parsed from the file so this test can't drift from it.
const caddyfile = readFileSync(new URL('../deploy/Caddyfile', import.meta.url), 'utf8');
const csp = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1];

test('the app runs with zero violations under the production CSP', async ({ page, context }) => {
  expect(csp, 'Content-Security-Policy missing from deploy/Caddyfile').toBeTruthy();

  await context.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp ?? '' },
    });
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  for (const path of ['/', '/groups', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
  }
  // The API call (connect-src) and service worker (worker-src) must both work under the policy.
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);
});
