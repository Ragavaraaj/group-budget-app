import { expect, test } from '@playwright/test';
import {
  addExpenseOn,
  createGroup,
  createInviteLink,
  devSignIn,
  joinViaLink,
  newPerson,
  openGroupExpenseForm,
  openGroupTab,
  signedInApi,
  uniqueEmail,
  waitForSynced,
} from './helpers';

// What goes wrong with sync on an iPhone, tried before a person finds it. Every iOS browser runs
// WebKit, so the `mobile-webkit` project (an iPhone profile) is the closest thing to it that CI
// has; the same tests also run in Chromium, where they pin down the behaviour itself.
//
// Two things differ on an iPhone and both must leave sync working over plain HTTP:
//   1. The live WebSocket may not open (the security policy, a network that blocks it, a browser
//      that throws) or may die without saying so. Polling then carries the sync.
//   2. `navigator.onLine` can say "offline" on a working connection and never fire `online`.

test('the live connection opens under the app’s own security policy', async ({ page }) => {
  // A policy that blocks the socket is reported to the page, not to the test, so listen for it.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
  const sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));

  await page.goto('/login');
  await devSignIn(page, uniqueEmail('ios-live'));
  await page.goto('/settings');

  await expect(page.getByText(/Live: changes from other people arrive as they happen/)).toBeVisible(
    { timeout: 10_000 },
  );
  expect(sockets.some((url) => url.includes('/api/live'))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

/** The two ways a phone's browser can fail to give the app a socket. */
const brokenSockets = {
  'throws when the app opens it (a security policy, or the browser refusing)': () => {
    window.WebSocket = class {
      constructor() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }
    } as unknown as typeof WebSocket;
  },
  'fails after it was asked for (a network that does not pass WebSockets on)': () => {
    window.WebSocket = class extends EventTarget {
      readyState = 3;
      constructor() {
        super();
        setTimeout(() => {
          this.dispatchEvent(new Event('error'));
          this.dispatchEvent(new Event('close'));
        }, 0);
      }
      send() {}
      close() {}
    } as unknown as typeof WebSocket;
  },
};

for (const [how, breakSocket] of Object.entries(brokenSockets)) {
  test.describe(`when the live connection ${how}`, () => {
    test('a change still reaches the server and the other phone over plain HTTP', async ({
      page,
      browser,
    }) => {
      await page.addInitScript(breakSocket);
      await page.goto('/login');
      await devSignIn(page, uniqueEmail('alice'), 'Alice');
      await createGroup(page, 'No socket trip');
      const link = await createInviteLink(page);

      const bob = await newPerson(browser, uniqueEmail('bob'), 'Bob');
      await bob.page.addInitScript(breakSocket);
      // Time is Bob's to move, so the wait for the next poll takes no real time.
      await bob.page.clock.install();
      await joinViaLink(bob.page, link);
      await expect(bob.page.getByRole('heading', { name: 'No socket trip' })).toBeVisible();
      await expect(bob.page.getByText(/No expenses in/)).toBeVisible();

      await openGroupTab(page, 'Expenses');
      await openGroupExpenseForm(page);
      await page.getByLabel('Amount', { exact: true }).fill('640');
      await page.getByLabel('Note (optional)').fill('Taxi to the airport');
      await page.getByRole('button', { name: 'Add expense' }).click();
      await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();
      // Alice's push is a plain request: it has been answered once the row stops saying "Not synced yet".
      const row = page.getByRole('link', { name: /Taxi to the airport/ });
      await expect(row).toBeVisible();
      await expect(row).not.toContainText('Not synced yet');

      // Nothing tells Bob's phone, so it learns by polling, however far apart the polls have backed off.
      await bob.page.clock.fastForward(6 * 60_000);
      await expect(bob.page.getByRole('link', { name: /Taxi to the airport/ })).toBeVisible();
      await bob.context.close();
    });

    test('the app does not claim to be live', async ({ page }) => {
      await page.addInitScript(breakSocket);
      await page.goto('/login');
      await devSignIn(page, uniqueEmail('ios-nolive'));
      await page.goto('/settings');
      await waitForSynced(page);
      await expect(page.getByText(/Live: changes from other people arrive/)).toHaveCount(0);
    });
  });
}

test.describe('when the browser says it is offline on a working connection', () => {
  test('a change is still sent, and the app does not stay stuck on "offline"', async ({
    page,
    playwright,
  }) => {
    // What an iPhone can do after waking, or on a VPN or Private Relay: onLine is false, `online`
    // never comes, and the connection is fine.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
    });
    const email = uniqueEmail('ios-onlinefalse');
    await page.goto('/login');
    await devSignIn(page, email, 'Ira');
    await page.goto('/');
    await addExpenseOn(page, { amount: '180', note: 'Chai on a flaky flag' });

    await waitForSynced(page);
    const row = page.getByRole('link', { name: /Chai on a flaky flag/ });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('Not synced yet');

    // And the server really has it, which the chip alone does not prove.
    const api = await signedInApi(playwright, email, 'Ira');
    const pulled = await api.get('/api/sync/pull?since=0');
    expect(await pulled.text()).toContain('Chai on a flaky flag');
    await api.dispose();
  });
});
