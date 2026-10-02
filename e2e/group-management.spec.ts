import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  addPlaceholderMember,
  createGroup,
  createInviteLink,
  devSignIn,
  groupWithPlaceholder,
  joinViaLink,
  missingId,
  newPerson,
  openGroupExpenseForm,
  openGroupTab,
  submitButton,
  uniqueEmail,
  waitForSynced,
} from './helpers';

/** Alice (on `page`) owns a new group that Bob has joined; her device already knows about him. */
async function groupOfTwo(page: Page, browser: Browser, name: string) {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, name);
  const link = await createInviteLink(page);
  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await joinViaLink(bob.page, link);
  await expect(bob.page.getByRole('heading', { name })).toBeVisible();
  await page.reload();
  return { bob, link };
}

async function addDinner(page: Page, amount: string, note: string) {
  await openGroupTab(page, 'Expenses');
  await openGroupExpenseForm(page);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('Note (optional)').fill(note);
  await submitButton(page).click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();
}

test.describe('creating a group', () => {
  test('needs a name, and keeps it to 60 characters', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('new-group'));
    await page.goto('/groups');
    await page.getByRole('button', { name: 'New' }).click();

    const dialog = page.getByRole('dialog');
    const create = dialog.getByRole('button', { name: 'Create group' });
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Group name').fill('   ');
    await expect(create).toBeDisabled();

    await dialog.getByLabel('Group name').fill('g'.repeat(80));
    await expect(dialog.getByLabel('Group name')).toHaveValue('g'.repeat(60));
    await expect(create).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('No groups yet')).toBeVisible();
  });

  test('with no connection it says so, and works once the connection is back', async ({
    page,
    context,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('offline-group'));
    await page.goto('/groups');
    await expect(page.getByText('No groups yet')).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: 'New' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Group name').fill('Needs a signal');
    await dialog.getByRole('button', { name: 'Create group' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('You’re offline. This needs a connection.');
    await expect(dialog).toBeVisible(); // what was typed is still there

    await context.setOffline(false);
    await dialog.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByRole('heading', { name: 'Needs a signal' })).toBeVisible();
  });
});

test.describe('who can do what in a group', () => {
  test('the owner can rename it; a member sees the new name but cannot rename', async ({
    page,
    browser,
  }) => {
    const { bob } = await groupOfTwo(page, browser, 'Old name');

    await page.getByRole('button', { name: 'Rename group' }).click();
    const dialog = page.getByRole('dialog');
    const save = dialog.getByRole('button', { name: 'Save' });
    await dialog.getByLabel('Group name').fill('');
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Group name').fill('   ');
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Group name').fill('x'.repeat(80));
    await expect(dialog.getByLabel('Group name')).toHaveValue('x'.repeat(60));

    await dialog.getByLabel('Group name').fill('New name');
    await save.click();
    await expect(page.getByText('Group renamed')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New name' })).toBeVisible();

    await bob.page.reload();
    await expect(bob.page.getByRole('heading', { name: 'New name' })).toBeVisible();
    await expect(bob.page.getByRole('button', { name: 'Rename group' })).toHaveCount(0);
    await bob.context.close();
  });

  test('a member has none of the owner’s controls', async ({ page, browser }) => {
    const { bob } = await groupOfTwo(page, browser, 'Members only');
    await openGroupTab(bob.page, 'Members');

    const list = bob.page.getByTestId('members-list');
    await expect(list.getByRole('listitem').filter({ hasText: 'Alice' })).toContainText('Owner');
    for (const owner of [
      'Invite people',
      'Stop all links',
      'Add someone without the app',
      'Delete group',
      'Make Alice the owner',
      'Remove Alice',
    ]) {
      await expect(bob.page.getByRole('button', { name: owner }), owner).toHaveCount(0);
    }
    await expect(bob.page.getByTestId('open-links')).toHaveCount(0);
    await expect(bob.page.getByRole('button', { name: 'Leave group' })).toBeVisible();
    await bob.context.close();
  });

  test('deleting asks for the exact name; a wrong name or Cancel keeps the group', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('delete-guard'));
    await createGroup(page, 'Keep me');
    await openGroupTab(page, 'Members');

    await page.getByRole('button', { name: 'Delete group' }).click();
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: 'Delete group' });
    for (const wrong of ['Keep', 'keep me', 'Keep me too', '']) {
      await dialog.getByLabel('Type the group’s name to confirm').fill(wrong);
      await expect(confirm, `"${wrong}"`).toBeDisabled();
    }

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Keep me' })).toBeVisible();

    // Reopening starts from an empty box, not from what was typed before.
    await page.getByRole('button', { name: 'Delete group' }).click();
    await expect(page.getByLabel('Type the group’s name to confirm')).toHaveValue('');
  });

  test('someone without the app needs a name', async ({ page }) => {
    await groupWithPlaceholder(page, 'Names needed');
    await openGroupTab(page, 'Members');
    await page.getByRole('button', { name: 'Add someone without the app' }).click();

    const dialog = page.getByRole('dialog');
    const add = dialog.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeDisabled();
    await dialog.getByLabel('Name').fill('    ');
    await expect(add).toBeDisabled();
    await dialog.getByLabel('Name').fill('n'.repeat(150));
    await expect(dialog.getByLabel('Name')).toHaveValue('n'.repeat(100));

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Only Alice and Sam (added by the setup) are in the group.
    await expect(page.getByTestId('members-list').getByRole('listitem')).toHaveCount(2);
  });
});

test.describe('settling up', () => {
  test.beforeEach(async ({ page }) => {
    await groupWithPlaceholder(page, 'Settle rules');
    await addDinner(page, '900', 'Hotel'); // Sam owes Alice ₹450
    await openGroupTab(page, 'Balances');
    await expect(page.getByTestId('balance-Sam')).toHaveText('owes ₹450');
  });

  test('refuses an amount that is missing, zero or unreadable, and the same person on both sides', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Record a payment' }).click();
    const dialog = page.getByRole('dialog');
    const record = dialog.getByRole('button', { name: 'Record payment' });

    for (const bad of ['', '0', '0.00', '-50', 'fifty', '1.234']) {
      await dialog.getByLabel('Amount').fill(bad);
      await expect(record, `"${bad}"`).toBeDisabled();
    }

    await dialog.getByLabel('Amount').fill('50');
    await expect(record).toBeEnabled();

    // Paying yourself is not a payment.
    await dialog.getByLabel('Paid to').click();
    await page.getByRole('option', { name: 'Alice' }).click();
    await expect(record).toBeDisabled();
    await dialog.getByLabel('Paid to').click();
    await page.getByRole('option', { name: 'Sam' }).click();
    await expect(record).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Payments made')).toHaveCount(0);
    await expect(page.getByTestId('balance-Sam')).toHaveText('owes ₹450');
  });

  test('a part payment leaves the rest owing, and paying too much turns the debt around', async ({
    page,
  }) => {
    // Sam pays ₹100 of the ₹450.
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Amount').fill('100');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByTestId('balance-Sam')).toHaveText('owes ₹350');
    await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹350');

    // Then ₹500: ₹150 more than was left, so now Alice owes Sam ₹150.
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Amount').fill('500');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByTestId('balance-Sam')).toHaveText('is owed ₹150');
    await expect(page.getByTestId('my-balance')).toHaveText('You owe ₹150');
  });

  test('a deleted payment can be undone, and the balances follow', async ({ page }) => {
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByTestId('my-balance')).toHaveText('All settled up');
    await expect(page.getByText('Payments made')).toBeVisible();

    await page.getByRole('button', { name: 'Delete payment' }).click();
    await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹450');
    await expect(page.getByText('Payments made')).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('my-balance')).toHaveText('All settled up');
    await expect(page.getByText('Payments made')).toBeVisible();
  });
});

test.describe('other people’s changes', () => {
  test('a member can edit and delete someone else’s expense, and Activity says who', async ({
    page,
    browser,
  }) => {
    const { bob } = await groupOfTwo(page, browser, 'Shared edits');
    await addDinner(page, '900', 'Dinner');
    await waitForSynced(page);

    // Bob changes it.
    await bob.page.reload();
    await openGroupTab(bob.page, 'Expenses');
    await bob.page.getByRole('link', { name: /Dinner/ }).click();
    await bob.page.getByLabel('Amount', { exact: true }).fill('1000');
    await submitButton(bob.page, 'Save changes').click();
    await expect(bob.page.getByTestId('group-month-total')).toContainText('₹1,000');
    await waitForSynced(bob.page);

    await page.reload();
    await openGroupTab(page, 'Activity');
    await expect(page.getByText('Bob edited “Dinner”')).toBeVisible();
    await openGroupTab(page, 'Expenses');
    await expect(page.getByTestId('group-month-total')).toContainText('₹1,000');

    // Bob deletes it.
    await bob.page.getByRole('link', { name: /Dinner/ }).click();
    await bob.page.getByRole('button', { name: 'Delete expense' }).click();
    await expect(bob.page.getByText(/No expenses in/)).toBeVisible();
    await waitForSynced(bob.page);

    await page.reload();
    await openGroupTab(page, 'Activity');
    await expect(page.getByText('Bob deleted “Dinner”')).toBeVisible();
    await openGroupTab(page, 'Expenses');
    await expect(page.getByText(/No expenses in/)).toBeVisible();

    // And Bob changes his mind.
    await bob.page.getByRole('button', { name: 'Undo' }).click();
    await waitForSynced(bob.page);
    await page.reload();
    await expect(page.getByRole('link', { name: /Dinner/ })).toBeVisible();
    await bob.context.close();
  });

  test('someone who left stays in the balances, can be picked on old expenses only, and is not offered new ones', async ({
    page,
    browser,
  }) => {
    const { bob } = await groupOfTwo(page, browser, 'Leavers');
    await addDinner(page, '600', 'Lunch'); // Bob owes ₹300

    await openGroupTab(page, 'Members');
    await page.getByRole('button', { name: 'Remove Bob' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Bob was removed')).toBeVisible();
    await expect(
      page.getByText('No longer in the group. Their past expenses stay in the balances.'),
    ).toBeVisible();

    // His share is still counted.
    await openGroupTab(page, 'Balances');
    await expect(page.getByTestId('balance-Bob')).toHaveText('owes ₹300');
    await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹300');

    // A new expense does not offer him.
    await openGroupTab(page, 'Expenses');
    await openGroupExpenseForm(page);
    await expect(page.getByRole('checkbox', { name: /Alice/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Bob/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back' }).click();

    // The old one still shows him, marked as having left.
    await page.getByRole('link', { name: /Lunch/ }).click();
    await expect(page.getByRole('checkbox', { name: /Bob \(left\)/ })).toBeVisible();
    await bob.context.close();
  });
});

test.describe('the join page', () => {
  test('tells the person why joining did not work, and lets them try again', async ({
    page,
    browser,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('alice'), 'Alice');
    await createGroup(page, 'Join errors');
    const link = await createInviteLink(page);

    const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
    await bob.page.goto(new URL(link).pathname);
    await expect(bob.page.getByText(/invited you to/)).toBeVisible();
    const join = bob.page.getByRole('button', { name: 'Join group' });
    const alert = bob.page.getByRole('alert');

    const refusals = [
      { status: 409, error: 'group_full', text: 'This group is full.' },
      { status: 409, error: 'too_many_groups', text: 'You’re in the maximum number of groups.' },
      {
        status: 403,
        error: 'removed',
        text: 'The group owner removed you from this group. Ask them to add you back.',
      },
      {
        status: 404,
        error: 'invite_invalid',
        text: 'This invite has expired or been used up. Ask for a new one.',
      },
      { status: 500, error: 'internal_error', text: 'Couldn’t join the group. Please try again.' },
    ];
    for (const { status, error, text } of refusals) {
      await bob.page.route('**/api/invites/accept', (route) =>
        route.fulfill({ status, json: { error } }),
      );
      await join.click();
      await expect(alert, error).toHaveText(text);
      await expect(join, error).toBeEnabled();
      await bob.page.unroute('**/api/invites/accept');
    }

    await bob.page.route('**/api/invites/accept', (route) => route.abort());
    await join.click();
    await expect(alert).toHaveText('You seem to be offline. Connect to the internet to join.');
    await bob.page.unroute('**/api/invites/accept');

    // With the server answering again, the same button works.
    await join.click();
    await expect(bob.page.getByRole('heading', { name: 'Join errors' })).toBeVisible();
    await bob.context.close();
  });

  test('says so when the invite cannot be checked', async ({ page }) => {
    await page.route('**/api/invites/preview*', (route) => route.abort());
    await page.goto('/join/a-token-that-is-long-enough-0123456789');
    await expect(page.getByRole('alert')).toHaveText('Couldn’t check this invite. Are you online?');
    await expect(page.getByRole('button', { name: 'Join group' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Go to the app' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a token that is too short or too long is just "expired"', async ({ page }) => {
    for (const token of ['short', 'x'.repeat(200)]) {
      await page.goto(`/join/${token}`);
      await expect(page.getByText(/expired or been used up/), token.slice(0, 10)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Join group' })).toHaveCount(0);
    }
  });

  test('someone already in the group is taken to it, without using up the link', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('alice'), 'Alice');
    await createGroup(page, 'Already here');
    const groupUrl = page.url();
    const link = await createInviteLink(page);

    await page.goto(new URL(link).pathname);
    await page.getByRole('button', { name: 'Join group' }).click();
    await expect(page).toHaveURL(groupUrl);
    await expect(page.getByRole('heading', { name: 'Already here' })).toBeVisible();

    await openGroupTab(page, 'Members');
    await expect(page.getByTestId('open-links')).toContainText('Used 0 of 20');
  });
});

test.describe('addresses inside a group', () => {
  test('a group the person is not in, or that does not exist, is not found', async ({
    page,
    browser,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('alice'), 'Alice');
    await createGroup(page, 'Private');
    const groupPath = new URL(page.url()).pathname;

    await page.goto(`/groups/${missingId()}`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    const outsider = await newPerson(browser, uniqueEmail('outsider'), 'Outsider');
    await outsider.page.goto(groupPath);
    await expect(outsider.page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(outsider.page.getByRole('heading', { name: 'Private' })).toHaveCount(0);
    await outsider.context.close();
  });

  test('the tab in the address is honoured, and a made-up one falls back to Expenses', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('tabs'));
    await createGroup(page, 'Tabbed');
    const groupPath = new URL(page.url()).pathname;
    const tab = (name: string) => page.getByRole('tab', { name });

    await page.goto(`${groupPath}?tab=members`);
    await expect(tab('Members')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Invite people' })).toBeVisible();

    await page.goto(`${groupPath}?tab=balances`);
    await expect(tab('Balances')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('my-balance')).toBeVisible();

    await page.goto(`${groupPath}?tab=nonsense`);
    await expect(tab('Expenses')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('group-month-total')).toBeVisible();
  });

  test('someone without the app cannot be made the owner, but can be removed', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('alice'), 'Alice');
    await createGroup(page, 'Odd requests');
    await addPlaceholderMember(page, 'Sam');
    await expect(page.getByRole('button', { name: 'Make Sam the owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove Sam' })).toBeVisible();
  });
});
