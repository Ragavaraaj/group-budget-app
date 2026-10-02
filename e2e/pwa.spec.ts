import { expect, test } from '@playwright/test';

interface ManifestIcon {
  src: string;
  sizes: string;
  purpose?: string;
}

test('serves an installable web app manifest', async ({ page, request }) => {
  await page.goto('/');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href!)).json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: ManifestIcon[];
  };

  expect(manifest).toMatchObject({ name: 'Group Budget', display: 'standalone', start_url: '/' });
  const icons = manifest.icons.map(
    (icon) => `${icon.sizes}${icon.purpose ? `:${icon.purpose}` : ''}`,
  );
  expect(icons).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
  for (const icon of manifest.icons) {
    expect((await request.get(`/${icon.src}`)).ok(), `${icon.src} should load`).toBe(true);
  }
});

test('opens, navigates and deep-links with no network after the first visit', async ({
  page,
  context,
}) => {
  await page.goto('/settings');
  await expect(page.getByText('Ready to work offline')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // Online: the API is reachable through the same-origin proxy.
  await page.reload();
  await expect(page.getByText('Online', { exact: true })).toBeVisible();

  await context.setOffline(true);

  // A full reload and a deep link both have to be answered by the precached shell.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();

  await page.goto('/groups');
  await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible();

  // Client-side navigation keeps working too.
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();

  // And it recovers when the connection returns.
  await context.setOffline(false);
  await page.goto('/settings');
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
});

test('unknown routes show the in-app not-found page', async ({ page }) => {
  await page.goto('/definitely-not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
