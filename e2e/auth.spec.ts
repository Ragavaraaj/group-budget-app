import { expect, test } from '@playwright/test';
import { devSignIn, uniqueEmail, waitForSynced } from './helpers';

test('visitors who are not signed in are sent to the login page', async ({ page }) => {
  await page.goto('/groups');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('signs in through the Google flow, and signs out, which clears the local data', async ({
  page,
  context,
}) => {
  const email = uniqueEmail('flow');
  // Create the account first (new accounts need an invite or the allow-list), then start signed out.
  await page.goto('/login');
  await devSignIn(page, email, 'Flow Person');
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  // The development server shows a stand-in for Google's screen.
  await expect(page.getByRole('heading', { name: /Dev sign-in/ })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await waitForSynced(page);
  const before = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(before.some((name) => name?.startsWith('budget-'))).toBe(true);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  const after = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(after.some((name) => name?.startsWith('budget-'))).toBe(false);
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('someone who is not invited is told so', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByLabel('Email').fill(uniqueEmail('stranger'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login\?error=not_invited/);
  await expect(page.getByRole('alert')).toContainText('isn’t invited yet');
});

test('the installed app signs in through the browser and is handed the session', async ({
  browser,
}) => {
  const email = uniqueEmail('installed');

  // The "installed app": a context that reports itself as standalone, with its own storage.
  const appContext = await browser.newContext({ baseURL: 'http://localhost:8787' });
  await appContext.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  const app = await appContext.newPage();

  // The account has to exist already (new accounts need an invite or the allow-list).
  const setup = await browser.newContext({ baseURL: 'http://localhost:8787' });
  await devSignIn(await setup.newPage(), email, 'Installed Person');
  await setup.close();

  // The app starts sign-in. On iOS the Google page would open outside the app and the app would
  // stay where it is. Reproduce that: let the server record the sign-in, capture where Google
  // would have been opened, and answer the app's navigation with "204 No Content", which leaves
  // the page unchanged.
  let googleUrl = '';
  await app.route('**/api/auth/google/start*', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    googleUrl = new URL(response.headers().location ?? '', 'http://localhost:8787').toString();
    await route.fulfill({ status: 204 });
  });
  await app.goto('/login');
  await app.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(app.getByText('Finish signing in')).toBeVisible();
  await expect.poll(() => googleUrl).toContain('/api/auth/dev/idp');

  // The person completes it in the browser: a different context, with different cookies.
  const browserContext = await browser.newContext({ baseURL: 'http://localhost:8787' });
  const browserTab = await browserContext.newPage();
  await browserTab.goto(googleUrl);
  await browserTab.getByLabel('Email').fill(email);
  await browserTab.getByRole('button', { name: 'Sign in' }).click();

  // The browser is not signed in: it is asked to confirm that this was the person at the app.
  await expect(
    browserTab.getByRole('heading', { name: /Finish signing in on your installed app/ }),
  ).toBeVisible();
  expect((await browserTab.request.get('/api/me')).status()).toBe(401);

  // Until they confirm, the app stays signed out.
  await app.waitForTimeout(2500);
  expect((await app.request.get('/api/me')).status()).toBe(401);

  await browserTab.getByRole('button', { name: 'Continue' }).click();
  await expect(browserTab.getByText('You’re signed in')).toBeVisible();

  // The app notices by itself and opens.
  await expect(app.getByRole('heading', { name: 'Expenses' })).toBeVisible({ timeout: 15_000 });
  expect((await app.request.get('/api/me')).status()).toBe(200);
  expect((await browserTab.request.get('/api/me')).status()).toBe(401); // the browser never signed in

  await appContext.close();
  await browserContext.close();
});

test('when the session ends the app keeps working and nothing waiting is lost', async ({
  page,
  context,
}) => {
  const email = uniqueEmail('expired');
  await page.goto('/login');
  await devSignIn(page, email, 'Expired Person');
  await page.goto('/');
  await waitForSynced(page);

  // The session disappears (as after 30 days, or a sign-out elsewhere).
  await context.clearCookies();
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount').fill('75');
  await page.getByLabel('Note (optional)').fill('Saved while signed out');
  await page.getByRole('button', { name: 'Add expense' }).click();

  await expect(page.getByRole('link', { name: /Saved while signed out/ })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Your session ended' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: /Sign in to sync · 1 waiting/ }),
  ).toBeVisible();

  // Signing in again sends it.
  await devSignIn(page, email, 'Expired Person');
  await page.reload();
  await waitForSynced(page);
  await expect(page.getByRole('link', { name: /Saved while signed out/ })).not.toContainText(
    'Not synced yet',
  );
});
