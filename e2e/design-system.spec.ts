import { expect, test } from '@playwright/test';
import { chooseOption, createGroup, devSignIn, nativeDropdowns, uniqueEmail } from './helpers';

// The app's drop-downs are the shadcn Select (a styled button that opens a list), so they look
// and behave the same everywhere and match the theme. The browser's own `<select>` does neither.

test.describe('drop-downs are the app’s Select, not the browser’s', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('design-system'));
  });

  test('Settings: the month start day', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByLabel('A month starts on day')).toBeVisible();
    expect(await nativeDropdowns(page)).toEqual([]);

    // It works as a Select does, and what was chosen is kept.
    await chooseOption(page, 'A month starts on day', '25');
    await expect(page.getByLabel('A month starts on day')).toContainText('25');
  });

  test('Import from CSV: the column pickers and each row’s category', async ({ page }) => {
    const csv = ['Date,Description,Amount', '02/01/2026,Tea,-30.00'].join('\n');
    await page.goto('/settings/import');
    await page.getByTestId('statement-file').setInputFiles({
      name: 'one.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByTestId('import-rows')).toBeVisible();
    expect(await nativeDropdowns(page)).toEqual([]);
  });

  // The rest of the app already does it right; this keeps it that way.
  test('everywhere else, including every screen that has a group chooser', async ({ page }) => {
    await createGroup(page, 'Chooser'); // a second group makes the group choosers appear
    const screens = [
      '/',
      '/add',
      '/groups',
      '/insights',
      '/search',
      '/budgets',
      '/settings/categories',
      '/settings/recurring',
      '/settings/recurring/new',
    ];
    for (const path of screens) {
      await page.goto(path);
      await expect(page.getByRole('heading').first(), path).toBeVisible();
      expect(await nativeDropdowns(page), path).toEqual([]);
    }
    // And with the dialogs that hold a Select open.
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await nativeDropdowns(page), 'new budget').toEqual([]);
  });
});
