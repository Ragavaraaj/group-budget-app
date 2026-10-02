import { expect, test } from '@playwright/test';
import { devSignIn, newPerson, uniqueEmail, waitForSynced } from './helpers';

/** Adds an expense through the form the way a person would: amount first. */
async function addExpense(
  page: import('@playwright/test').Page,
  amount: string,
  note: string,
  category?: string,
) {
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount').fill(amount);
  if (category) await page.getByRole('button', { name: category }).click();
  await page.getByLabel('Note (optional)').fill(note);
  await page.getByRole('button', { name: 'Add expense' }).click();
  // The form closes only after the expense has been written to the local database.
  await expect(page.getByLabel('Amount')).toBeHidden();
}

test.describe('personal ledger', () => {
  test('adds, edits and deletes an expense, with undo', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('ledger'));
    await page.goto('/');
    await expect(page.getByText('No expenses in')).toBeVisible();

    await addExpense(page, '1,234.5', 'Groceries', 'Groceries');
    await expect(page.getByRole('link', { name: /Groceries/ })).toBeVisible();
    await expect(page.getByTestId('month-total')).toContainText('₹1,234.50');

    // Edit it.
    await page.getByRole('link', { name: /Groceries/ }).click();
    await expect(page.getByLabel('Amount')).toHaveValue('1234.50');
    await page.getByLabel('Amount').fill('2000');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹2,000');

    // Delete, then undo.
    await page.getByRole('link', { name: /Groceries/ }).click();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    await expect(page.getByText('No expenses in')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹2,000');
  });

  test('works with no connection: add offline, reload offline, then it reaches the server and another device', async ({
    page,
    context,
    browser,
  }) => {
    const email = uniqueEmail('offline-ledger');
    await page.goto('/login');
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await devSignIn(page, email, 'Offline Olga');
    await page.goto('/');
    await waitForSynced(page);

    await context.setOffline(true);
    await addExpense(page, '350', 'Chai at the station');
    await expect(page.getByRole('link', { name: /Chai at the station/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /Offline.*1 waiting/ })).toBeVisible();

    // Reloading while offline still shows it: the local database is the source of truth.
    await page.reload();
    await expect(page.getByRole('link', { name: /Chai at the station/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Chai at the station/ })).toContainText(
      'Not synced yet',
    );

    // Back online: the change is sent without the person doing anything.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitForSynced(page);
    await expect(page.getByRole('link', { name: /Chai at the station/ })).not.toContainText(
      'Not synced yet',
    );

    // A second device for the same person catches up from the server.
    const second = await browser.newContext({ baseURL: 'http://localhost:8787' });
    const other = await second.newPage();
    await devSignIn(other, email, 'Offline Olga');
    await other.goto('/');
    await expect(other.getByRole('link', { name: /Chai at the station/ })).toBeVisible();
    await expect(other.getByTestId('month-total')).toContainText('₹350');
    await second.close();
  });

  test('a change made on one device shows up on another by itself', async ({ page, browser }) => {
    const email = uniqueEmail('two-devices');
    await page.goto('/login');
    await devSignIn(page, email, 'Dev One');
    await page.goto('/');
    await waitForSynced(page);

    const other = await newPerson(browser, email, 'Dev One');
    await other.page.goto('/');
    await waitForSynced(other.page);

    await addExpense(page, '99', 'From device one');
    // Wait for the server to have it: the "Not synced yet" note goes once the push is acknowledged.
    const row = page.getByRole('link', { name: /From device one/ });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Not synced yet');

    // The second device polls (and syncs when brought to the front); simulate coming back to it.
    await other.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(other.page.getByRole('link', { name: /From device one/ })).toBeVisible({
      timeout: 15_000,
    });
    await other.context.close();
  });

  test('categories can be added and used', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('categories'));
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('Name').fill('Pets');
    await page.getByRole('button', { name: 'paw print' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Pets')).toBeVisible();

    await page.goto('/add');
    await expect(page.getByRole('button', { name: 'Pets' })).toBeVisible();
  });

  test('exports expenses as CSV', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('export'));
    await page.goto('/');
    await addExpense(page, '120.50', '=HYPERLINK("evil")');

    await page.goto('/settings');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const file = await download;
    const path = await file.path();
    const { readFile } = await import('node:fs/promises');
    const csv = await readFile(path, 'utf8');
    expect(csv).toContain('Date,Group,Category,Note,Total (INR),Your share (INR),Paid by,Added by');
    expect(csv).toContain('120.50');
    expect(csv).toContain("'=HYPERLINK"); // a formula in a note is defused
  });
});
