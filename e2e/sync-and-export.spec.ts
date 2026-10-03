import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import {
  addExpenseOn,
  devSignIn,
  groupWithPlaceholder,
  newPerson,
  openGroupExpenseForm,
  submitButton,
  uniqueEmail,
  waitForSynced,
} from './helpers';

const PUSH = '**/api/sync/push';

/** The server answers every push by refusing every change in it, as if the person had been removed. */
async function refuseEveryPush(page: Page) {
  await page.route(PUSH, async (route) => {
    const { mutations } = route.request().postDataJSON() as { mutations: { mutationId: string }[] };
    await route.fulfill({
      json: {
        results: mutations.map((m) => ({
          mutationId: m.mutationId,
          status: 'rejected',
          reason: 'not_a_member',
        })),
      },
    });
  });
}

test.describe('when the server does not cooperate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('sync-trouble'));
    await page.goto('/');
    await waitForSynced(page);
  });

  test('a failing server keeps the change on the device, and it goes through once the server answers', async ({
    page,
  }) => {
    await page.route(PUSH, (route) =>
      route.fulfill({ status: 500, json: { error: 'internal_error' } }),
    );
    await addExpenseOn(page, { amount: '180', note: 'Server is down' });

    await expect(
      page.getByRole('status').filter({ hasText: 'Sync problem · 1 waiting' }),
    ).toBeVisible();
    const row = page.getByRole('link', { name: /Server is down/ });
    await expect(row).toContainText('Not synced yet');

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(
      page.getByText('The server couldn’t be reached properly. Trying again shortly.'),
    ).toBeVisible();
    await expect(page.getByText('1 change waiting to be sent.')).toBeVisible();

    // The server comes back; the person presses "Sync now".
    await page.unroute(PUSH);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await waitForSynced(page);
    await expect(page.getByText(/Last synced at/)).toBeVisible();
    await expect(page.getByText(/waiting to be sent/)).toHaveCount(0);

    await page.getByRole('link', { name: 'Expenses', exact: true }).click();
    await expect(page.getByRole('link', { name: /Server is down/ })).not.toContainText(
      'Not synced yet',
    );
  });

  test('a dropped connection shows as offline with the change waiting, and recovers', async ({
    page,
  }) => {
    await page.route(PUSH, (route) => route.abort('connectionreset'));
    await addExpenseOn(page, { amount: '55', note: 'Signal gone' });
    await expect(page.getByRole('status').filter({ hasText: 'Offline · 1 waiting' })).toBeVisible();

    await page.unroute(PUSH);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitForSynced(page);
    await expect(page.getByRole('link', { name: /Signal gone/ })).not.toContainText(
      'Not synced yet',
    );
  });

  test('a change the server refuses is undone on this device, and explained in Settings', async ({
    page,
  }) => {
    await refuseEveryPush(page);
    await addExpenseOn(page, { amount: '999', note: 'Not allowed' });

    await expect(
      page.getByText(
        '1 change couldn’t be saved to the server and was undone on this device. See Settings.',
      ),
    ).toBeVisible();
    // What the server will not hold is not left showing.
    await expect(page.getByRole('link', { name: /Not allowed/ })).toHaveCount(0);
    await expect(page.getByTestId('month-total')).toContainText('₹0');

    await page.getByRole('link', { name: 'Settings' }).click();
    const panel = page.getByText('Changes the server didn’t accept');
    await expect(panel).toBeVisible();
    await expect(page.getByText(/you’re no longer in that group/)).toBeVisible();

    // (The install note has a Dismiss button too.)
    const card = page.locator('[data-slot="card"]').filter({ has: panel });
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Changes the server didn’t accept')).toHaveCount(0);
  });

  test('the explanation reads properly: "Saving an expense"', async ({ page }) => {
    await refuseEveryPush(page);
    await addExpenseOn(page, { amount: '10', note: 'Wording check' });
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByText(/Saving an expense:/)).toBeVisible();
  });
});

test.describe('two devices of one person', () => {
  test('when both change the same expense, the later sync keeps its version and says so', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('conflict');
    await page.goto('/login');
    await devSignIn(page, email, 'Dev One');
    await page.goto('/');
    await addExpenseOn(page, { amount: '100', note: 'Contested' });
    await waitForSynced(page);

    const other = await newPerson(browser, email, 'Dev One');
    await other.page.goto('/');
    await expect(other.page.getByRole('link', { name: /Contested/ })).toBeVisible();
    await waitForSynced(other.page);

    // The second device edits with no connection...
    await other.context.setOffline(true);
    await other.page.getByRole('link', { name: /Contested/ }).click();
    await other.page.getByLabel('Amount').fill('300');
    await submitButton(other.page, 'Save changes').click();
    await expect(other.page.getByTestId('month-total')).toContainText('₹300');

    // ...while the first edits and sends its own version.
    await page.getByRole('link', { name: /Contested/ }).click();
    await page.getByLabel('Amount').fill('200');
    await submitButton(page, 'Save changes').click();
    // The server has it. (The status chip can still say "Synced" for a moment after the save.)
    await expect
      .poll(async () => {
        const pulled = await (await page.request.get('/api/sync/pull')).json();
        return pulled.expenses.find((e: { note: string }) => e.note === 'Contested')?.amountMinor;
      })
      .toBe(20_000);

    await other.context.setOffline(false);
    await other.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(
      other.page.getByText(
        'Someone else also changed an expense you edited. Your version was kept.',
      ),
    ).toBeVisible();
    await waitForSynced(other.page);

    // The edit that reached the server last wins everywhere.
    await expect(other.page.getByTestId('month-total')).toContainText('₹300');
    await page.reload();
    await expect(page.getByTestId('month-total')).toContainText('₹300');
    await other.context.close();
  });
});

test.describe('exporting', () => {
  async function download(page: Page, button: 'CSV' | 'JSON'): Promise<string> {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const file = await pending;
    const path = await file.path();
    return readFile(path, 'utf8');
  }

  test('with nothing recorded, the CSV is only its header line', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('export-empty'));
    await page.goto('/settings');
    expect(await download(page, 'CSV')).toBe(
      'Date,Group,Category,Note,Total (INR),Your share (INR),Paid by,Added by',
    );
  });

  test('the CSV quotes commas and quotes, defuses formulas, and shows your share of a shared expense', async ({
    page,
  }) => {
    await groupWithPlaceholder(page, 'Export trip');
    await openGroupExpenseForm(page);
    await page.getByLabel('Amount', { exact: true }).fill('900');
    await page.getByLabel('Note (optional)').fill('Hotel, "deluxe"');
    await submitButton(page).click();
    await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();

    await page.goto('/');
    await addExpenseOn(page, { amount: '40', note: '+91 taxi' });
    await addExpenseOn(page, { amount: '41', note: '-refund?' });
    await addExpenseOn(page, { amount: '42', note: '@home' });

    await page.goto('/settings');
    const csv = await download(page, 'CSV');
    const lines = csv.split('\r\n');

    // Split with Sam: ₹900 total, Alice's share ₹450, Alice paid.
    const hotel = lines.find((line) => line.includes('Export trip'));
    expect(hotel).toMatch(
      /^\d{4}-\d{2}-\d{2},Export trip,,"Hotel, ""deluxe""",900\.00,450\.00,Alice,Alice$/,
    );

    // A cell a spreadsheet would run as a formula gets an apostrophe in front.
    for (const note of ["'+91 taxi", "'-refund?", "'@home"]) {
      expect(
        lines.some((line) => line.includes(`,Personal,,${note},`)),
        note,
      ).toBe(true);
    }
    expect(csv).not.toMatch(/,Personal,,[+\-@]/);
  });

  test('the JSON holds everything on the device, and nothing that was deleted is hidden from it', async ({
    page,
  }) => {
    const email = uniqueEmail('export-json');
    await page.goto('/login');
    await devSignIn(page, email, 'Json Person');
    await page.goto('/');
    await addExpenseOn(page, { amount: '75', note: 'Kept' });
    await addExpenseOn(page, { amount: '35', note: 'Deleted again' });
    await page.getByRole('link', { name: /Deleted again/ }).click();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    // Not just "no such link": that is also true while still on the edit form.
    await expect(page.getByText('Expense deleted')).toBeVisible();
    await expect(page.getByRole('link', { name: /Deleted again/ })).toHaveCount(0);

    await page.goto('/settings');
    const bundle = JSON.parse(await download(page, 'JSON'));
    expect(Object.keys(bundle).sort()).toEqual(
      [
        'budgets',
        'categories',
        'exportedAt',
        'expenses',
        'groups',
        'members',
        'recurring',
        'settlements',
        'user',
      ].sort(),
    );
    expect(bundle.user).toMatchObject({ email, name: 'Json Person' });
    expect(Number.isNaN(Date.parse(bundle.exportedAt))).toBe(false);
    expect(bundle.categories).toHaveLength(10);
    expect(bundle.groups.filter((g: { isPersonal: boolean }) => g.isPersonal)).toHaveLength(1);

    const notes = bundle.expenses.map((e: { note: string }) => e.note).sort();
    expect(notes).toEqual(['Deleted again', 'Kept']);
    const deleted = bundle.expenses.find((e: { note: string }) => e.note === 'Deleted again');
    expect(deleted.deletedAt).not.toBeNull();

    // The CSV lists only what is still there.
    const csv = await download(page, 'CSV');
    expect(csv).toContain('Kept');
    expect(csv).not.toContain('Deleted again');
  });
});
