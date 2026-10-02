[← Plan overview](PLAN.md)

# Auth: Google sign-in

**Flow** (server-side authorization code + PKCE, using `arctic`, which needs only `fetch` and Web Crypto and so should run on Workers as is — to be confirmed in the M1 spike; no third-party JavaScript in the page, so the CSP can stay strict):

1. `Continue with Google` → full-page navigation to `GET /api/auth/google/start` (optionally carrying an invite token).
2. Worker creates `state` + PKCE verifier, stores them in a short-lived HttpOnly cookie, redirects to Google with scopes `openid email profile`.
3. Google → `GET /api/auth/google/callback?code&state`. Worker checks `state`, exchanges the code, reads the ID token, **requires `email_verified`**, and applies the **sign-up gate** below.
4. Upsert the user by Google `sub` (never by email; emails can change), create the personal group on first sign-in, create a session, set the cookie, redirect to `/`.

**Sessions**: random 256-bit token; only its SHA-256 hash is stored in D1; `HttpOnly; Secure; SameSite=Lax`; 30-day sliding expiry; logout revokes. To stay inside D1's write quota, expiry is only **extended when less than half of it remains**, not on every request. Cookie name/flags differ slightly in dev (`http://localhost`).

**Sign-up gate** (default; the app is not open to the world): a Google account may _create_ an account only if its email is in the `ALLOWED_EMAILS` setting (you, to bootstrap) **or** it arrives with a valid, unexpired group **invite token**. Existing users always sign in. This means a friend you invite to a group can join without you touching the server.

**What you need to set up in Google Cloud Console** (needed to start M1b; localhost works for development):

1. Create a project → _Google Auth Platform_ → configure the consent screen (External).
2. Scopes: only `openid`, `email`, `profile` (non-sensitive; no Google verification needed).
3. **Set publishing status to "In production".** In "Testing" the app is capped at 100 test users and consent expires after 7 days ([Google docs](https://support.google.com/cloud/answer/15549945)).
4. Create an OAuth client ID (type _Web application_). Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback` (dev, through the Vite proxy) and `https://group-budget.<your-subdomain>.workers.dev/api/auth/google/callback` (the free Cloudflare address; real projects use `workers.dev` callbacks with Google). When you buy a domain, add `https://<your-domain>/api/auth/google/callback` too. Google rejects bare IPs and non-public hostnames.
5. Store the credentials as Worker secrets: `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (locally they go in the gitignored `apps/server/.dev.vars`). Never in git.

**Known risk — installed iOS web app (the group uses iPhones, and installs the app from Chrome).** Every iOS browser, Chrome included, runs on Apple's WebKit. A home-screen web app, whether added from Chrome or Safari, gets its own cookies and IndexedDB, separate from the browser's tabs, and reports conflict on where a third-party OAuth redirect ends up: the app window, an in-app browser sheet, or the browser ([example thread](https://developer.apple.com/forums/thread/649699), [PocketBase discussion](https://github.com/pocketbase/pocketbase/discussions/2429)). If it ends up outside the app, the user signs in there but the installed app stays signed out. We can't control that, so sign-in is designed **not to depend on where the redirect lands**.

**Attempt-login (used only in standalone mode: `navigator.standalone` or `display-mode: standalone`; browser tabs, Android and desktop use the plain redirect above).** Like a TV sign-in, the installed app polls for its own login:

1. The app creates a random 256-bit `attempt_secret`, keeps it in its own IndexedDB (it survives the app being backgrounded while the user is in the sign-in sheet), and starts sign-in with `GET /api/auth/google/start?attempt=<sha256(secret)>`.
2. Google sign-in completes wherever iOS puts it: the app window, an in-app sheet, or Chrome. If it completes in the app window, the callback signs in normally and the attempt is cleaned up.
3. Otherwise, after the sign-up gate passes, the callback shows a **confirmation page**: "Finish signing in on your installed app? Continue only if you just tapped Sign in there." On Continue it binds the user to the attempt (`login_attempts`, [Data model](data-model.md)) with a 5-minute expiry. The page exists so a friend can't be tricked into approving someone else's attempt.
4. When the installed app regains focus (and on startup) it posts the secret to `POST /api/auth/attempt/redeem`. The server hashes it, finds a bound, unexpired, unconsumed attempt, marks it consumed (single use) and sets the session cookie in the app's own storage. The secret never leaves the device, so a leaked hash is useless.
5. Rate-limit `redeem` at Cloudflare ([Security](security.md)). A typed one-time code is **not** built; add it only if real devices show the polling path failing.

This is testable on desktop: two Playwright browser contexts (separate cookie jars) stand in for the installed app and the browser. What still needs a real iPhone is a confirmation run (in M1b), **using Chrome's "Add to Home Screen"**, to check the hand-back feels right. It is no longer a go/no-go spike. The Google Identity Services ID-token flow is not used: it needs third-party JavaScript, which breaks the strict CSP ([Security](security.md)).

**Not-installed guard.** In a plain iOS Chrome tab, service workers may be unavailable and WebKit caps script-writable storage at 7 days for sites that aren't installed ([MagicBell](https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies)), which could wipe an unsynced outbox. If the app is not installed (or `serviceWorker` is missing), show an "Install to your home screen for offline use" banner and warn before logout or when un-synced items are old. The group is told to install from Chrome (Share/menu → Add to Home Screen); installed web apps are exempt from the 7-day cap.

**Dev/test only**: a dev-login endpoint (for e2e and local work without Google credentials) exists only when `ENVIRONMENT` is not `production` **and** `ENABLE_DEV_LOGIN=1`. `ENVIRONMENT` defaults to `production`, so it can't be on by accident in a deployed Worker.
