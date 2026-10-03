import { expect, type Page, test } from '@playwright/test';
import { groupWithPlaceholder, openGroupExpenseForm, openGroupTab, submitButton } from './helpers';

// A shared expense has to say who paid and who owes, and the two sides have to add up exactly.
// Until they do, the form says what is missing and will not save. Alice is signed in and Sam is
// someone she added by name, so the form has two people without needing a second browser.

/** The line under the split that says what is missing (the sync chip is a status too). */
const hint = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test.describe('splitting a shared expense', () => {
  test.beforeEach(async ({ page }) => {
    await groupWithPlaceholder(page, 'Split rules');
    await openGroupExpenseForm(page);
  });

  test('needs an amount before anything else', async ({ page }) => {
    await expect(hint(page, 'Enter an amount.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount', { exact: true }).fill('900');
    await expect(hint(page, 'Enter an amount.')).toHaveCount(0);
    await expect(submitButton(page)).toBeEnabled();
  });

  test('an equal split needs at least one person in it', async ({ page }) => {
    await page.getByLabel('Amount', { exact: true }).fill('900');
    await page.getByRole('checkbox', { name: /Alice/ }).uncheck();
    await page.getByRole('checkbox', { name: /Sam/ }).uncheck();
    await expect(hint(page, 'Pick at least one person to split with.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    // The person who paid does not have to share it: Sam owes all of it.
    await page.getByRole('checkbox', { name: /Sam/ }).check();
    await expect(submitButton(page)).toBeEnabled();
    await submitButton(page).click();
    await openGroupTab(page, 'Balances');
    await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹900');
    await expect(page.getByTestId('balance-Sam')).toHaveText('owes ₹900');
  });

  test('exact amounts must add up to the total, to the paisa', async ({ page }) => {
    await page.getByLabel('Amount', { exact: true }).fill('1000');
    await page.getByRole('radio', { name: 'Exact' }).click();

    // Nothing typed yet.
    await expect(hint(page, 'Pick who shares this expense.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount in rupees for Alice').fill('400');
    await expect(hint(page, '₹600 left to assign.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount in rupees for Sam').fill('700');
    await expect(hint(page, '₹100 over the total.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount in rupees for Sam').fill('599.99');
    await expect(hint(page, '₹0.01 left to assign.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount in rupees for Sam').fill('six hundred');
    await expect(hint(page, 'Check the numbers in the split.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount in rupees for Sam').fill('600');
    await expect(hint(page, 'left to assign')).toHaveCount(0);
    await expect(submitButton(page)).toBeEnabled();
  });

  test('percentages must come to exactly 100, and be real percentages', async ({ page }) => {
    await page.getByLabel('Amount', { exact: true }).fill('1000');
    await page.getByRole('radio', { name: 'Percent' }).click();

    await page.getByLabel('Percent for Alice').fill('60');
    await expect(hint(page, '40% left to assign.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Percent for Sam').fill('50');
    await expect(hint(page, '10% over 100%.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    for (const unreadable of ['101', '-5', '40.555', 'half']) {
      await page.getByLabel('Percent for Sam').fill(unreadable);
      await expect(hint(page, 'Check the numbers in the split.'), unreadable).toBeVisible();
      await expect(submitButton(page), unreadable).toBeDisabled();
    }

    await page.getByLabel('Percent for Sam').fill('33.33');
    await page.getByLabel('Percent for Alice').fill('66.67');
    await expect(submitButton(page)).toBeEnabled();
  });

  test('shares must be whole numbers, and someone has to have one', async ({ page }) => {
    await page.getByLabel('Amount', { exact: true }).fill('900');
    await page.getByRole('radio', { name: 'Shares' }).click();

    // Everyone starts with one share.
    await expect(page.getByLabel('Shares for Alice')).toHaveValue('1');
    await expect(page.getByLabel('Shares for Sam')).toHaveValue('1');
    await expect(submitButton(page)).toBeEnabled();

    for (const unreadable of ['1.5', 'two', '-1', '12345']) {
      await page.getByLabel('Shares for Alice').fill(unreadable);
      await expect(hint(page, 'Check the numbers in the split.'), unreadable).toBeVisible();
      await expect(submitButton(page), unreadable).toBeDisabled();
    }

    // Nobody holds a share.
    await page.getByLabel('Shares for Alice').fill('0');
    await page.getByLabel('Shares for Sam').fill('0');
    await expect(hint(page, 'Pick who shares this expense.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    // Someone with no shares is simply left out.
    await page.getByLabel('Shares for Sam').fill('3');
    await expect(submitButton(page)).toBeEnabled();
  });

  test('when several people paid, what they paid must add up to the total', async ({ page }) => {
    await page.getByLabel('Amount', { exact: true }).fill('1000');
    await page.getByRole('switch', { name: 'More than one person' }).click();

    await expect(hint(page, 'Enter what each person paid.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount paid by Alice').fill('600');
    await expect(hint(page, '₹400 of the payment isn’t assigned yet.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount paid by Sam').fill('500');
    await expect(hint(page, 'Payments are ₹100 over the total.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount paid by Sam').fill('lots');
    await expect(hint(page, 'Check the amounts people paid.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByLabel('Amount paid by Sam').fill('400');
    await expect(submitButton(page)).toBeEnabled();
    await submitButton(page).click();

    // Alice put in ₹600 and owes ₹500; Sam put in ₹400 and owes ₹500.
    await openGroupTab(page, 'Balances');
    await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹100');
    await expect(page.getByTestId('balance-Sam')).toHaveText('owes ₹100');
  });

  test('someone else can be the one who paid, and the balances follow', async ({ page }) => {
    await page.getByLabel('Amount', { exact: true }).fill('900');
    await page.getByLabel('Paid by', { exact: true }).click();
    await page.getByRole('option', { name: 'Sam' }).click();
    await submitButton(page).click();

    // Sam paid ₹900 and it is split equally: Alice owes Sam her ₹450.
    await openGroupTab(page, 'Balances');
    await expect(page.getByTestId('my-balance')).toHaveText('You owe ₹450');
    await expect(page.getByTestId('balance-Sam')).toHaveText('is owed ₹450');
  });

  test('changing the total after choosing a split makes it add up again, or says so', async ({
    page,
  }) => {
    const amount = page.getByLabel('Amount', { exact: true });
    await amount.fill('1000');
    await page.getByRole('radio', { name: 'Exact' }).click();
    await page.getByLabel('Amount in rupees for Alice').fill('400');
    await page.getByLabel('Amount in rupees for Sam').fill('600');
    await expect(submitButton(page)).toBeEnabled();

    // The typed amounts no longer match a different total.
    await amount.fill('800');
    await expect(hint(page, '₹200 over the total.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    await amount.fill('1200');
    await expect(hint(page, '₹200 left to assign.')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await amount.fill('1000');
    await expect(submitButton(page)).toBeEnabled();
  });
});
