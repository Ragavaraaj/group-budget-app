import { expect, test } from '@playwright/test';
import {
  addExpenseOn,
  daysAgo,
  devSignIn,
  pickDate,
  runScheduledJob,
  uniqueEmail,
  waitForSynced,
} from './helpers';

test.describe('budgets', () => {
  test('warns at 80% and again when the limit is passed, and counts the whole month', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('budget'));
    await page.goto('/budgets');
    await expect(page.getByText('No budgets yet')).toBeVisible();

    // A limit for Food & dining.
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('For').click();
    await page.getByRole('option', { name: 'Food & dining' }).click();
    await page.getByLabel('Monthly limit').fill('1000');
    await page.getByRole('button', { name: 'Save' }).click();
    const bar = page.getByTestId('budget-bar');
    await expect(bar).toHaveAttribute('data-level', 'ok');
    await expect(bar).toContainText('₹1,000 left');

    // ₹850 is 85%: a warning on the Expenses screen.
    await page.goto('/');
    await addExpenseOn(page, { amount: '850', note: 'Dinner', category: 'Food & dining' });
    await expect(page.getByTestId('budget-alerts')).toContainText(
      'Food & dining is at 85% of its budget',
    );

    // ₹200 more takes it past the limit.
    await addExpenseOn(page, { amount: '200', note: 'Snacks', category: 'Food & dining' });
    await expect(page.getByTestId('budget-alerts')).toContainText('over its budget');

    // The budget screen says by how much, and the warning follows the tap.
    await page.getByTestId('budget-alerts').click();
    await expect(page).toHaveURL(/\/budgets/);
    await expect(page.getByTestId('budget-bar')).toHaveAttribute('data-level', 'over');
    await expect(page.getByTestId('budget-bar')).toContainText('Over by ₹50');
  });

  test('can be changed and removed, with undo', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('budget-edit'));
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('Monthly limit').fill('5000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('of ₹5,000');

    await page.getByRole('button', { name: 'Edit Everything budget' }).click();
    await page.getByLabel('Monthly limit').fill('7500');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('of ₹7,500');

    await page.getByRole('button', { name: 'Remove Everything budget' }).click();
    await expect(page.getByText('No budgets yet')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('budget-bar')).toContainText('of ₹7,500');
  });

  test('stops offering Add once everything has a budget, and says so', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('budget-full'));
    await page.goto('/budgets');

    // A new budget goes to the first thing that has none: Everything, then each category in turn.
    const add = page.getByRole('button', { name: 'Add' });
    const bars = page.getByTestId('budget-bar');
    let made = 0;
    while ((await add.isEnabled()) && made < 30) {
      await add.click();
      await page.getByLabel('Monthly limit').fill('1000');
      await page.getByRole('button', { name: 'Save' }).click();
      made++;
      await expect(bars).toHaveCount(made);
    }
    expect(made).toBeGreaterThan(2);

    // Nothing is left to pick, so a second budget for the same thing can't be made, and the page
    // says why the button is off (a greyed-out button can't be hovered for a reason on a phone).
    await expect(add).toBeDisabled();
    await expect(page.getByTestId('budgets-all-set')).toContainText('Everything has a budget');
    await expect(bars).toHaveCount(made);

    // Removing one brings the button back.
    await page.getByRole('button', { name: 'Remove Everything budget' }).click();
    await expect(add).toBeEnabled();
    await expect(page.getByTestId('budgets-all-set')).toBeHidden();
  });

  test('shows up on a second device', async ({ page, browser }) => {
    const email = uniqueEmail('budget-sync');
    await page.goto('/login');
    await devSignIn(page, email);
    await page.goto('/budgets');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('Monthly limit').fill('3000');
    await page.getByRole('button', { name: 'Save' }).click();
    await waitForSynced(page);

    const other = await browser.newContext({ baseURL: 'http://localhost:8787' });
    const second = await other.newPage();
    await second.goto('/login');
    await devSignIn(second, email);
    await second.goto('/budgets');
    await expect(second.getByTestId('budget-bar')).toContainText('of ₹3,000');
    await other.close();
  });
});

test.describe('recurring expenses', () => {
  test('creates the expense on the day, once, and shows it on every device', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('recurring');
    await page.goto('/login');
    await devSignIn(page, email);
    await page.goto('/settings/recurring');
    await expect(page.getByText('Nothing repeats yet')).toBeVisible();

    await page.getByRole('link', { name: 'Add' }).click();
    await page.getByLabel('Amount').fill('15000');
    await page.getByLabel('What is it?').fill('Flat rent');
    await page.getByRole('button', { name: 'Rent & home' }).click();
    await expect(page.getByTestId('schedule-summary')).toContainText('Every month on the');
    await page.getByRole('button', { name: 'Add recurring expense' }).click();

    const list = page.getByTestId('recurring-list');
    await expect(list).toContainText('Flat rent');
    await expect(list).toContainText('₹15,000');
    await waitForSynced(page);

    // The scheduled job runs (here by hand; on Cloudflare, hourly) and makes today's expense.
    await runScheduledJob(page);
    // Opening the app syncs, which brings the new expense in.
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Flat rent/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('month-total')).toContainText('₹15,000');

    // Running it again changes nothing.
    await runScheduledJob(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sync now' }).click();
    await waitForSynced(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Flat rent/ })).toHaveCount(1);
    await expect(page.getByTestId('month-total')).toContainText('₹15,000');

    // A second device gets the same expense through the normal sync.
    const other = await browser.newContext({ baseURL: 'http://localhost:8787' });
    const second = await other.newPage();
    await second.goto('/login');
    await devSignIn(second, email);
    await second.goto('/');
    await expect(second.getByRole('link', { name: /Flat rent/ })).toBeVisible({ timeout: 15_000 });
    await other.close();
  });

  test('can start in the past, and fills in what it missed', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('recurring-past'));
    await page.goto('/settings/recurring/new');
    await page.getByLabel('Amount').fill('250');
    await page.getByLabel('What is it?').fill('Weekly help');
    await page.getByRole('radio', { name: 'Weekly' }).click();
    await pickDate(page, 'First on', daysAgo(14));
    await expect(page.getByText(/already passed are added too/)).toBeVisible();

    // The form does not hold back a date the hint says is fine.
    await page.getByRole('button', { name: 'Add recurring expense' }).click();
    await expect(page.getByTestId('recurring-list')).toContainText('Weekly help');
    await waitForSynced(page);

    await runScheduledJob(page);
    await page.goto('/');
    // Today's occurrence is always in this month, however the last two fall.
    await expect(page.getByRole('link', { name: /Weekly help/ }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('can be paused and deleted, and a paused rule makes nothing', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('recurring-pause'));
    await page.goto('/settings/recurring/new');
    await page.getByLabel('Amount').fill('499');
    await page.getByLabel('What is it?').fill('Streaming');
    await page.getByRole('button', { name: 'Add recurring expense' }).click();
    await waitForSynced(page);

    // Pause it before the job runs.
    await page.getByRole('switch', { name: /Streaming is on/ }).click();
    await expect(page.getByRole('switch', { name: /Streaming is paused/ })).toBeVisible();
    await expect(page.getByTestId('recurring-list')).toContainText('Paused');
    await waitForSynced(page);

    await runScheduledJob(page);
    await page.goto('/');
    await expect(page.getByText(/No expenses in/)).toBeVisible();

    // Delete it, with undo.
    await page.goto('/settings/recurring');
    await page.getByRole('link', { name: /Streaming/ }).click();
    await page.getByRole('button', { name: 'Delete recurring expense' }).click();
    await expect(page.getByText('Nothing repeats yet')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('recurring-list')).toContainText('Streaming');
  });
});

test.describe('months', () => {
  test('a month can start on another day, which changes the period shown', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('month-start'));
    await page.goto('/');
    await expect(page.getByText(/^[A-Z][a-z]+ \d{4}$/).first()).toBeVisible();

    await page.goto('/settings');
    await page.getByLabel('A month starts on day').selectOption('25');
    // The select shows what is stored, so once it says 25 the setting has been written.
    await expect(page.getByLabel('A month starts on day')).toHaveValue('25');
    await page.goto('/');
    // "25 Sep – 24 Oct 2026": a range rather than a calendar month.
    await expect(
      page.getByText(/^\d{1,2} [A-Z][a-z]{2,4} – \d{1,2} [A-Z][a-z]{2,4} \d{4}$/).first(),
    ).toBeVisible();
  });
});
