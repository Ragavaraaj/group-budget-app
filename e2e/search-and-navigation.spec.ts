import { expect, test } from '@playwright/test';
import {
  addExpenseOn,
  clearDate,
  createGroup,
  daysAgo,
  devSignIn,
  midPreviousMonth,
  missingId,
  openGroupExpenseForm,
  pickDate,
  submitButton,
  uniqueEmail,
} from './helpers';

test.describe('search: narrowing, and finding nothing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('search-rules'));
    await page.goto('/');
    // The form remembers the last category used, so the ones with none come first.
    await addExpenseOn(page, { amount: '450', note: 'Loose change' });
    await addExpenseOn(page, { amount: '300', note: 'Old bill', date: daysAgo(20) });
    await addExpenseOn(page, { amount: '90', note: 'Masala chai', category: 'Food & dining' });
    await page.goto('/search');
  });

  test('a minimum above the maximum matches nothing, and an unreadable amount is flagged', async ({
    page,
  }) => {
    await page.getByLabel('Search expenses').fill('chai');
    await expect(page.getByTestId('search-summary')).toContainText('1 expense · ₹90');

    await page.getByLabel('At least (₹)').fill('500');
    await page.getByLabel('At most (₹)').fill('100');
    await expect(page.getByTestId('search-empty')).toBeVisible();
    await expect(page.getByTestId('search-summary')).toHaveCount(0);

    await page.getByLabel('At least (₹)').fill('lots');
    await expect(page.getByLabel('At least (₹)')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('At least (₹)').fill('');
    await expect(page.getByLabel('At least (₹)')).toHaveAttribute('aria-invalid', 'false');
  });

  test('"No category" finds the expenses that have none', async ({ page }) => {
    await page.getByLabel('Category').click();
    await page.getByRole('option', { name: 'No category' }).click();
    await expect(page.getByTestId('search-summary')).toContainText('2 expenses · ₹750');
    await expect(page.getByRole('link', { name: /Masala chai/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Loose change/ })).toBeVisible();
  });

  test('a date range keeps what is inside it, and "Clear search" resets everything', async ({
    page,
  }) => {
    await pickDate(page, 'From', daysAgo(10));
    await expect(page.getByTestId('search-summary')).toContainText('2 expenses · ₹540');
    await expect(page.getByRole('link', { name: /Old bill/ })).toHaveCount(0);

    // Replace the start with an end before the recent ones.
    await clearDate(page, 'From');
    await pickDate(page, 'To', daysAgo(15));
    await expect(page.getByTestId('search-summary')).toContainText('1 expense · ₹300');
    await expect(page.getByRole('link', { name: /Old bill/ })).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByText('Type something above')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);
  });

  test('searching for something that is not there says "Nothing matches"', async ({ page }) => {
    for (const words of ['zebra', '99999', 'chai tea latte']) {
      await page.getByLabel('Search expenses').fill(words);
      await expect(page.getByTestId('search-empty'), words).toContainText('Nothing matches.');
    }
  });
});

test.describe('search inside a group', () => {
  test('is limited to that group until "All my groups" is chosen', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('search-group'));
    await page.goto('/');
    await addExpenseOn(page, { amount: '60', note: 'Personal coffee' });

    await createGroup(page, 'Scoped');
    await openGroupExpenseForm(page);
    await page.getByLabel('Amount', { exact: true }).fill('800');
    await page.getByLabel('Note (optional)').fill('Group coffee');
    await submitButton(page).click();
    await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();

    await page.getByRole('link', { name: 'Search this group' }).click();
    await expect(page.getByRole('heading', { name: /Search/ })).toContainText('Scoped');
    await page.getByLabel('Search expenses').fill('coffee');
    await expect(page.getByTestId('search-summary')).toContainText('1 expense · ₹800');
    await expect(page.getByRole('link', { name: /Personal coffee/ })).toHaveCount(0);

    await page.getByLabel('Group', { exact: true }).click();
    await page.getByRole('option', { name: 'All my groups' }).click();
    await expect(page.getByTestId('search-summary')).toContainText('2 expenses · ₹860');

    // Back from a group's search goes to the group, not to the personal ledger.
    await page.getByLabel('Group', { exact: true }).click();
    await page.getByRole('option', { name: 'Scoped' }).click();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Scoped' })).toBeVisible();
  });
});

test.describe('insights: periods and what is counted', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('insights-rules'));
    await page.goto('/');
  });

  test('cannot go past the current period, and an earlier one with nothing says so', async ({
    page,
  }) => {
    await addExpenseOn(page, { amount: '250', note: 'Now', category: 'Transport' });
    await page.goto('/insights');
    await expect(page.getByRole('button', { name: 'Next period' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.getByText(/Nothing spent in/)).toBeVisible();
    await expect(page.getByTestId('insights-total')).toContainText('₹0');
    await expect(page.getByTestId('category-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next period' })).toBeEnabled();

    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByTestId('insights-total')).toContainText('₹250');

    // The year view stops at this financial year too.
    await page.getByRole('radio', { name: 'Year' }).click();
    await expect(page.getByRole('button', { name: 'Next period' })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.getByText(/Nothing spent in FY/)).toBeVisible();
  });

  test('"Whole group" is offered only for one shared group', async ({ page }) => {
    await createGroup(page, 'Counted');
    await page.goto('/insights');
    const measure = page.getByRole('radiogroup', { name: 'What to count' });

    await expect(measure).toHaveCount(0); // all my groups
    await page.getByLabel('Group', { exact: true }).click();
    await page.getByRole('option', { name: 'Personal' }).click();
    await expect(measure).toHaveCount(0);

    await page.getByLabel('Group', { exact: true }).click();
    await page.getByRole('option', { name: 'Counted' }).click();
    await expect(measure).toBeVisible();
    await page.getByLabel('Group', { exact: true }).click();
    await page.getByRole('option', { name: 'All my groups' }).click();
    await expect(measure).toHaveCount(0);
  });
});

test.describe('moving around', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('navigation'));
    await page.goto('/');
  });

  test('the tab bar goes to each screen and marks where you are', async ({ page }) => {
    const bar = page.getByRole('navigation', { name: 'Primary' });
    const tabs = [
      { name: 'Insights', heading: 'Insights' },
      { name: 'Groups', heading: 'Groups' },
      { name: 'Settings', heading: 'Settings' },
      { name: 'Expenses', heading: 'Expenses' },
    ];
    for (const { name, heading } of tabs) {
      await bar.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(bar.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('an earlier month shows its own expenses and cannot be moved past the present', async ({
    page,
  }) => {
    await addExpenseOn(page, { amount: '700', note: 'This month rent' });
    await addExpenseOn(page, { amount: '120', note: 'Last month tea', date: midPreviousMonth() });
    await expect(page.getByTestId('month-total')).toContainText('₹700');
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹120');
    await expect(page.getByRole('link', { name: /Last month tea/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /This month rent/ })).toHaveCount(0);

    // Two months back is empty.
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText('No expenses in')).toBeVisible();
    await expect(page.getByTestId('month-total')).toContainText('₹0');

    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹700');
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  test('addresses that do not exist show the not-found page, with a way back', async ({ page }) => {
    for (const path of [
      '/settings/nothing',
      '/add/extra',
      `/groups/${missingId()}/extra`,
      '/insights/2026',
      '/expenses',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Page not found' }), path).toBeVisible();
    }
    await page.getByRole('link', { name: 'Back to expenses' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('month-total')).toBeVisible();
  });

  test('the "install this app" note can be dismissed for the visit, and comes back in a new tab', async ({
    page,
    context,
  }) => {
    const note = page.getByText('Install this app to your home screen for offline use');
    await expect(note).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(note).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
    await expect(note).toHaveCount(0);

    const another = await context.newPage();
    await another.goto('/');
    await expect(
      another.getByText('Install this app to your home screen for offline use'),
    ).toBeVisible();
  });
});
