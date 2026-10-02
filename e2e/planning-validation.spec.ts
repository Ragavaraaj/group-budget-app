import { expect, type Page, test } from '@playwright/test';
import {
  addExpenseOn,
  daysAgo,
  devSignIn,
  groupOfTwo,
  missingId,
  pickDate,
  uniqueEmail,
  waitForSynced,
} from './helpers';

test.describe('budgets: what is refused and where the lines fall', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('budget-rules'));
  });

  test('a limit has to be a positive amount', async ({ page }) => {
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    const dialog = page.getByRole('dialog');
    const limit = dialog.getByLabel('Monthly limit');
    const save = dialog.getByRole('button', { name: 'Save' });

    for (const bad of ['', '0', '0.00', '-100', 'lots', '1.234', '100000001']) {
      await limit.fill(bad);
      await expect(save, `"${bad}"`).toBeDisabled();
    }
    // Marked invalid when it cannot be read, not when it is merely empty or zero.
    await limit.fill('lots');
    await expect(limit).toHaveAttribute('aria-invalid', 'true');
    await limit.fill('');
    await expect(limit).toHaveAttribute('aria-invalid', 'false');

    await limit.fill('5000');
    await expect(save).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('No budgets yet')).toBeVisible();
  });

  test('what an existing budget is for cannot be changed, only its limit', async ({ page }) => {
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('dialog').getByLabel('Monthly limit').fill('2000');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('of ₹2,000');

    await page.getByRole('button', { name: 'Edit Everything budget' }).click();
    await expect(page.getByRole('dialog').getByLabel('For')).toBeDisabled();
    await page.getByRole('dialog').getByLabel('Monthly limit').fill('0');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Save' })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('of ₹2,000');
  });

  test('is quiet below 80%, warns at 80%, and is over at 100%, and follows deletes and undo', async ({
    page,
  }) => {
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('For').click();
    await page.getByRole('option', { name: 'Food & dining' }).click();
    await page.getByLabel('Monthly limit').fill('1000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('₹1,000 left'); // it is saved

    const alerts = page.getByTestId('budget-alerts');
    await page.goto('/');
    await addExpenseOn(page, { amount: '799', note: 'Almost', category: 'Food & dining' });
    await expect(page.getByTestId('month-total')).toContainText('₹799');
    await expect(alerts).toHaveCount(0); // 79.9%

    await addExpenseOn(page, { amount: '1', note: 'Tipping point', category: 'Food & dining' });
    await expect(alerts).toContainText('Food & dining is at 80% of its budget');

    await addExpenseOn(page, { amount: '200', note: 'Last bit', category: 'Food & dining' });
    await expect(alerts).toContainText('is over its budget this month'); // exactly 100% is over

    // Deleting the last one drops back to a warning; undo puts the alert back as it was.
    await page.getByRole('link', { name: /Last bit/ }).click();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    await expect(alerts).toContainText('is at 80% of its budget');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(alerts).toContainText('is over its budget this month');

    // Spending in another category does not count against the Food budget.
    await page.getByRole('link', { name: /Last bit/ }).click();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    await addExpenseOn(page, { amount: '5000', note: 'Flight', category: 'Travel' });
    await expect(alerts).toContainText('Food & dining is at 80%');
    await expect(alerts).not.toContainText('Travel');
  });

  test('looking at an earlier month shows that month, and the next month is not reachable', async ({
    page,
  }) => {
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('Monthly limit').fill('1000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('₹1,000 left'); // it is saved
    await page.goto('/');
    await addExpenseOn(page, { amount: '400', note: 'This month' });

    await page.goto('/budgets');
    await expect(page.getByTestId('budget-bar')).toContainText('₹400 of ₹1,000');
    await expect(page.getByRole('button', { name: 'Next period' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('₹0 of ₹1,000');
    await expect(page.getByTestId('budget-bar')).toContainText('₹1,000 left');
    await expect(page.getByRole('button', { name: 'Next period' })).toBeEnabled();
    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('₹400 of ₹1,000');
  });

  test('the Back arrow goes where the person came from', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Budgets' }).click();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/settings$/);

    // Arriving with no "from", or one that points to another site, it goes to Insights.
    for (const from of ['', '&from=https://evil.example/', '&from=//evil.example/']) {
      await page.goto(`/budgets?x=1${from}`);
      await page.getByRole('link', { name: 'Back' }).click();
      await expect(page, from).toHaveURL(/\/insights$/);
    }
  });
});

test.describe('recurring expenses: what is refused', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('recurring-rules'));
  });

  test('needs an amount, and cannot end before it starts', async ({ page }) => {
    await page.goto('/settings/recurring/new');
    const add = page.getByRole('button', { name: 'Add recurring expense' });
    await expect(add).toBeDisabled();
    for (const bad of ['0', 'abc', '-3', '1.234']) {
      await page.getByLabel('Amount').fill(bad);
      await expect(add, `"${bad}"`).toBeDisabled();
    }
    await page.getByLabel('Amount').fill('100');
    await expect(add).toBeEnabled();

    // Starts ten days ago, ends five days ago: fine. Then the start moves past the end.
    await pickDate(page, 'First on', daysAgo(10));
    await pickDate(page, 'Until (optional)', daysAgo(5));
    await expect(add).toBeEnabled();
    await pickDate(page, 'First on', daysAgo(2));
    await expect(page.getByLabel('Until (optional)', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(add).toBeDisabled();

    // Taking the end date away fixes it.
    await page.getByLabel('Until (optional)', { exact: true }).click();
    await page.getByRole('button', { name: 'Clear date' }).click();
    await expect(page.getByLabel('Until (optional)', { exact: true })).toHaveText('No end');
    await expect(add).toBeEnabled();
  });

  test('can start as far back as three months, no further, and any time ahead', async ({
    page,
  }) => {
    await page.goto('/settings/recurring/new');
    /** Whether the calendar lets this day be chosen. */
    const pickable = async (iso: string): Promise<boolean> => {
      const [year, month] = iso.split('-').map(Number) as [number, number];
      await page.getByLabel('First on', { exact: true }).click();
      const years = page.getByRole('combobox', { name: 'Choose the Year' });
      const months = page.getByRole('combobox', { name: 'Choose the Month' });
      let result = false;
      const yearOption = years.locator(`option[value="${year}"]`);
      if ((await yearOption.count()) > 0) {
        await years.selectOption(String(year));
        const monthOption = months.locator(`option[value="${month - 1}"]`);
        const monthEnabled =
          (await monthOption.count()) > 0 &&
          !(await monthOption.evaluate((o) => (o as HTMLOptionElement).disabled));
        if (monthEnabled) {
          await months.selectOption(String(month - 1));
          const day = page.locator(`[data-day="${iso}"] button`);
          result = (await day.count()) > 0 && (await day.isEnabled());
        }
      }
      await page.keyboard.press('Escape');
      await expect(years).toHaveCount(0); // closed again, so the next call starts clean
      return result;
    };

    expect(await pickable(daysAgo(93)), 'the oldest day allowed').toBe(true);
    expect(await pickable(daysAgo(94)), 'one day too far back').toBe(false);
    expect(await pickable(daysAgo(200)), 'well past it').toBe(false);
    expect(await pickable(daysAgo(0)), 'today').toBe(true);
    expect(await pickable(daysAgo(-60)), 'two months ahead').toBe(true);
  });

  test('the summary follows how often it repeats', async ({ page }) => {
    await page.goto('/settings/recurring/new');
    const summary = page.getByTestId('schedule-summary');
    await expect(summary).toContainText('Every month on the');
    await page.getByRole('radio', { name: 'Weekly' }).click();
    await expect(summary).toContainText('Every week on');
    await page.getByRole('radio', { name: 'Yearly' }).click();
    await expect(summary).toContainText('Every year on');
    await page.getByRole('radio', { name: 'Monthly' }).click();
    await expect(summary).toContainText('Every month on the');
  });

  test('a rule can be changed, and one that does not exist is not found', async ({ page }) => {
    await page.goto('/settings/recurring/new');
    await page.getByLabel('Amount').fill('999');
    await page.getByLabel('What is it?').fill('Gym');
    await page.getByRole('button', { name: 'Add recurring expense' }).click();
    await expect(page.getByTestId('recurring-list')).toContainText('₹999');
    await waitForSynced(page);

    await page.getByRole('link', { name: /Gym/ }).click();
    await expect(page.getByLabel('Amount')).toHaveValue('999');
    await page.getByLabel('Amount').fill('');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await page.getByLabel('Amount').fill('1250');
    await page.getByRole('radio', { name: 'Weekly' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('recurring-list')).toContainText('₹1,250');
    await expect(page.getByTestId('recurring-list')).toContainText('Every week on');
    await expect(page.getByTestId('recurring-list')).not.toContainText('₹999');

    await page.goto(`/settings/recurring/${missingId()}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('recurring expenses in a group', () => {
  async function waitingRuleSetup(page: Page, browser: Parameters<typeof groupOfTwo>[1]) {
    const { bob, groupPath } = await groupOfTwo(page, browser, 'Shared rent');
    const groupId = groupPath.split('/').pop();

    // Alice sets up a rule shared with Bob.
    await page.goto(`/settings/recurring/new?group=${groupId}`);
    await page.getByLabel('Amount', { exact: true }).fill('12000');
    await page.getByLabel('What is it?').fill('Flat rent');
    await page.getByRole('button', { name: 'Add recurring expense' }).click();
    await expect(page.getByTestId('recurring-list')).toContainText('Flat rent');
    await waitForSynced(page);

    // Then Bob leaves the group.
    await page.goto(`${groupPath}?tab=members`);
    await page.getByRole('button', { name: 'Remove Bob' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Bob was removed')).toBeVisible();
    return bob;
  }

  test('a rule that still names someone who left is held back, and says why', async ({
    page,
    browser,
  }) => {
    const bob = await waitingRuleSetup(page, browser);

    await page.goto('/settings/recurring');
    await expect(page.getByTestId('rule-waiting')).toContainText(
      'Waiting: Bob left the group. Open it and take them out of the split.',
    );

    // It can be paused, but not switched back on while Bob is still in it.
    await page.getByRole('switch', { name: /Flat rent is on/ }).click();
    await expect(page.getByRole('switch', { name: /Flat rent is paused/ })).toBeVisible();
    await expect(page.getByTestId('rule-waiting')).toHaveCount(0);
    await page.getByRole('switch', { name: /Flat rent is paused/ }).click();
    await expect(
      page.getByText('Bob left the group. Open this rule and take them out of the split first.'),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: /Flat rent is paused/ })).toBeVisible();

    // Opening the rule: turning it on is refused until Bob is taken out of the split.
    await page.getByRole('link', { name: /Flat rent/ }).click();
    await expect(page.getByTestId('leavers')).toHaveCount(0); // paused rules may keep him
    await page.getByRole('switch', { name: /Add these automatically/ }).click();
    await expect(page.getByTestId('leavers')).toContainText('Bob left the group');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await page.getByRole('checkbox', { name: /Bob \(left\)/ }).uncheck();
    await expect(page.getByTestId('leavers')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('rule-waiting')).toHaveCount(0);
    await expect(page.getByRole('switch', { name: /Flat rent is on/ })).toBeVisible();
    await bob.context.close();
  });
});
