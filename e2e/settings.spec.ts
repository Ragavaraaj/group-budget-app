import { expect, test } from '@playwright/test';
import { chooseOption, chosenOption, devSignIn, dropdownOptions, uniqueEmail } from './helpers';

test.describe('settings', () => {
  test('shows who is signed in, and every row leads to its screen and back', async ({ page }) => {
    const email = uniqueEmail('settings');
    await page.goto('/login');
    await devSignIn(page, email, 'Settings Person');
    await page.goto('/settings');
    await expect(page.getByText('Settings Person')).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    const rows = [
      { link: 'Categories', heading: 'Categories', back: 'Back to settings' },
      { link: 'Budgets', heading: 'Budgets', back: 'Back' },
      { link: 'Recurring expenses', heading: 'Recurring expenses', back: 'Back to settings' },
      { link: 'Import from CSV', heading: 'Import from CSV', back: 'Back to settings' },
    ];
    for (const { link, heading, back } of rows) {
      await page.getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await page.getByRole('link', { name: back }).click();
      await expect(page, link).toHaveURL(/\/settings$/);
    }
  });

  test('a month can start on day 1 to 28 only, and the choice outlasts a reload', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('month-days'));
    await page.goto('/settings');
    const days = (await dropdownOptions(page, 'A month starts on day')).map((text) =>
      Number.parseInt(text, 10),
    );
    expect(days).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    expect(await chosenOption(page, 'A month starts on day')).toMatch(/^1\b/);

    await chooseOption(page, 'A month starts on day', '15');
    await expect.poll(() => chosenOption(page, 'A month starts on day')).toMatch(/^15\b/);
    await page.reload();
    await expect.poll(() => chosenOption(page, 'A month starts on day')).toMatch(/^15\b/);

    // The Insights screen follows: a range from the 15th, not a calendar month.
    await page.goto('/insights');
    await expect(page.getByTestId('insights-period')).toHaveText(
      /^15 [A-Z][a-z]{2,4} – 14 [A-Z][a-z]{2,4} \d{4}$/,
    );

    // Back to 1 means calendar months again.
    await page.goto('/settings');
    await chooseOption(page, 'A month starts on day', '1 (calendar months)');
    await expect.poll(() => chosenOption(page, 'A month starts on day')).toMatch(/^1\b/);
    await page.goto('/insights');
    await expect(page.getByTestId('insights-period')).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
  });

  test('the server card says when the server is not answering', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('server-card'));

    await page.goto('/settings');
    await expect(page.getByText('Online', { exact: true })).toBeVisible();
    await expect(page.getByText(/^version /)).toBeVisible();

    // The health check fails while the device itself is online: "unreachable", not "offline".
    await page.route('**/api/healthz', (route) => route.abort());
    await page.reload();
    await expect(page.getByText('Unreachable', { exact: true })).toBeVisible();
    await expect(page.getByText("The server isn't responding")).toBeVisible();

    // And an answer that is not a health report counts as no answer too.
    await page.unroute('**/api/healthz');
    await page.route('**/api/healthz', (route) =>
      route.fulfill({ status: 503, json: { status: 'error', db: 'error' } }),
    );
    await page.reload();
    await expect(page.getByText('Unreachable', { exact: true })).toBeVisible();
  });

  test('shows which version of the app is running, and says so when the server has a newer one', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('app-version'));
    const reportVersion = async (version: string) => {
      await page.unroute('**/api/healthz');
      await page.route('**/api/healthz', (route) =>
        route.fulfill({
          json: { status: 'ok', db: 'ok', version, time: new Date().toISOString() },
        }),
      );
      await page.goto('/settings');
    };
    const line = page.getByText(/^app (dev|[0-9a-f]{7})$/);
    const older = page.getByText('This app is older than the server.');

    await reportVersion('dev');
    await expect(line).toBeVisible();
    // The whole version is in the tooltip; "dev" for a local build, a commit for a deployed one.
    const running = (await line.getAttribute('title')) ?? '';
    expect(running).toMatch(/^(dev|[0-9a-f]{7,40})$/);
    await expect(older).toBeHidden();

    // The server runs the very same version: nothing to say.
    await reportVersion(running);
    await expect(line).toBeVisible();
    await expect(older).toBeHidden();

    // The server runs another commit. A real build is then the old one; a local build never says so.
    await reportVersion('f'.repeat(40));
    await expect(line).toBeVisible();
    if (running === 'dev') await expect(older).toBeHidden();
    else await expect(older).toBeVisible();
  });
});
