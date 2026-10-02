/** The few HTML pages the Worker serves itself (everything else is the React app). */

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Locked down: no scripts at all, styles only from the page itself, forms only to ourselves. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const layout = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
  main { max-width: 22rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1rem; }
  label { display: block; margin-bottom: .25rem; }
  input[type=email], input[type=text] { width: 100%; box-sizing: border-box; padding: .6rem; font: inherit; margin-bottom: 1rem; }
  button { font: inherit; padding: .7rem 1rem; width: 100%; border-radius: .5rem; border: 0; background: #0d9488; color: #fff; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;

/** Shown when sign-in finished in a browser while the installed app is waiting for it. */
export function confirmPage(token: string): string {
  return layout(
    'Finish signing in',
    `<h1>Finish signing in on your installed app?</h1>
<p>Continue only if you just tapped “Sign in” in the Group Budget app on this device. If you didn’t, close this page.</p>
<form method="post" action="/api/auth/attempt/confirm">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <button type="submit">Continue</button>
</form>`,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

/** A stand-in for Google's sign-in screen, for local development and tests only. */
export function devIdpPage(state: string): string {
  return layout(
    'Dev sign-in',
    `<h1>Dev sign-in (stand-in for Google)</h1>
<p>Only available when dev login is enabled. Type any email address.</p>
<form method="get" action="/api/auth/dev/idp/submit">
  <input type="hidden" name="state" value="${escapeHtml(state)}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required value="dev@example.com">
  <button type="submit">Sign in</button>
</form>`,
  );
}
