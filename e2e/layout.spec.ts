import { expect, type Page, test } from '@playwright/test';
import {
  addExpenseOn,
  addPlaceholderMember,
  createGroup,
  createInviteLink,
  devSignIn,
  groupOfTwo,
  ORIGIN,
  openGroupExpenseForm,
  openGroupTab,
  startRuleLater,
  uniqueEmail,
} from './helpers';

// Nothing a person types, and nothing the server sends, may push a screen sideways. On a phone the
// browser quietly widens the page to fit whatever overflows, so "no horizontal scroll" is measured
// against the width the screen really has (`width` below), not `window.innerWidth`.

const NARROW = { width: 360, height: 800 };
/** A group name at the limit (60 characters) with no spaces to wrap at, such as a pasted link. */
const LONG_GROUP = 'G'.repeat(60);
/** What a deployed build reports as its version: the commit it was built from (see ci.yml). */
const COMMIT = '456a78104d18887ca25906b94e71cdf79d103eee';

/** How many pixels wider than the screen the page is; 0 or less means nothing spills sideways. */
const sidewaysOverflow = (page: Page, width: number) =>
  page.evaluate((w) => document.documentElement.scrollWidth - w, width);

/** How far the title of the open dialog reaches past the dialog's own right edge. */
const titleSpill = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
    const title = dialog?.querySelector('h2');
    if (!dialog || !title) return Number.NaN;
    return Math.round(title.getBoundingClientRect().right - dialog.getBoundingClientRect().right);
  });

test.describe('the version on the Settings screen', () => {
  test('a full commit id is cut short with an ellipsis, inside its card, on any phone', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('version'));
    await page.route('**/api/healthz', (route) =>
      route.fulfill({
        json: { status: 'ok', db: 'ok', version: COMMIT, time: new Date().toISOString() },
      }),
    );

    for (const width of [412, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/settings');
      const version = page.getByText(/^version /);
      await expect(version, `${width}px`).toBeVisible();
      const card = page.locator('[data-slot="card"]').filter({ has: version });

      const [versionBox, cardBox] = await Promise.all([version.boundingBox(), card.boundingBox()]);
      expect(versionBox, `${width}px`).not.toBeNull();
      expect(cardBox, `${width}px`).not.toBeNull();
      expect(
        (versionBox?.x ?? 0) + (versionBox?.width ?? 0),
        `${width}px: inside the card`,
      ).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0) + 0.5);
      expect(
        await sidewaysOverflow(page, width),
        `${width}px: page scrolls sideways`,
      ).toBeLessThanOrEqual(0);
      expect(
        await version.evaluate((el) => getComputedStyle(el).textOverflow),
        `${width}px: ellipsis`,
      ).toBe('ellipsis');
    }
  });

  test('a short version still shows in full', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('version-short'));
    await page.goto('/settings');
    await expect(page.getByText('version dev')).toBeVisible();
  });
});

test.describe('long names on a narrow phone', () => {
  test.use({ viewport: NARROW });

  test('a long name, note, category and email stay inside the screen on the main screens', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = `${'e'.repeat(50)}${Date.now().toString(36)}@example.com`;
    await page.goto('/login');
    await devSignIn(page, email, 'N'.repeat(60));

    const fits = async (where: string) =>
      expect(await sidewaysOverflow(page, NARROW.width), where).toBeLessThanOrEqual(0);

    await page.goto('/settings');
    await expect(page.getByText(email)).toBeVisible();
    await fits('settings, long name and email');

    await page.goto('/');
    await addExpenseOn(page, { amount: '10', note: 'W'.repeat(200), category: 'Food & dining' });
    await expect(page.getByRole('link', { name: /WWWW/ })).toBeVisible();
    await fits('expenses, long note');

    await page.goto('/settings/recurring/new');
    await page.getByLabel('Amount').fill('5');
    await page.getByLabel('What is it?').fill('R'.repeat(200));
    await startRuleLater(page);
    await page.getByRole('button', { name: 'Add recurring expense' }).click();
    await expect(page.getByTestId('recurring-list')).toBeVisible();
    await fits('recurring, long note');

    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('C'.repeat(40));
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('C'.repeat(40))).toBeVisible();
    await fits('categories, long name');

    await page.goto('/search');
    await page.getByLabel('Search expenses').fill('WWWW');
    await expect(page.getByTestId('search-summary')).toBeVisible();
    await fits('search, long note');

    await page.goto('/insights');
    await expect(page.getByTestId('insights-total')).toBeVisible();
    await fits('insights');

    await createGroup(page, LONG_GROUP);
    await fits('group page, long name');
    await addPlaceholderMember(page, 'P'.repeat(100));
    await fits('members, long names');
    await openGroupTab(page, 'Balances');
    await fits('balances, long names');
    await openGroupTab(page, 'Activity');
    await fits('activity');
    await page.goto('/groups');
    await expect(page.getByRole('link', { name: /GGGG/ })).toBeVisible();
    await fits('groups list, long name');

    const csv = ['Date,Description,Amount', `01/01/2026,${'D'.repeat(200)},-10.00`].join('\n');
    await page.goto('/settings/import');
    await page.getByTestId('statement-file').setInputFiles({
      name: `long-${'f'.repeat(80)}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByTestId('import-rows')).toBeVisible();
    await fits('import preview, long narration and file name');
  });

  test('the add-expense header keeps a long group name inside the screen', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('long-form'));
    await createGroup(page, LONG_GROUP);
    await openGroupExpenseForm(page);
    expect(await sidewaysOverflow(page, NARROW.width)).toBeLessThanOrEqual(0);
  });

  test('the category chips on the expense forms keep a long category name inside the screen', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('long-category'));
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('C'.repeat(40));
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('C'.repeat(40))).toBeVisible();

    for (const path of ['/add', '/settings/recurring/new']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'C'.repeat(40) })).toBeVisible();
      expect(await sidewaysOverflow(page, NARROW.width), path).toBeLessThanOrEqual(0);
    }
  });

  test('the join page keeps a long group name inside the screen', async ({ page, browser }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('long-join'), 'Alice');
    await createGroup(page, LONG_GROUP);
    const link = await createInviteLink(page);

    const phone = await browser.newContext({
      baseURL: ORIGIN,
      viewport: NARROW,
      isMobile: true,
      hasTouch: true,
    });
    const guest = await phone.newPage();
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByText(/invited you to/)).toBeVisible();
    expect(await sidewaysOverflow(guest, NARROW.width)).toBeLessThanOrEqual(0);
    await phone.close();
  });

  test('the invite, delete and leave dialogs keep a long group name inside the dialog', async ({
    page,
    browser,
  }) => {
    const { bob } = await groupOfTwo(page, browser, LONG_GROUP);
    await openGroupTab(page, 'Members');

    await page.getByRole('button', { name: 'Invite people' }).click();
    await expect(page.getByLabel('Invite link')).toBeVisible();
    expect(await titleSpill(page), 'invite dialog').toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Delete group' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await titleSpill(page), 'delete dialog').toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');

    await openGroupTab(bob.page, 'Members');
    await bob.page.getByRole('button', { name: 'Leave group' }).click();
    await expect(bob.page.getByRole('alertdialog')).toBeVisible();
    expect(await titleSpill(bob.page), 'leave dialog').toBeLessThanOrEqual(0);
    await bob.context.close();
  });
});
