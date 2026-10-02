import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';

/** Where `wrangler dev` serves the built app and the API (see playwright.config.ts). */
export const ORIGIN = 'http://localhost:8787';

let counter = 0;

/** A fresh address per test, so tests never meet each other's data (the e2e database persists). */
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}-${Date.now().toString(36)}-${counter}@example.com`;
}

/**
 * Signs the page's browser context in through the dev-only endpoint, which exists only because
 * the e2e server runs with ENVIRONMENT=development and ENABLE_DEV_LOGIN=1.
 */
export async function devSignIn(page: Page, email: string, name?: string): Promise<void> {
  const origin = new URL(page.url() === 'about:blank' ? 'http://localhost:8787' : page.url())
    .origin;
  const response = await page.request.post(`${origin}/api/auth/dev-login`, {
    data: { email, name },
    headers: { origin },
  });
  if (!response.ok()) throw new Error(`dev login failed: ${response.status()}`);
}

/** A second person on a second device: its own context, so its own cookies and local database. */
export async function newPerson(
  browser: Browser,
  email: string,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8787' });
  const page = await context.newPage();
  await devSignIn(page, email, name);
  return { context, page };
}

/** Waits for the sync chip to say everything has reached the server. */
export async function waitForSynced(page: Page): Promise<void> {
  await page
    .getByRole('status')
    .filter({ hasText: /^Synced$/ })
    .waitFor();
}

/** "YYYY-MM-DD" in this machine's local time, `days` days before today. */
export function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localIso(d);
}

/** The 15th of the calendar month before this one: always inside that month, whatever today is. */
export function midPreviousMonth(): string {
  const now = new Date();
  return localIso(new Date(now.getFullYear(), now.getMonth() - 1, 15));
}

function localIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Chooses a day (`YYYY-MM-DD`) in the date picker named by `label`. */
export async function pickDate(page: Page, label: string, iso: string): Promise<void> {
  const [year, month] = iso.split('-').map(Number) as [number, number];
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('combobox', { name: 'Choose the Year' }).selectOption(String(year));
  await page.getByRole('combobox', { name: 'Choose the Month' }).selectOption(String(month - 1));
  await page.locator(`[data-day="${iso}"] button`).click();
  // The calendar closes with a short animation; a second picker must not meet the first one.
  await expect(page.getByRole('combobox', { name: 'Choose the Year' })).toHaveCount(0);
}

/** Empties an optional date picker (the one named by `label`) with its "Clear date" button. */
export async function clearDate(page: Page, label: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('button', { name: 'Clear date' }).click();
  await expect(page.getByRole('combobox', { name: 'Choose the Year' })).toHaveCount(0);
}

/** Adds a personal expense through the form, on a given day. */
export async function addExpenseOn(
  page: Page,
  details: { amount: string; note: string; category?: string; date?: string },
): Promise<void> {
  await page.getByRole('link', { name: 'Add expense' }).click();
  await page.getByLabel('Amount').fill(details.amount);
  if (details.category) {
    // The form remembers the last category per group, so it may already be chosen: a second tap
    // would clear it.
    const chip = page.getByRole('button', { name: details.category, exact: true });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  if (details.date) await pickDate(page, 'Date', details.date);
  await page.getByLabel('Note (optional)').fill(details.note);
  await page.getByRole('button', { name: 'Add expense' }).click();
  // The form closes only after the expense has been written to the local database.
  await page.getByLabel('Amount').waitFor({ state: 'hidden' });
}

/** Runs the Worker's scheduled job once, as Cloudflare's cron would (`wrangler dev --test-scheduled`). */
export async function runScheduledJob(page: Page): Promise<void> {
  const response = await page.request.get('http://localhost:8787/cdn-cgi/handler/scheduled');
  if (!response.ok()) throw new Error(`scheduled job failed: ${response.status()}`);
}

/** Creates a shared group from the Groups screen and lands on its page. */
export async function createGroup(page: Page, name: string): Promise<void> {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('Group name').fill(name);
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** An id that no group, expense or invite has: for visiting or calling things that don't exist. */
export function missingId(): string {
  return crypto.randomUUID();
}

/**
 * A signed-in API client with no browser: for checking what the server allows and refuses.
 * It sends the `Origin` header a browser would, which the server's CSRF check requires on
 * anything that changes data, so a refusal from a test is never just a missing header.
 */
export async function signedInApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  email: string,
  name?: string,
): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({
    baseURL: ORIGIN,
    extraHTTPHeaders: { origin: ORIGIN },
  });
  const response = await api.post('/api/auth/dev-login', { data: { email, name } });
  if (!response.ok()) throw new Error(`dev login failed: ${response.status()}`);
  return api;
}

/** Opens a tab of the group page (Expenses, Balances, Activity, Members). */
export async function openGroupTab(page: Page, tab: string): Promise<void> {
  await page.getByRole('tab', { name: tab }).click();
}

/** The owner makes an invite link on the Members tab and gets its address. */
export async function createInviteLink(page: Page): Promise<string> {
  await openGroupTab(page, 'Members');
  await page.getByRole('button', { name: 'Invite people' }).click();
  const link = page.getByLabel('Invite link');
  await expect(link).toHaveValue(/\/join\//);
  const value = await link.inputValue();
  await page.keyboard.press('Escape');
  return value;
}

/** Opens an invite link and joins the group. */
export async function joinViaLink(page: Page, link: string): Promise<void> {
  await page.goto(new URL(link).pathname);
  await expect(page.getByText(/invited you to/)).toBeVisible();
  await page.getByRole('button', { name: 'Join group' }).click();
}

/** The owner adds someone who doesn't use the app, on the Members tab. */
export async function addPlaceholderMember(page: Page, name: string): Promise<void> {
  await openGroupTab(page, 'Members');
  await page.getByRole('button', { name: 'Add someone without the app' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`${name} was added`)).toBeVisible();
}

/** Alice (signed in on `page`) with a new shared group and `Sam`, who is not on the app. */
export async function groupWithPlaceholder(
  page: Page,
  groupName: string,
  placeholder = 'Sam',
): Promise<void> {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, groupName);
  await addPlaceholderMember(page, placeholder);
  await openGroupTab(page, 'Expenses');
}

/** Opens the add-expense form from a group's Expenses or Balances tab. */
export async function openGroupExpenseForm(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Add expense' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();
}

/** The form's submit button, which stays disabled until what was typed can be saved. */
export function submitButton(page: Page, label: 'Add expense' | 'Save changes' = 'Add expense') {
  return page.getByRole('button', { name: label });
}

/**
 * Alice (signed in on `page`) owns a new group that Bob has joined from his own browser, and
 * Alice's device already knows about him. Returns Bob's browser, the invite link, and the group's
 * address (`/groups/<id>`).
 */
export async function groupOfTwo(page: Page, browser: Browser, name: string) {
  await page.goto('/login');
  await devSignIn(page, uniqueEmail('alice'), 'Alice');
  await createGroup(page, name);
  const groupPath = new URL(page.url()).pathname;
  const link = await createInviteLink(page);
  const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
  await joinViaLink(bob.page, link);
  await expect(bob.page.getByRole('heading', { name })).toBeVisible();
  await page.reload();
  return { bob, link, groupPath };
}
