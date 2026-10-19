import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test as base, expect, type Page } from '@playwright/test';
import { devSignIn, uniqueEmail } from './helpers';

// A new version of the app is a service worker whose bytes differ. Playwright cannot swap the one
// the browser fetches when it checks for an update, so each test gets a small proxy in front of
// the e2e server, on its own port: its own origin, so its own service worker and storage, apart
// from every other test. The proxy can start serving a different sw.js, as a deploy does.
// Page loads are counted in sessionStorage, which survives a reload, to tell whether it reloaded.

const SERVER = { host: '127.0.0.1', port: 8787 };
const OFFER = 'A new version is available';

interface AppProxy {
  origin: string;
  /** From now on `/sw.js` is a different file: a new deploy. A delay leaves time to tap first. */
  deploy(delayMs?: number): void;
}

async function startProxy(): Promise<{ proxy: AppProxy; close(): Promise<void> }> {
  let deployed = false;
  let delayMs = 0;

  const server = http.createServer((req, res) => {
    const headers = { ...req.headers };
    delete headers['accept-encoding']; // plain text, so sw.js can be edited
    if (req.url === '/sw.js') {
      delete headers['if-none-match']; // always the whole file, never "not modified"
      delete headers['if-modified-since'];
    }
    const upstream = http.request(
      { ...SERVER, path: req.url, method: req.method, headers },
      async (answer) => {
        if (req.url === '/sw.js' && deployed) {
          const chunks: Buffer[] = [];
          for await (const chunk of answer) chunks.push(chunk as Buffer);
          const body = `${Buffer.concat(chunks).toString()}\n// a new version`;
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          const changed: http.OutgoingHttpHeaders = {
            ...answer.headers,
            'cache-control': 'no-cache',
          };
          for (const name of ['content-length', 'etag', 'last-modified']) delete changed[name];
          res.writeHead(answer.statusCode ?? 200, changed);
          res.end(body);
          return;
        }
        res.writeHead(answer.statusCode ?? 200, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(upstream);
  });
  // The live connection is not what is tested here: the app falls back to polling without it.
  server.on('upgrade', (_req, socket) => socket.destroy());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    proxy: {
      origin: `http://localhost:${port}`,
      deploy(delay = 0) {
        deployed = true;
        delayMs = delay;
      },
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const test = base.extend<{ app: AppProxy }>({
  app: async ({ browserName: _ }, use) => {
    const { proxy, close } = await startProxy();
    await use(proxy);
    await close();
  },
});

async function countLoads(page: Page) {
  await page.addInitScript(() => {
    const loads = Number(sessionStorage.getItem('e2e-loads') ?? 0) + 1;
    sessionStorage.setItem('e2e-loads', String(loads));
  });
}

/** How many times this page has loaded; null while it is in the middle of reloading. */
const loads = (page: Page) =>
  page.evaluate(() => Number(sessionStorage.getItem('e2e-loads'))).catch(() => null);

const inControl = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.controller !== null).catch(() => false);

/** Signed in, with the service worker installed and in control of the page, as for a regular user. */
async function openAsInstalled(page: Page, app: AppProxy) {
  await countLoads(page);
  await page.goto(`${app.origin}/login`);
  await devSignIn(page, uniqueEmail('pwa-update'));
  await page.goto(`${app.origin}/`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => inControl(page)).toBe(true);
}

const waiting = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.waiting != null));

test.describe('a new version of the app is waiting', () => {
  test('is applied by itself on the next reload when nothing has been touched', async ({
    page,
    app,
  }) => {
    await openAsInstalled(page, app);
    const before = (await loads(page)) ?? 0;
    app.deploy();

    await page.reload();
    // One load for the reload, and one more when the new version took over and the page reloaded.
    await expect.poll(() => loads(page), { timeout: 20_000 }).toBe(before + 2);
    expect(await waiting(page)).toBe(false);
    // It wrote down that it did this, which is what stops it doing so twice running.
    expect(await page.evaluate(() => localStorage.getItem('gb:auto-update-at'))).not.toBeNull();
    await expect(page.getByText(OFFER)).toBeHidden();
  });

  test('is offered, not applied, once the person has tapped something', async ({ page, app }) => {
    await openAsInstalled(page, app);
    const before = (await loads(page)) ?? 0;
    app.deploy(1_500);

    await page.reload();
    await page.mouse.click(5, 5); // the person starts using the app before it is found
    await expect(page.getByText(OFFER)).toBeVisible({ timeout: 20_000 });
    expect(await loads(page)).toBe(before + 1); // not reloaded under them
    expect(await waiting(page)).toBe(true);

    // Settings says so too, in case the message was dismissed.
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByText('A newer version of the app is ready.')).toBeVisible();

    // And tapping Reload applies it, though they had touched things.
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => loads(page), { timeout: 20_000 }).toBe(before + 2);
    expect(await waiting(page)).toBe(false);
  });

  test('is offered, not applied, while a sign-in is waiting to be collected', async ({
    page,
    app,
  }) => {
    await openAsInstalled(page, app);
    const before = (await loads(page)) ?? 0;
    // A sign-in this device started: collecting it works once, so the page must not reload under it.
    await page.evaluate(() =>
      localStorage.setItem(
        'gb:attempt',
        JSON.stringify({ secret: 'waiting', startedAt: Date.now() }),
      ),
    );
    app.deploy();

    await page.reload();
    await expect(page.getByText(OFFER)).toBeVisible({ timeout: 20_000 });
    expect(await loads(page)).toBe(before + 1);
    expect(await waiting(page)).toBe(true);
  });

  test('is applied from an untouched tab, and a tab in use keeps what it has and is offered it', async ({
    page,
    app,
  }) => {
    await openAsInstalled(page, app);
    const before = (await loads(page)) ?? 0;

    // A second tab of the app, which the person has started using (a form half filled, say).
    const inUse = await page.context().newPage();
    await countLoads(inUse);
    await inUse.goto(`${app.origin}/`);
    await expect.poll(() => inControl(inUse)).toBe(true);
    await inUse.mouse.click(5, 5);
    const inUseBefore = await loads(inUse);

    app.deploy();
    await page.reload();

    // The untouched tab applies it, which reloads it...
    await expect.poll(() => loads(page), { timeout: 20_000 }).toBe(before + 2);
    expect(await waiting(page)).toBe(false);
    // ...and the tab in use is not reloaded with it: it is offered the reload instead.
    await expect(inUse.getByText(OFFER)).toBeVisible({ timeout: 20_000 });
    expect(await loads(inUse)).toBe(inUseBefore);
  });
});
