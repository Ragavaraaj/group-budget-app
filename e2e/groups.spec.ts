import { expect, type Page, test } from '@playwright/test';
import { devSignIn, newPerson, uniqueEmail } from './helpers';

async function createGroup(page: Page, name: string) {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Group name').fill(name);
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function inviteLink(page: Page): Promise<string> {
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  const link = page.getByLabel('Invite link');
  await expect(link).toHaveValue(/\/join\//);
  const value = await link.inputValue();
  await page.keyboard.press('Escape');
  return value;
}

async function join(page: Page, link: string) {
  await page.goto(new URL(link).pathname);
  await expect(page.getByText(/invited you to/)).toBeVisible();
  await page.getByRole('button', { name: 'Join group' }).click();
}

async function openGroupTab(page: Page, tab: string) {
  await page.getByRole('tab', { name: tab }).click();
}

async function addGroupExpense(page: Page, amount: string, note: string) {
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('Note (optional)').fill(note);
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Add expense' }).click();
  // The form closes only after the expense has been written to the local database.
  await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();
}

test('two people run a trip and the balances match a hand calculation', async ({
  page,
  browser,
}) => {
  const aliceEmail = uniqueEmail('alice');
  await page.goto('/login');
  await devSignIn(page, aliceEmail, 'Alice');
  await createGroup(page, 'Goa trip');
  const link = await inviteLink(page);

  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await join(bob.page, link);
  await expect(bob.page.getByRole('heading', { name: 'Goa trip' })).toBeVisible();

  // Alice learns that Bob joined (a device picks up changes when brought to the front).
  await page.reload();
  await openGroupTab(page, 'Members');
  await expect(page.getByText('Bob')).toBeVisible();

  // Alice pays ₹900 for dinner, split equally: ₹450 each.
  await openGroupTab(page, 'Expenses');
  await addGroupExpense(page, '900', 'Dinner');
  await save(page);

  // Bob pays ₹300 for a cab, split equally: ₹150 each.
  await bob.page.reload();
  await openGroupTab(bob.page, 'Expenses');
  await addGroupExpense(bob.page, '300', 'Cab');
  await save(bob.page);

  // Alice paid 900 and owes 450 + 150 → +300. Bob paid 300 and owes 450 + 150 → −300.
  await page.reload();
  await openGroupTab(page, 'Balances');
  await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹300');
  await expect(page.getByTestId('balance-Bob')).toHaveText('owes ₹300');
  await expect(page.getByTestId('suggested-transfer')).toHaveCount(1);

  await bob.page.reload();
  await openGroupTab(bob.page, 'Balances');
  await expect(bob.page.getByTestId('my-balance')).toHaveText('You owe ₹300');

  // Bob pays Alice back and records it; both are square.
  await bob.page.getByRole('button', { name: 'Record', exact: true }).click();
  await bob.page.getByRole('button', { name: 'Record payment' }).click();
  await expect(bob.page.getByTestId('my-balance')).toHaveText('All settled up');

  await expect(bob.page.getByText('Payments made')).toBeVisible();
  await page.reload();
  await openGroupTab(page, 'Balances');
  await expect(page.getByTestId('my-balance')).toHaveText('All settled up');

  await openGroupTab(page, 'Activity');
  await expect(page.getByText(/Bob recorded a payment/)).toBeVisible();
  await expect(
    page.getByText(/Alice added “Dinner”/).or(page.getByText(/You added “Dinner”/)),
  ).toBeVisible();
  await bob.context.close();
});

test('splits by exact amounts, percentages and shares', async ({ page, browser }) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Flat');
  const link = await inviteLink(page);
  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await join(bob.page, link);
  await expect(bob.page.getByRole('heading', { name: 'Flat' })).toBeVisible();
  await page.reload();

  // Exact: ₹1,000 where Alice's share is ₹400 and Bob's ₹600 → Bob owes Alice ₹600.
  await openGroupTab(page, 'Expenses');
  await addGroupExpense(page, '1000', 'Hotel');
  await page.getByRole('radio', { name: 'Exact' }).click();
  await page.getByLabel('Amount in rupees for Alice').fill('400');
  await expect(page.getByRole('status').filter({ hasText: 'left to assign' })).toContainText(
    '₹600 left to assign',
  );
  await page.getByLabel('Amount in rupees for Bob').fill('600');
  await save(page);

  // Percent: ₹1,000 split 70/30 → Bob owes another ₹300.
  await addGroupExpense(page, '1000', 'Fuel');
  await page.getByRole('radio', { name: 'Percent' }).click();
  await page.getByLabel('Percent for Alice').fill('70');
  await page.getByLabel('Percent for Bob').fill('30');
  await save(page);

  // Shares: ₹900 split 2 : 1 → Bob owes another ₹300.
  await addGroupExpense(page, '900', 'Wine');
  await page.getByRole('radio', { name: 'Shares' }).click();
  await page.getByLabel('Shares for Alice').fill('2');
  await page.getByLabel('Shares for Bob').fill('1');
  await save(page);

  await openGroupTab(page, 'Balances');
  await expect(page.getByTestId('balance-Bob')).toHaveText('owes ₹1,200');
  await expect(page.getByTestId('my-balance')).toHaveText('You’re owed ₹1,200');
  await bob.context.close();
});

test('the owner can remove a member, whose copy of the group then disappears', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Weekend');
  const link = await inviteLink(page);
  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await join(bob.page, link);
  await expect(bob.page.getByRole('heading', { name: 'Weekend' })).toBeVisible();

  await page.reload();
  await openGroupTab(page, 'Members');
  await page.getByRole('button', { name: 'Remove Bob' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Bob was removed')).toBeVisible();

  await bob.page.goto('/groups');
  await expect(bob.page.getByText('No groups yet')).toBeVisible({ timeout: 15_000 });
  await bob.context.close();
});

test('an invite link works for someone who has not signed in yet', async ({ page, browser }) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Trip');
  const link = await inviteLink(page);

  const stranger = await browser.newContext({ baseURL: 'http://localhost:8787' });
  const tab = await stranger.newPage();
  await tab.goto(new URL(link).pathname);
  await expect(tab.getByText(/invited you to/)).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

  // Signing in from the invite page gets a brand-new person in, and back to the invite.
  await tab.getByRole('button', { name: 'Continue with Google' }).click();
  await tab.getByLabel('Email').fill(uniqueEmail('newcomer'));
  await tab.getByRole('button', { name: 'Sign in' }).click();
  await expect(tab).toHaveURL(/\/join\//);
  await expect(tab.getByRole('button', { name: 'Join group' })).toBeVisible();
  await tab.getByRole('button', { name: 'Join group' }).click();
  await expect(tab.getByRole('heading', { name: 'Trip' })).toBeVisible();
  await stranger.close();
});

test('an expired or made-up invite is refused', async ({ page }) => {
  await page.goto('/join/not-a-real-invite-token-0123456789');
  await expect(page.getByText(/expired or been used up/)).toBeVisible();
});

test('someone the owner removed cannot rejoin through a link, until the owner adds them back', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Club');
  const link = await inviteLink(page);

  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await join(bob.page, link);
  await expect(bob.page.getByRole('heading', { name: 'Club' })).toBeVisible();

  await page.reload(); // Alice's device learns that Bob joined
  await openGroupTab(page, 'Members');
  await page.getByRole('button', { name: 'Remove Bob' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Bob was removed')).toBeVisible();

  // The link he already has no longer works for him.
  await bob.page.goto(new URL(link).pathname);
  await expect(bob.page.getByText(/invited you to/)).toBeVisible();
  await bob.page.getByRole('button', { name: 'Join group' }).click();
  await expect(bob.page.getByRole('alert')).toContainText('owner removed you');

  // The owner can bring him back directly.
  await expect(page.getByRole('button', { name: 'Add back' })).toBeVisible();
  await page.getByRole('button', { name: 'Add back' }).click();
  await expect(page.getByText('Bob is back in the group')).toBeVisible();

  await bob.page.goto('/groups');
  await expect(bob.page.getByRole('link', { name: /Club/ })).toBeVisible({ timeout: 15_000 });
  await bob.context.close();
});

test('the owner can stop the invite links that are out there', async ({ page, browser }) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Private');
  const link = await inviteLink(page);

  await page.getByRole('button', { name: 'Stop links' }).click();
  await expect(page.getByText('Invite links stopped')).toBeVisible();

  const stranger = await newPerson(browser, uniqueEmail('late'), 'Late');
  await stranger.page.goto(new URL(link).pathname);
  await expect(stranger.page.getByText(/expired or been used up/)).toBeVisible();
  await stranger.context.close();
});

test('leaving a group is held back while changes in it have not been sent', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Weekend away');
  const link = await inviteLink(page);

  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await join(bob.page, link);
  await expect(bob.page.getByRole('heading', { name: 'Weekend away' })).toBeVisible();

  // Bob adds an expense with no connection, so it sits in his outbox.
  await bob.context.setOffline(true);
  await addGroupExpense(bob.page, '250', 'Tickets');
  await save(bob.page);

  await openGroupTab(bob.page, 'Members');
  await bob.page.getByRole('button', { name: 'Leave group' }).click();
  await bob.page.getByRole('alertdialog').getByRole('button', { name: 'Leave' }).click();
  await expect(bob.page.getByText(/hasn’t been sent yet/)).toBeVisible();
  await expect(bob.page.getByRole('button', { name: 'Leave group' })).toBeVisible(); // still in

  // Once it has been sent, leaving works.
  await bob.context.setOffline(false);
  await bob.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(bob.page.getByRole('status').filter({ hasText: /^Synced$/ })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Leave group' }).click();
  await bob.page.getByRole('alertdialog').getByRole('button', { name: 'Leave' }).click();
  await expect(bob.page).toHaveURL(/\/groups$/);
  await bob.context.close();
});
