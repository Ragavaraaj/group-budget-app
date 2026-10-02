import { expect, test } from '@playwright/test';
import { devSignIn, uniqueEmail } from './helpers';

const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (daysBack: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// A statement in the layout HDFC-style exports use, with account details above the table, one
// credit, a row with no readable amount, and a totals line. Every line is dated today so the
// month's total on the Expenses screen doesn't depend on where in the month the test runs.
const statement = () =>
  [
    'Account Statement,,,,,,',
    'Customer: Test,,,,,,',
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    `${dmy(0)},UPI-SWIGGY-order 1,0001,${dmy(0)},450.00,,9550.00`,
    `${dmy(0)},SALARY CREDIT,0002,${dmy(0)},,50000.00,59550.00`,
    `${dmy(0)},UPI-UBER-trip,0003,${dmy(0)},"1,120.50",,58429.50`,
    `${dmy(0)},Opening balance note,,${dmy(0)},,,58429.50`,
    `${dmy(0)},Chai wala,0004,${dmy(0)},30.00,,58399.50`,
    ',Total,,,1600.50,50000.00,',
  ].join('\n');

test.describe('CSV import', () => {
  test('reads a bank statement, previews it, and imports the spending', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('import'));
    await page.goto('/settings/import');

    await page.getByTestId('statement-file').setInputFiles({
      name: 'statement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(statement()),
    });

    await expect(page.getByText('This looks like a HDFC Bank statement.')).toBeVisible();
    // Three payments out; the salary is left out; two lines can't be read.
    await expect(page.getByTestId('import-summary')).toContainText('3 expenses found');
    await expect(page.getByTestId('import-summary')).toContainText('1 money in, left out');
    await expect(page.getByTestId('import-summary')).toContainText('2 lines skipped');
    const rows = page.getByTestId('import-rows').getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('UPI-SWIGGY-order 1');
    await expect(rows.first()).toContainText('₹450');

    // Words in the narration pick a category; it can still be changed.
    await expect(page.getByLabel('Category for UPI-SWIGGY-order 1')).toHaveValue(/.+/);
    await expect(page.getByLabel('Category for Chai wala')).toHaveValue('');

    // Leave one out, then import.
    await page.getByLabel(/Import Chai wala/).uncheck();
    await expect(page.getByRole('button', { name: /^Import 2 expenses/ })).toBeVisible();
    await page.getByRole('button', { name: /^Import 2 expenses/ }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: /UPI-SWIGGY-order 1/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /UPI-UBER-trip/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Chai wala/ })).toBeHidden();
    await expect(page.getByTestId('month-total')).toContainText('₹1,570.50');
  });

  test('flags what is already recorded when the same file is chosen again', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('import-twice'));
    const file = {
      name: 'statement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(statement()),
    };

    await page.goto('/settings/import');
    await page.getByTestId('statement-file').setInputFiles(file);
    await page.getByRole('button', { name: /^Import 3 expenses/ }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/settings/import');
    await page.getByTestId('statement-file').setInputFiles(file);
    await expect(page.getByTestId('import-summary')).toContainText('3 look already recorded');
    // Everything is unticked, so there is nothing to import until the person says so.
    await expect(page.getByRole('button', { name: /^Import 0 expenses/ })).toBeDisabled();
    await page.getByLabel(/Import Chai wala/).check();
    await expect(page.getByRole('button', { name: /^Import 1 expense / })).toBeEnabled();
  });

  test('lets a column be changed when it was guessed wrong', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('import-columns'));
    await page.goto('/settings/import');
    const csv = [
      'Date,Description,Amount,Merchant',
      `${dmy(0)},Card payment,-250.00,Corner shop`,
    ].join('\n');
    await page.getByTestId('statement-file').setInputFiles({
      name: 'odd.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByTestId('import-summary')).toContainText('1 expense found');
    await expect(page.getByTestId('import-rows')).toContainText('Card payment');

    await page.getByLabel('Description', { exact: true }).selectOption({ label: 'Merchant' });
    await expect(page.getByTestId('import-rows')).toContainText('Corner shop');
    await expect(page.getByTestId('import-rows')).not.toContainText('Card payment');
  });

  test('refuses a file that is not a statement', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('import-bad'));
    await page.goto('/settings/import');
    await page.getByTestId('statement-file').setInputFiles({
      name: 'notes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('hello,world\nfoo,bar\n'),
    });
    await expect(page.getByText(/Couldn’t find the table/)).toBeVisible();
    await expect(page.getByTestId('import-rows')).toHaveCount(0);
  });
});
