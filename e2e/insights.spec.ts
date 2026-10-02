import { expect, test } from '@playwright/test';
import {
  addExpenseOn,
  createGroup,
  daysAgo,
  devSignIn,
  midPreviousMonth,
  uniqueEmail,
} from './helpers';

test.describe('insights', () => {
  test('shows the month total, the split by category and how it compares with last month', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('insights'));
    await page.goto('/');

    await addExpenseOn(page, { amount: '1200', note: 'Dinner out', category: 'Food & dining' });
    await addExpenseOn(page, { amount: '800', note: 'Cab', category: 'Transport' });
    await addExpenseOn(page, {
      amount: '500',
      note: 'Last month lunch',
      category: 'Food & dining',
      date: midPreviousMonth(),
    });

    await page.getByRole('link', { name: 'Insights' }).click();
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();

    // This month: ₹2,000, Food 60% and Transport 40%.
    await expect(page.getByTestId('insights-total')).toContainText('₹2,000');
    const rows = page.getByTestId('category-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Food & dining');
    await expect(rows.first()).toContainText('₹1,200');
    await expect(rows.first()).toContainText('60%');
    await expect(rows.last()).toContainText('Transport');
    await expect(rows.last()).toContainText('40%');

    // Compared with the month before, which had ₹500.
    await expect(page.getByTestId('insights-previous')).toContainText('₹500');
    await expect(page.getByTestId('insights-change')).toContainText('₹1,500 more');

    // The chart describes itself to a screen reader, with every month's figure.
    const chart = page.getByTestId('insights-trend').getByRole('img');
    await expect(chart).toHaveAttribute('aria-label', /₹2,000/);
    await expect(chart).toHaveAttribute('aria-label', /₹500/);

    // Back one period: only the old lunch.
    await page.getByRole('button', { name: 'Previous period' }).click();
    await expect(page.getByTestId('insights-total')).toContainText('₹500');
    await expect(page.getByTestId('category-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Next period' }).click();
    await expect(page.getByTestId('insights-total')).toContainText('₹2,000');
  });

  test('has a financial-year view', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('insights-fy'));
    await page.goto('/');
    await addExpenseOn(page, { amount: '300', note: 'Chai', category: 'Food & dining' });

    await page.goto('/insights');
    await page.getByRole('radio', { name: 'Year' }).click();
    await expect(page.getByTestId('insights-period')).toContainText(/^FY \d{4}–\d{2}$/);
    await expect(page.getByTestId('insights-total')).toContainText('₹300');
    // Twelve months of the year are on the chart.
    await expect(page.getByTestId('insights-trend').getByRole('img')).toHaveAttribute(
      'aria-label',
      /Apr .*Mar/,
    );
  });

  test('says so when there is nothing to show', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('insights-empty'));
    await page.goto('/insights');
    await expect(page.getByText(/Nothing spent in/)).toBeVisible();
  });

  test('counts only your own share of a shared expense', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('insights-share'), 'Asha');
    await createGroup(page, 'Flat');

    // Alone in the group, an expense is entirely her own share.
    await page.getByRole('link', { name: 'Add expense' }).click();
    await page.getByLabel('Amount').fill('900');
    await page.getByLabel('Note (optional)').fill('Electricity');
    await page.getByRole('button', { name: 'Add expense' }).click();
    await expect(page.getByLabel('Amount')).toBeHidden();

    await page.getByRole('link', { name: 'Insights for this group' }).click();
    await expect(page.getByTestId('insights-total')).toContainText('₹900');
    await expect(page.getByRole('radio', { name: 'Whole group' })).toBeVisible();
    await page.getByRole('radio', { name: 'Whole group' }).click();
    await expect(page.getByTestId('insights-total')).toContainText('₹900');
  });
});

test.describe('search', () => {
  test('finds expenses by words, category and amount, across months', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('search'));
    await page.goto('/');
    await addExpenseOn(page, { amount: '90', note: 'Masala chai', category: 'Food & dining' });
    await addExpenseOn(page, { amount: '450', note: 'Bus pass', category: 'Transport' });
    await addExpenseOn(page, {
      amount: '120',
      note: 'Filter chai again',
      category: 'Food & dining',
      date: daysAgo(70),
    });

    await page.getByRole('link', { name: 'Search expenses' }).click();
    await expect(page.getByText('Type something above')).toBeVisible();

    // Words reach back across months.
    await page.getByLabel('Search expenses').fill('chai');
    await expect(page.getByTestId('search-summary')).toContainText('2 expenses · ₹210');
    await expect(page.getByRole('link', { name: /Masala chai/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Filter chai again/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Bus pass/ })).toBeHidden();

    // An amount range narrows it.
    await page.getByLabel('At least (₹)').fill('100');
    await expect(page.getByTestId('search-summary')).toContainText('1 expense · ₹120');

    // Clearing starts over; a category alone is a search too.
    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.getByLabel('Category').click();
    await page.getByRole('option', { name: 'Transport' }).click();
    await expect(page.getByTestId('search-summary')).toContainText('1 expense · ₹450');

    // Nothing matching says so.
    await page.getByLabel('Search expenses').fill('zebra');
    await expect(page.getByTestId('search-empty')).toBeVisible();
  });

  test('opens an expense found by search and returns to the search', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('search-open'));
    await page.goto('/');
    await addExpenseOn(page, { amount: '75', note: 'Parking' });

    await page.goto('/search');
    await page.getByLabel('Search expenses').fill('parking');
    await page.getByRole('link', { name: /Parking/ }).click();
    await expect(page.getByLabel('Amount')).toHaveValue('75');
    await page.getByLabel('Amount').fill('80');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/\/search$/);
  });
});
