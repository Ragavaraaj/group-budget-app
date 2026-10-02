import { expect, test } from '@playwright/test';
import { devSignIn, uniqueEmail } from './helpers';

test('the app shell and client-side routes carry the security headers', async ({ request }) => {
  // "/groups" doesn't exist as a file: it is answered by the SPA fallback, which must carry them too.
  for (const path of ['/', '/groups']) {
    const headers = (await request.get(path)).headers();
    expect(headers['content-security-policy'], path).toContain("default-src 'self'");
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security'], path).toContain('max-age=');
  }
});

test('hashed build assets are cached forever, API responses never', async ({ page, request }) => {
  await page.goto('/');
  const script = await page.locator('script[type="module"]').first().getAttribute('src');
  expect(script).toMatch(/^\/assets\/.+\.js$/);
  const asset = await request.get(script ?? '');
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

  const api = await request.get('/api/healthz');
  expect(api.headers()['cache-control']).toBe('no-store');
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
});

test('the app runs with zero violations under the policy the Worker really serves', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  // Not vacuous: the page itself must have arrived with a policy attached.
  const response = await page.goto('/login');
  expect(response?.headers()['content-security-policy']).toBeTruthy();
  await devSignIn(page, uniqueEmail('csp'));

  for (const path of ['/', '/groups', '/add', '/settings/categories', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
  }
  // The API call (connect-src) and the service worker (worker-src) must both work under it.
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);
});
