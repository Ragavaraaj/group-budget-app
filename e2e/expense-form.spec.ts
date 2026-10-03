import { expect, test } from '@playwright/test';
import { addExpenseOn, devSignIn, missingId, submitButton, uniqueEmail } from './helpers';

test.describe('expense form: input that is refused', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('expense-form'));
    await page.goto('/add');
    await expect(page.getByLabel('Amount')).toBeFocused();
  });

  // Each of these is something a person can type into the amount box. None can be saved.
  const refused: { text: string; why: string }[] = [
    { text: '', why: 'nothing typed' },
    { text: '0', why: 'zero' },
    { text: '0.00', why: 'zero with decimals' },
    { text: '-5', why: 'negative' },
    { text: 'abc', why: 'letters' },
    { text: '12abc', why: 'digits then letters' },
    { text: '1.234', why: 'three decimals (a fraction of a paisa)' },
    { text: '1..5', why: 'two dots' },
    { text: '.', why: 'a lone dot' },
    { text: '₹', why: 'only the rupee sign' },
    { text: '100000001', why: 'more than ₹10 crore' },
  ];

  test('cannot be saved with an amount that is missing, zero, malformed or too large', async ({
    page,
  }) => {
    const amount = page.getByLabel('Amount');
    for (const { text, why } of refused) {
      await amount.fill(text);
      await expect(submitButton(page), `${why}: "${text}"`).toBeDisabled();
    }
  });

  test('marks an amount it cannot read as invalid, but not an empty or zero one', async ({
    page,
  }) => {
    const amount = page.getByLabel('Amount');
    await amount.fill('12abc');
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await amount.fill('1.234');
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await amount.fill('');
    await expect(amount).toHaveAttribute('aria-invalid', 'false');
    await amount.fill('0');
    await expect(amount).toHaveAttribute('aria-invalid', 'false');
    await amount.fill('45');
    await expect(amount).toHaveAttribute('aria-invalid', 'false');
  });

  // The other side of the same rule: what people really type is understood.
  const accepted: { text: string; shown: string }[] = [
    { text: '12.', shown: '₹12' },
    { text: '.5', shown: '₹0.50' },
    { text: '0.01', shown: '₹0.01' },
    { text: '₹ 1,23,456.78', shown: '₹1,23,456.78' },
    { text: '1234.5', shown: '₹1,234.50' },
    { text: '100000000', shown: '₹10,00,00,000' },
  ];

  for (const { text, shown } of accepted) {
    test(`understands "${text}" as ${shown}`, async ({ page }) => {
      await page.getByLabel('Amount').fill(text);
      await expect(submitButton(page)).toBeEnabled();
      await submitButton(page).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('month-total')).toContainText(shown);
    });
  }

  test('keeps a note to 200 characters', async ({ page }) => {
    await page.getByLabel('Note (optional)').fill('x'.repeat(250));
    await expect(page.getByLabel('Note (optional)')).toHaveValue('x'.repeat(200));
  });

  test('does not offer a day in the future', async ({ page }) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    await page.getByLabel('Date', { exact: true }).click();

    // No later year to pick.
    const years = await page
      .getByRole('combobox', { name: 'Choose the Year' })
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    expect(years.at(-1)).toBe(String(now.getFullYear()));

    // Later months of this year are listed but cannot be chosen.
    const months = await page
      .getByRole('combobox', { name: 'Choose the Month' })
      .locator('option')
      .evaluateAll((options) =>
        options.map((o) => ({
          month: Number((o as HTMLOptionElement).value),
          disabled: (o as HTMLOptionElement).disabled,
        })),
      );
    for (const { month, disabled } of months) {
      expect(disabled, `month ${month + 1}`).toBe(month > now.getMonth());
    }

    // So are the days after today in the month being shown (none, on the last day of a month).
    const days = await page.locator('[data-day]').evaluateAll((cells) =>
      cells.map((cell) => ({
        day: cell.getAttribute('data-day') ?? '',
        disabled: (cell.querySelector('button') as HTMLButtonElement | null)?.disabled ?? false,
      })),
    );
    for (const { day, disabled } of days.filter((d) => d.day.slice(0, 7) === today.slice(0, 7))) {
      expect(disabled, day).toBe(day > today);
    }
  });

  test('going Back leaves nothing behind', async ({ page }) => {
    await page.getByLabel('Amount').fill('500');
    await page.getByLabel('Note (optional)').fill('Never saved');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('No expenses in')).toBeVisible();
    await expect(page.getByRole('link', { name: /Never saved/ })).toHaveCount(0);
  });
});

test.describe('editing and deleting', () => {
  test('cannot be saved once the amount is cleared or made unreadable; the old value survives', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('expense-edit'));
    await page.goto('/');
    await addExpenseOn(page, { amount: '100', note: 'Tea' });

    await page.getByRole('link', { name: /Tea/ }).click();
    const amount = page.getByLabel('Amount');
    await expect(amount).toHaveValue('100');

    await amount.fill('');
    await expect(submitButton(page, 'Save changes')).toBeDisabled();
    await amount.fill('abc');
    await expect(submitButton(page, 'Save changes')).toBeDisabled();
    await amount.fill('0');
    await expect(submitButton(page, 'Save changes')).toBeDisabled();

    // Leaving without saving keeps what was there.
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹100');

    // A valid change goes through.
    await page.getByRole('link', { name: /Tea/ }).click();
    await amount.fill('120');
    await submitButton(page, 'Save changes').click();
    await expect(page.getByTestId('month-total')).toContainText('₹120');
  });

  test('an expense that never existed, or was deleted, opens the not-found page', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('expense-gone'));
    await page.goto(`/expenses/${missingId()}/edit`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to expenses' }).click();
    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();

    await addExpenseOn(page, { amount: '60', note: 'Short-lived' });
    await page.getByRole('link', { name: /Short-lived/ }).click();
    const editUrl = page.url();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    await expect(page.getByText('No expenses in')).toBeVisible();

    // The bookmark to a deleted expense does not bring it back.
    await page.goto(editUrl);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('undo brings a deleted expense back with its details', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('expense-undo'));
    await page.goto('/');
    await addExpenseOn(page, {
      amount: '250',
      note: 'Bookshop',
      category: 'Shopping',
    });
    await page.getByRole('link', { name: /Bookshop/ }).click();
    await page.getByRole('button', { name: 'Delete expense' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹0');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('month-total')).toContainText('₹250');

    await page.getByRole('link', { name: /Bookshop/ }).click();
    await expect(page.getByLabel('Amount')).toHaveValue('250');
    await expect(page.getByRole('button', { name: 'Shopping', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('categories on the form', () => {
  test('a category can be chosen, cleared by tapping it again, and is remembered', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('expense-category'));
    await page.goto('/add');

    const transport = page.getByRole('button', { name: 'Transport', exact: true });
    await expect(transport).toHaveAttribute('aria-pressed', 'false');
    await transport.click();
    await expect(transport).toHaveAttribute('aria-pressed', 'true');
    await transport.click();
    await expect(transport).toHaveAttribute('aria-pressed', 'false');

    // Chosen and saved once, it is already chosen the next time.
    await transport.click();
    await page.getByLabel('Amount').fill('30');
    await submitButton(page).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: 'Add expense' }).click();
    await expect(page.getByRole('button', { name: 'Transport', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('an expense with no note is named after its category, and with neither, "Expense"', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('expense-title'));
    await page.goto('/');

    await addExpenseOn(page, { amount: '10', note: '', category: 'Health' });
    await expect(page.getByRole('link', { name: /Health/ })).toBeVisible();

    // The form remembers Health; tapping it again clears it for the next one.
    await page.getByRole('link', { name: 'Add expense' }).click();
    await page.getByRole('button', { name: 'Health', exact: true }).click();
    await page.getByLabel('Amount').fill('20');
    await submitButton(page).click();
    await expect(page.getByRole('link', { name: /^Expense\s*₹20/ })).toBeVisible();
  });
});
