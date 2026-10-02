import { expect, test } from '@playwright/test';
import {
  addExpenseOn,
  createGroup,
  devSignIn,
  openGroupTab,
  submitButton,
  uniqueEmail,
} from './helpers';

test.describe('categories', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('categories'));
  });

  test('a category needs a name, and the name is kept to 40 characters', async ({ page }) => {
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Add' }).click();
    const dialog = page.getByRole('dialog');
    const save = dialog.getByRole('button', { name: 'Save' });

    await expect(save).toBeDisabled();
    await dialog.getByLabel('Name').fill('     ');
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Name').fill('c'.repeat(60));
    await expect(dialog.getByLabel('Name')).toHaveValue('c'.repeat(40));
    await expect(save).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('c'.repeat(40))).toHaveCount(0);
  });

  test('renaming a category renames it on the expenses that already use it', async ({ page }) => {
    await page.goto('/');
    await addExpenseOn(page, { amount: '480', note: 'Weekly shop', category: 'Groceries' });

    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Edit Groceries' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Supermarket');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Supermarket')).toBeVisible();
    await expect(page.getByText('Groceries', { exact: true })).toHaveCount(0);

    await page.goto('/');
    await expect(page.getByRole('link', { name: /Weekly shop/ })).toContainText('Supermarket');
    await page.getByRole('link', { name: 'Add expense' }).click();
    await expect(page.getByRole('button', { name: 'Supermarket', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Groceries', exact: true })).toHaveCount(0);
  });

  test('an archived category is not offered for new expenses, but old ones keep it, and it can come back', async ({
    page,
  }) => {
    await page.goto('/');
    await addExpenseOn(page, { amount: '300', note: '', category: 'Entertainment' });
    await expect(page.getByRole('link', { name: /Entertainment/ })).toBeVisible();

    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Archive Entertainment' }).click();
    await expect(page.getByRole('button', { name: 'Restore Entertainment' })).toBeVisible();
    await expect(page.getByText('Archived')).toBeVisible();

    await page.goto('/add');
    await expect(page.getByRole('button', { name: 'Entertainment', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByRole('link', { name: /Entertainment/ })).toBeVisible();

    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Restore Entertainment' }).click();
    // The list is drawn from the local database, so this shows the write has happened.
    await expect(page.getByRole('button', { name: 'Archive Entertainment' })).toBeVisible();
    await page.goto('/add');
    await expect(page.getByRole('button', { name: 'Entertainment', exact: true })).toBeVisible();
  });

  test('a deleted category is gone from the choices, and existing expenses keep its name', async ({
    page,
  }) => {
    await page.goto('/');
    await addExpenseOn(page, { amount: '5400', note: '', category: 'Travel' });
    await expect(page.getByRole('link', { name: /Travel/ })).toBeVisible();

    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Delete Travel' }).click();
    await expect(page.getByText('Deleted “Travel”')).toBeVisible();
    await expect(page.getByText('Existing expenses keep their category name.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Travel' })).toHaveCount(0);

    await page.goto('/add');
    await expect(page.getByRole('button', { name: 'Travel', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back' }).click();
    // The toast's promise.
    await expect(page.getByRole('link', { name: /Travel/ })).toBeVisible();
  });

  test('the category used last is not left chosen after it is deleted', async ({ page }) => {
    await page.goto('/');
    await addExpenseOn(page, { amount: '60', note: 'Auto', category: 'Transport' });

    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Delete Transport' }).click();
    await expect(page.getByRole('button', { name: 'Edit Transport' })).toHaveCount(0);

    await page.goto('/add');
    await expect(page.getByRole('button', { name: 'Health', exact: true })).toBeVisible();
    for (const pressed of await page.getByRole('button', { pressed: true }).all()) {
      await expect(pressed).not.toHaveAccessibleName('Transport');
    }
    // And a new expense can still be saved, with no category.
    await page.getByLabel('Amount').fill('20');
    await submitButton(page).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('each group has its own categories', async ({ page }) => {
    await createGroup(page, 'Trip');
    await page.goto('/settings/categories');
    await page.getByLabel('Group').click();
    await page.getByRole('option', { name: 'Trip' }).click();

    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Ferry tickets');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Ferry tickets')).toBeVisible();

    // Not on the personal ledger...
    await page.goto('/add');
    await expect(page.getByRole('button', { name: 'Ferry tickets', exact: true })).toHaveCount(0);

    // ...but on the group's own form.
    await page.goto('/groups');
    await page.getByRole('link', { name: /Trip/ }).click();
    await openGroupTab(page, 'Expenses');
    await page.getByRole('link', { name: 'Add expense' }).click();
    await expect(page.getByRole('button', { name: 'Ferry tickets', exact: true })).toBeVisible();

    // And the personal list does not show the group's category either.
    await page.goto('/settings/categories');
    await expect(page.getByText('Ferry tickets')).toHaveCount(0);
  });
});
