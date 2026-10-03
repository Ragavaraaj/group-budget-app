import { expect, type Page, test } from '@playwright/test';
import { chooseOption, devSignIn, uniqueEmail } from './helpers';

// What the bank-statement import does with files that are wrong, empty, too big or only partly
// usable. The happy path, duplicates and column correction are in import.spec.ts.

const pad = (n: number) => String(n).padStart(2, '0');
/** `dd/mm/yyyy`, `daysBack` days before today (negative: in the future). */
const dmy = (daysBack: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

async function chooseFile(page: Page, name: string, content: string | Buffer) {
  await page.getByTestId('statement-file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
  });
}

test.describe('CSV import: files that cannot be used', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('import-limits'));
    await page.goto('/settings/import');
  });

  test('an empty file is refused with a message, and nothing is shown', async ({ page }) => {
    await chooseFile(page, 'empty.csv', '');
    await expect(page.getByText(/Couldn’t find the table/)).toBeVisible();
    await expect(page.getByTestId('import-summary')).toHaveCount(0);
    await expect(page.getByText('Choose a CSV file')).toBeVisible();
  });

  test('a file over 2 MB is refused before it is read', async ({ page }) => {
    await chooseFile(page, 'huge.csv', Buffer.alloc(2_000_001, 'a'));
    await expect(page.getByText(/That file is too big/)).toBeVisible();
    await expect(page.getByTestId('import-summary')).toHaveCount(0);
  });

  test('a file with a header but no rows says there is no spending, and cannot be imported', async ({
    page,
  }) => {
    await chooseFile(page, 'header-only.csv', 'Date,Description,Amount\n');
    await expect(page.getByTestId('import-summary')).toContainText('0 expenses found');
    await expect(page.getByText(/No spending found/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import 0 expenses/ })).toBeDisabled();
  });

  test('a statement of only money coming in imports nothing', async ({ page }) => {
    const csv = [
      'Date,Narration,Withdrawal Amt.,Deposit Amt.',
      `${dmy(0)},SALARY,,50000.00`,
      `${dmy(1)},REFUND,,1200.00`,
    ].join('\n');
    await chooseFile(page, 'credits.csv', csv);
    await expect(page.getByTestId('import-summary')).toContainText('0 expenses found');
    await expect(page.getByTestId('import-summary')).toContainText('2 money in, left out');
    await expect(page.getByRole('button', { name: /^Import 0 expenses/ })).toBeDisabled();
    await expect(page.getByTestId('import-rows')).toHaveCount(0);
  });

  test('lines with a bad date, a missing or unreadable amount, or a date in the future are skipped and counted', async ({
    page,
  }) => {
    const csv = [
      'Date,Description,Amount',
      `${dmy(0)},Good one,-100.00`,
      '31/02/2026,Not a real day,-50.00',
      `${dmy(1)},No amount,`,
      `${dmy(1)},Words for an amount,plenty`,
      `${dmy(1)},Three decimals,-1.234`,
      `${dmy(-3)},Next week,-75.00`,
      ',No date at all,-20.00',
    ].join('\n');
    await chooseFile(page, 'messy.csv', csv);

    await expect(page.getByTestId('import-summary')).toContainText('1 expense found');
    await expect(page.getByTestId('import-summary')).toContainText('6 lines skipped');
    const rows = page.getByTestId('import-rows').getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Good one');
    await expect(page.getByRole('button', { name: /^Import 1 expense / })).toBeEnabled();
  });

  test('pointing a column at "Not in this file" leaves nothing to import, and it can be put back', async ({
    page,
  }) => {
    const csv = ['Date,Description,Amount', `${dmy(0)},Tea,-30.00`].join('\n');
    await chooseFile(page, 'columns.csv', csv);
    await expect(page.getByTestId('import-summary')).toContainText('1 expense found');

    await chooseOption(page, 'Date', 'Not in this file');
    await expect(page.getByTestId('import-summary')).toContainText('0 expenses found');
    await expect(page.getByText(/No spending found/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import 0 expenses/ })).toBeDisabled();

    await chooseOption(page, 'Date', 'Date');
    await expect(page.getByTestId('import-summary')).toContainText('1 expense found');
  });

  test('choosing the wrong sign for spending turns everything into money in', async ({ page }) => {
    // A card statement: spending is positive.
    const csv = [
      'Date,Description,Amount',
      `${dmy(0)},Shop one,250.00`,
      `${dmy(1)},Shop two,90.00`,
    ].join('\n');
    await chooseFile(page, 'card.csv', csv);
    await expect(page.getByTestId('import-summary')).toContainText('2 expenses found');
    await expect(page.getByRole('radio', { name: 'Positive numbers' })).toBeChecked();

    await page.getByRole('radio', { name: 'Negative numbers' }).click();
    await expect(page.getByTestId('import-summary')).toContainText('0 expenses found');
    await expect(page.getByTestId('import-summary')).toContainText('2 money in, left out');
    await expect(page.getByRole('button', { name: /^Import 0 expenses/ })).toBeDisabled();
  });

  test('choosing a second file replaces the first, and ticks and categories do not carry over', async ({
    page,
  }) => {
    await chooseFile(
      page,
      'one.csv',
      ['Date,Description,Amount', `${dmy(0)},First file row,-10.00`].join('\n'),
    );
    await page.getByLabel(/Import First file row/).uncheck();
    await expect(page.getByRole('button', { name: /^Import 0 expenses/ })).toBeDisabled();

    await chooseFile(
      page,
      'two.csv',
      ['Date,Description,Amount', `${dmy(0)},Second file row,-20.00`].join('\n'),
    );
    await expect(page.getByText('Chosen: two.csv')).toBeVisible();
    await expect(page.getByTestId('import-rows')).not.toContainText('First file row');
    await expect(page.getByLabel(/Import Second file row/)).toBeChecked();
    await expect(page.getByRole('button', { name: /^Import 1 expense / })).toBeEnabled();
  });
});

test.describe('CSV import: a long statement', () => {
  const ROWS = 501;
  const statement = () =>
    [
      'Date,Description,Amount',
      // Distinct amounts, so none looks like a duplicate of another.
      ...Array.from({ length: ROWS }, (_, i) => `${dmy(0)},Row ${i + 1},-${100 + i}.00`),
    ].join('\n');

  test('shows the first 500, and importing them lets the rest be imported by choosing the file again', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('import-long'));
    await page.goto('/settings/import');
    await chooseFile(page, 'long.csv', statement());

    // The page says that only the first 500 are shown, and how to get the rest.
    await expect(page.getByRole('alert')).toContainText(
      'This file has 501 expenses. The first 500 are shown',
    );
    await expect(page.getByTestId('import-rows').getByRole('listitem')).toHaveCount(500);
    await page.getByRole('button', { name: /^Import 500 expenses/ }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 90_000 });
    await expect(page.getByText('500 expenses', { exact: true })).toBeVisible();

    // "...import them, then choose the file again for the rest (the ones you have imported will
    // be unticked)."
    await page.goto('/settings/import');
    await chooseFile(page, 'long.csv', statement());
    await expect(page.getByTestId('import-summary')).toContainText('look already recorded');
    await expect(page.getByLabel(/Import Row 501/)).toBeChecked();
    await expect(page.getByRole('button', { name: /^Import 1 expense / })).toBeEnabled();
  });
});
