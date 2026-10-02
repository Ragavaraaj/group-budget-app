import { expect, test } from '@playwright/test';
import { createGroup, devSignIn, newPerson, uniqueEmail } from './helpers';

// The sync engine polls only every 30 seconds, so anything that shows up in a few seconds got
// there through the live connection (the Durable Object hub).

test('the live connection comes up, under the app’s own security policy', async ({ page }) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('live'));
  await page.goto('/settings');
  await expect(page.getByText(/Live: changes from other people arrive as they happen/)).toBeVisible(
    {
      timeout: 10_000,
    },
  );
});

test('an expense added on another device appears at once, with no reload', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Live trip');
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  const link = await page.getByLabel('Invite link').inputValue();
  await page.keyboard.press('Escape');

  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await bob.page.goto(new URL(link).pathname);
  await bob.page.getByRole('button', { name: 'Join group' }).click();
  await expect(bob.page.getByRole('heading', { name: 'Live trip' })).toBeVisible();
  await expect(bob.page.getByText(/No expenses in/)).toBeVisible();

  // Alice adds an expense. Bob's page, which nobody touches, shows it.
  await page.getByRole('tab', { name: 'Expenses' }).click();
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('640');
  await page.getByLabel('Note (optional)').fill('Taxi to the airport');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();

  await expect(bob.page.getByRole('link', { name: /Taxi to the airport/ })).toBeVisible({
    timeout: 10_000,
  });
  await bob.context.close();
});

test('being removed from a group is noticed at once', async ({ page, browser }) => {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, 'Short stay');
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  const link = await page.getByLabel('Invite link').inputValue();
  await page.keyboard.press('Escape');

  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await bob.page.goto(new URL(link).pathname);
  await bob.page.getByRole('button', { name: 'Join group' }).click();
  await expect(bob.page.getByRole('heading', { name: 'Short stay' })).toBeVisible();

  await page.reload(); // Alice's device learns that Bob joined
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Remove Bob' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();

  // Bob is told on his own page, without navigating or reloading.
  await expect(bob.page.getByText(/no longer available to you/)).toBeVisible({ timeout: 10_000 });
  await bob.context.close();
});
