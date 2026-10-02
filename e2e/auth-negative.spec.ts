import { type APIRequestContext, type APIResponse, expect, test } from '@playwright/test';
import {
  addExpenseOn,
  devSignIn,
  ORIGIN,
  signedInApi,
  uniqueEmail,
  waitForSynced,
} from './helpers';

// Sign-in is where a mistake costs the most, so this file is about what must NOT work: forms that
// refuse bad input, sessions that are not real, requests from other sites, and callbacks that
// were not started here.

test.describe('the sign-in screen', () => {
  test('does not send an empty or malformed email', async ({ page }) => {
    let attempts = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/dev-login')) attempts++;
    });
    await page.goto('/login');
    const email = page.getByLabel('Dev sign-in');
    const valid = () => email.evaluate((el) => (el as HTMLInputElement).validity.valid);

    for (const bad of ['', 'not-an-email', 'two@@example.com', 'no spaces@example.com']) {
      await email.fill(bad);
      await page.getByRole('button', { name: 'Sign in' }).click();
      expect(await valid(), `"${bad}"`).toBe(false);
      await expect(page).toHaveURL(/\/login$/);
    }
    expect(attempts).toBe(0);
  });

  test('explains each way the Google sign-in can fail, and ignores a code it does not know', async ({
    page,
  }) => {
    const messages: Record<string, string> = {
      not_invited:
        'This Google account isn’t invited yet. Ask a group owner to send you an invite link.',
      access_denied: 'Sign-in was cancelled.',
      email_not_verified: 'Google says this email address isn’t verified.',
      invalid_state: 'That sign-in link expired. Please try again.',
      google_error: 'Google sign-in didn’t work. Please try again.',
    };
    for (const [code, text] of Object.entries(messages)) {
      await page.goto(`/login?error=${code}`);
      await expect(page.getByRole('alert'), code).toHaveText(text);
    }

    // Anything else in the address is not shown, least of all as markup.
    await page.goto('/login?error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('offline, it says that sign-in needs a connection', async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByText('Ready to work offline')).toBeVisible();
    await page.evaluate(async () => navigator.serviceWorker.ready);

    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByText('You’re offline. Connect to the internet to sign in.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  });

  test('a deep link opened while signed out is opened after signing in', async ({ page }) => {
    await page.goto('/settings/categories');
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Dev sign-in').fill(uniqueEmail('deep-link'));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/settings\/categories$/);
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
  });

  test('someone already signed in who opens the sign-in screen is sent on', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('already'));
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  });
});

test.describe('sessions', () => {
  test('a session cookie that was made up is the same as no session', async ({ page, context }) => {
    await page.goto('/login');
    await context.addCookies([
      { name: 'gb_session', value: 'a-made-up-session-token-0123456789', url: ORIGIN },
    ]);
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await page.goto('/groups');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signing out ends the session on the server, so a copied cookie stops working', async ({
    playwright,
  }) => {
    const api = await signedInApi(playwright, uniqueEmail('copied'));
    const { cookies } = await api.storageState();
    const session = cookies.find((cookie) => cookie.name === 'gb_session');
    expect(session, 'a session cookie was set').toBeDefined();
    const stolen = await playwright.request.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { cookie: `gb_session=${session?.value}` },
    });

    expect((await stolen.get('/api/me')).status()).toBe(200);
    expect((await api.post('/api/auth/logout')).status()).toBe(200);
    expect((await stolen.get('/api/me')).status()).toBe(401);
    expect((await api.get('/api/me')).status()).toBe(401);

    // Signing out twice is harmless.
    expect((await api.post('/api/auth/logout')).status()).toBe(200);
    await api.dispose();
    await stolen.dispose();
  });

  test('the session cookie cannot be read by the page', async ({ page }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('httponly'));
    await page.goto('/');
    expect(await page.evaluate(() => document.cookie)).not.toContain('gb_session');
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === 'gb_session');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Lax');
  });

  test('signing out is not possible with no connection', async ({ page, context }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('signout-offline'));
    await page.goto('/settings');
    await waitForSynced(page);

    await context.setOffline(true);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    await expect(page.getByText('Signing out needs a connection.')).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  test('signing out warns when changes have not reached the server, and Stay keeps everything', async ({
    page,
  }) => {
    await page.goto('/login');
    await devSignIn(page, uniqueEmail('signout-unsent'));
    await page.goto('/');
    await waitForSynced(page);

    // The server is failing, so the change stays on the device.
    await page.route('**/api/sync/push', (route) =>
      route.fulfill({ status: 500, json: { error: 'internal_error' } }),
    );
    await addExpenseOn(page, { amount: '75', note: 'Not sent yet' });
    await expect(
      page.getByRole('status').filter({ hasText: /Sync problem · 1 waiting/ }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('1 change hasn’t reached the server yet');
    await expect(dialog).toContainText('it will be lost');

    await dialog.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(dialog).toBeHidden();
    expect((await page.request.get('/api/me')).status()).toBe(200);
    await page.getByRole('link', { name: 'Expenses', exact: true }).click();
    await expect(page.getByRole('link', { name: /Not sent yet/ })).toBeVisible();

    // Choosing to sign out anyway does it, and the device's copy is wiped.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out anyway' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/me')).status()).toBe(401);
    const databases = await page.evaluate(async () =>
      (await indexedDB.databases()).map((database) => database.name),
    );
    expect(databases.some((name) => name?.startsWith('budget-'))).toBe(false);
  });
});

test.describe('requests from other sites', () => {
  test('a change of any kind without our own origin is refused', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: ORIGIN });
    const body = { email: uniqueEmail('csrf') };

    const noOrigin = await anonymous.post('/api/auth/dev-login', { data: body });
    expect(noOrigin.status()).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: 'bad_origin' });

    for (const origin of ['https://evil.example', 'http://localhost:8788', 'null']) {
      const response = await anonymous.post('/api/auth/dev-login', {
        data: body,
        headers: { origin },
      });
      expect(response.status(), origin).toBe(403);
    }

    const ours = await anonymous.post('/api/auth/dev-login', {
      data: body,
      headers: { origin: ORIGIN },
    });
    expect(ours.status()).toBe(200);
    await anonymous.dispose();
  });

  test('a signed-in person cannot be made to change things from another site', async ({
    playwright,
  }) => {
    const email = uniqueEmail('victim');
    const api = await signedInApi(playwright, email);
    const { cookies } = await api.storageState();
    const session = cookies.find((cookie) => cookie.name === 'gb_session');
    // The browser would attach the cookie; the page on the other site sets the Origin.
    const attacker = await playwright.request.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { cookie: `gb_session=${session?.value}`, origin: 'https://evil.example' },
    });

    const create = await attacker.post('/api/groups', { data: { name: 'Planted' } });
    expect(create.status()).toBe(403);
    const logout = await attacker.post('/api/auth/logout');
    expect(logout.status()).toBe(403);

    // Nothing happened: still signed in, and no group appeared.
    expect((await api.get('/api/me')).status()).toBe(200);
    const pull = await (await api.get('/api/sync/pull')).json();
    expect(pull.groups.filter((group: { name: string }) => group.name === 'Planted')).toEqual([]);

    // Reading is not a change, so it is not refused (the browser's own rules protect those).
    expect((await attacker.get('/api/me')).status()).toBe(200);
    await api.dispose();
    await attacker.dispose();
  });
});

test.describe('the sign-in callback', () => {
  /** Starts a sign-in the way the button does, and returns the state Google would send back. */
  async function startSignIn(api: APIRequestContext, query = '') {
    const start = await api.get(`/api/auth/google/start${query}`, { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    const location = new URL(start.headers().location ?? '', ORIGIN);
    return { start, state: location.searchParams.get('state') ?? '' };
  }
  const location = (response: APIResponse) => response.headers().location;

  test('refuses a call with no state, an unknown state, or a state used before', async ({
    playwright,
  }) => {
    const browser = await playwright.request.newContext({ baseURL: ORIGIN });

    expect(location(await browser.get('/api/auth/google/callback', { maxRedirects: 0 }))).toBe(
      '/login?error=invalid_state',
    );
    expect(
      location(
        await browser.get('/api/auth/google/callback?state=made-up&code=dev:a@example.com', {
          maxRedirects: 0,
        }),
      ),
    ).toBe('/login?error=invalid_state');

    // Google sending the person back with "access denied" is reported as cancelled...
    const { state } = await startSignIn(browser);
    const denied = await browser.get(
      `/api/auth/google/callback?state=${state}&error=access_denied`,
      {
        maxRedirects: 0,
      },
    );
    expect(location(denied)).toBe('/login?error=access_denied');
    // ...and the same state cannot be used a second time.
    const again = await browser.get(
      `/api/auth/google/callback?state=${state}&code=dev:${uniqueEmail('replay')}`,
      { maxRedirects: 0 },
    );
    expect(location(again)).toBe('/login?error=invalid_state');
    await browser.dispose();
  });

  test('a callback with no code is a Google error, and signs nobody in', async ({ playwright }) => {
    const browser = await playwright.request.newContext({ baseURL: ORIGIN });
    const { state } = await startSignIn(browser);
    const response = await browser.get(`/api/auth/google/callback?state=${state}`, {
      maxRedirects: 0,
    });
    expect(location(response)).toBe('/login?error=google_error');
    expect((await browser.get('/api/me')).status()).toBe(401);
    await browser.dispose();
  });

  test('a callback that did not start in this browser is refused (login CSRF)', async ({
    playwright,
  }) => {
    const victim = await playwright.request.newContext({ baseURL: ORIGIN });
    const { state } = await startSignIn(victim);

    // An attacker's link carrying the attacker's own code, opened in a browser that never started
    // the sign-in and so has no cookie for it.
    const other = await playwright.request.newContext({ baseURL: ORIGIN });
    const response = await other.get(
      `/api/auth/google/callback?state=${state}&code=dev:${uniqueEmail('attacker')}`,
      { maxRedirects: 0 },
    );
    expect(location(response)).toBe('/login?error=invalid_state');
    expect((await other.get('/api/me')).status()).toBe(401);
    await victim.dispose();
    await other.dispose();
  });

  test('refuses a sign-in that is started with a malformed hand-off or invite', async ({
    playwright,
  }) => {
    const browser = await playwright.request.newContext({ baseURL: ORIGIN });
    const badAttempt = await browser.get('/api/auth/google/start?attempt=not-a-hash', {
      maxRedirects: 0,
    });
    expect(badAttempt.status()).toBe(400);
    expect(await badAttempt.json()).toEqual({ error: 'invalid_attempt' });

    const badInvite = await browser.get('/api/auth/google/start?invite=has%20spaces', {
      maxRedirects: 0,
    });
    expect(badInvite.status()).toBe(400);
    expect(await badInvite.json()).toEqual({ error: 'invalid_invite' });

    const tooShort = await browser.get('/api/auth/google/start?invite=abc', { maxRedirects: 0 });
    expect(tooShort.status()).toBe(400);

    // A well-formed one is accepted.
    const attempt = 'a'.repeat(64);
    const fine = await browser.get(`/api/auth/google/start?attempt=${attempt}`, {
      maxRedirects: 0,
    });
    expect(fine.status()).toBe(302);
    await browser.dispose();
  });
});

test.describe('the installed app’s hand-off', () => {
  test('refuses a malformed secret, answers "pending" for an unknown one, and expires a bad link', async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { origin: ORIGIN },
    });

    for (const data of [{}, { secret: 'short' }, { secret: 'x'.repeat(44) }, { secret: 7 }]) {
      const response = await api.post('/api/auth/attempt/redeem', { data });
      expect(response.status(), JSON.stringify(data)).toBe(400);
    }
    const unknown = await api.post('/api/auth/attempt/redeem', {
      data: { secret: 'A'.repeat(43) },
    });
    expect(unknown.status()).toBe(200);
    expect(await unknown.json()).toEqual({ status: 'pending' });
    expect((await api.get('/api/me')).status()).toBe(401); // nothing was signed in

    // Confirming with a token that was never issued says the link has expired.
    for (const token of ['', 'short', 'z'.repeat(40)]) {
      const response = await api.post('/api/auth/attempt/confirm', { form: { token } });
      expect(response.status(), `"${token}"`).toBe(400);
      expect(await response.text()).toContain('This link has expired');
    }
    await api.dispose();
  });
});

test.describe('the development sign-in endpoint', () => {
  test('refuses a body that is not a valid email and name', async ({ playwright }) => {
    const api = await playwright.request.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { origin: ORIGIN },
    });
    const bad: unknown[] = [
      {},
      { email: '' },
      { email: 'nope' },
      { email: 42 },
      { email: uniqueEmail('name'), name: '' },
      { email: uniqueEmail('name'), name: '   ' },
      { email: uniqueEmail('name'), name: 'n'.repeat(101) },
      [],
      'a string',
    ];
    for (const data of bad) {
      const response = await api.post('/api/auth/dev-login', { data });
      expect(response.status(), JSON.stringify(data)).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    // Not JSON at all.
    const notJson = await api.post('/api/auth/dev-login', {
      headers: { 'content-type': 'application/json' },
      data: '{broken',
    });
    expect(notJson.status()).toBe(400);
    expect((await api.get('/api/me')).status()).toBe(401);
    await api.dispose();
  });
});
