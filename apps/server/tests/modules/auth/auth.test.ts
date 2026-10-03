import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  groups,
  invites,
  memberships,
  oauthStates,
  sessions,
  users,
} from '../../../src/db/schema';
import { saveOauthState } from '../../../src/modules/auth/repo';
import {
  Client,
  db,
  fakeIdToken,
  mockGoogleToken,
  resetDb,
  sha256Hex,
} from '../../support/helpers';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const location = (response: Response) =>
  new URL(response.headers.get('location') ?? '', 'http://localhost');

describe('GET /api/auth/config', () => {
  it('offers Google and dev login in the test environment', async () => {
    const response = await new Client().get('/api/auth/config');
    expect(await response.json()).toEqual({ google: true, devLogin: true });
  });

  it('offers neither dev login nor a missing Google in production', async () => {
    const production = new Client({ ENVIRONMENT: 'production', GOOGLE_CLIENT_ID: undefined });
    expect(await (await production.get('/api/auth/config')).json()).toEqual({
      google: false,
      devLogin: false,
    });
  });
});

describe('dev login', () => {
  it('signs a new person in and gives them a personal ledger with default categories', async () => {
    const client = new Client();
    const { user } = await client.signInAsDev('Alice@Example.com', 'Alice');
    expect(user).toMatchObject({ email: 'alice@example.com', displayName: 'Alice' });

    const me = await (await client.get('/api/me')).json();
    expect(me).toMatchObject({ user: { id: user.id } });

    const [group] = await db.select().from(groups).where(eq(groups.createdBy, user.id));
    expect(group).toMatchObject({ isPersonal: true, name: 'Personal' });
    expect((me as { personalGroupId: string }).personalGroupId).toBe(group?.id);
    expect(await db.select().from(memberships).where(eq(memberships.userId, user.id))).toHaveLength(
      1,
    );
    expect(
      await db
        .select()
        .from(categories)
        .where(eq(categories.groupId, group?.id ?? '')),
    ).toHaveLength(10);
  });

  it('gives every created row its own strictly increasing server_seq', async () => {
    await new Client().signInAsDev('alice@example.com');
    const seqs = [
      ...(await db.select({ s: groups.serverSeq }).from(groups)),
      ...(await db.select({ s: memberships.serverSeq }).from(memberships)),
      ...(await db.select({ s: categories.serverSeq }).from(categories)),
    ].map((row) => row.s);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.min(...seqs)).toBe(1);
    const [counter] = await env.DB.prepare('SELECT value FROM sync_counter')
      .all<{ value: number }>()
      .then((r) => r.results);
    expect(counter?.value).toBe(seqs.length);
  });

  it('reuses the account on the next sign-in instead of creating another', async () => {
    await new Client().signInAsDev('alice@example.com');
    await new Client().signInAsDev('alice@example.com');
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(groups)).toHaveLength(1);
  });

  it('is simply not there in production, even with the flag set', async () => {
    const client = new Client({ ENVIRONMENT: 'production', ENABLE_DEV_LOGIN: '1' });
    expect((await client.post('/api/auth/dev-login', { email: 'a@example.com' })).status).toBe(404);
    expect((await client.get('/api/auth/dev/idp?state=x')).status).toBe(404);
  });

  it('rejects a malformed email', async () => {
    expect((await new Client().post('/api/auth/dev-login', { email: 'nope' })).status).toBe(400);
  });
});

describe('sessions', () => {
  it('stores only a hash of the session token', async () => {
    const client = new Client();
    await client.signInAsDev('alice@example.com');
    const token = client.cookies.get('gb_session') ?? '';
    const [row] = await db.select().from(sessions);
    expect(row?.idHash).toBe(await sha256Hex(token));
    expect(row?.idHash).not.toContain(token);
  });

  it('401s without a session, and after logout', async () => {
    const client = new Client();
    expect((await client.get('/api/me')).status).toBe(401);

    await client.signInAsDev('alice@example.com');
    expect((await client.get('/api/me')).status).toBe(200);

    expect((await client.post('/api/auth/logout')).status).toBe(200);
    expect(client.cookies.has('gb_session')).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('ignores a session that has expired', async () => {
    const client = new Client();
    await client.signInAsDev('alice@example.com');
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await client.get('/api/me')).status).toBe(401);
  });

  it('extends a session only once less than half its life remains', async () => {
    const client = new Client();
    await client.signInAsDev('alice@example.com');
    const day = 24 * 60 * 60 * 1000;

    // 29 days left of 30: more than half remains, so no write.
    const fresh = new Date(Date.now() + 29 * day);
    await db.update(sessions).set({ expiresAt: fresh });
    const untouched = await client.get('/api/me');
    expect((await db.select().from(sessions))[0]?.expiresAt).toEqual(fresh);
    expect(untouched.headers.getSetCookie().join()).not.toContain('gb_session');

    // 10 days left: extended to a fresh 30 days, and the cookie is refreshed too.
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + 10 * day) });
    const refreshed = await client.get('/api/me');
    const [row] = await db.select().from(sessions);
    expect((row?.expiresAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(29 * day);
    expect(refreshed.headers.getSetCookie().join()).toContain('gb_session');
  });
});

describe('CSRF origin check', () => {
  it('refuses state-changing requests from another origin or with no Origin', async () => {
    const client = new Client();
    await client.signInAsDev('alice@example.com');
    const foreign = await client.post(
      '/api/auth/logout',
      {},
      { headers: { origin: 'https://evil.example' } },
    );
    expect(foreign.status).toBe(403);

    const bare = await client.request('/api/auth/logout', {
      method: 'POST',
      json: {},
      headers: { origin: '' },
    });
    expect(bare.status).toBe(403);
    expect((await client.get('/api/me')).status).toBe(200); // still signed in
  });
});

describe('Google sign-in', () => {
  async function start(client: Client, query = '') {
    const response = await client.get(`/api/auth/google/start${query}`);
    const target = location(response);
    return { response, target, state: target.searchParams.get('state') ?? '' };
  }

  it('sends the person to Google with PKCE, state, the right scopes and an account picker', async () => {
    const client = new Client();
    const { response, target, state } = await start(client);
    expect(response.status).toBe(302);
    expect(target.origin + target.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(target.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
    expect(target.searchParams.get('redirect_uri')).toBe(
      'http://localhost/api/auth/google/callback',
    );
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('code_challenge')).toBeTruthy();
    expect(target.searchParams.get('scope')).toBe('openid email profile');
    expect(target.searchParams.get('prompt')).toBe('select_account');
    expect(state.length).toBeGreaterThan(20);
    expect(client.cookies.get('gb_oauth')).toBe(state);
  });

  it('completes sign-in for an allowed email and lands on the app', async () => {
    const client = new Client();
    const { state } = await start(client);
    const exchange = mockGoogleToken(vi, fakeIdToken({}));

    const response = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(response.status).toBe(302);
    expect(location(response).pathname).toBe('/');
    expect(client.cookies.has('gb_session')).toBe(true);

    // The code was exchanged with the PKCE verifier, over Google's token endpoint.
    const [request] = exchange.mock.calls[0] ?? [];
    expect(String((request as Request).url)).toBe('https://oauth2.googleapis.com/token');
    const form = await (request as Request).clone().formData();
    expect(form.get('code')).toBe('abc');
    expect(form.get('code_verifier')).toBeTruthy();

    const me = (await (await client.get('/api/me')).json()) as {
      user: { email: string; displayName: string; avatarUrl: string };
    };
    expect(me.user).toMatchObject({ email: 'owner@example.com', displayName: 'Owner One' });
  });

  it('refuses to create an account for an email that is neither allowed nor invited', async () => {
    const client = new Client();
    const { state } = await start(client);
    mockGoogleToken(vi, fakeIdToken({ sub: 'stranger', email: 'stranger@example.com' }));

    const response = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(location(response).pathname + location(response).search).toBe(
      '/login?error=not_invited',
    );
    expect(client.cookies.has('gb_session')).toBe(false);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it('lets a stranger in with a valid invite and sends them to join the group', async () => {
    const owner = new Client();
    const { user } = await owner.signInAsDev('host@example.com');
    const [group] = await db.select().from(groups).where(eq(groups.createdBy, user.id));
    const token = 'invite-token-0123456789abcdef';
    await db.insert(invites).values({
      id: crypto.randomUUID(),
      tokenHash: await sha256Hex(token),
      groupId: group?.id ?? '',
      createdBy: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      maxUses: 5,
    });

    const guest = new Client();
    const { state } = await start(guest, `?invite=${token}`);
    mockGoogleToken(
      vi,
      fakeIdToken({ sub: 'guest-sub', email: 'guest@example.com', name: 'Guest' }),
    );
    const response = await guest.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(location(response).pathname).toBe(`/join/${token}`);
    expect(guest.cookies.has('gb_session')).toBe(true);
  });

  it('rejects an expired, revoked or used-up invite', async () => {
    const owner = new Client();
    const { user } = await owner.signInAsDev('host@example.com');
    const [group] = await db.select().from(groups).where(eq(groups.createdBy, user.id));
    const base = { groupId: group?.id ?? '', createdBy: user.id, createdAt: Date.now() };
    const cases = [
      { token: 'expired-invite-0123456789abc', row: { expiresAt: Date.now() - 1, maxUses: 5 } },
      {
        token: 'revoked-invite-0123456789abc',
        row: { expiresAt: Date.now() + 1e6, maxUses: 5, revokedAt: Date.now() },
      },
      {
        token: 'usedup-invite-0123456789abcd',
        row: { expiresAt: Date.now() + 1e6, maxUses: 1, usedCount: 1 },
      },
    ];
    for (const { token, row } of cases) {
      await db
        .insert(invites)
        .values({ id: crypto.randomUUID(), tokenHash: await sha256Hex(token), ...base, ...row });
      const guest = new Client();
      const { state } = await start(guest, `?invite=${token}`);
      mockGoogleToken(vi, fakeIdToken({ sub: `sub-${token}`, email: `${token}@example.com` }));
      const response = await guest.get(`/api/auth/google/callback?code=abc&state=${state}`);
      expect(location(response).search).toBe('?error=not_invited');
    }
  });

  it('lets an existing account back in without any gate', async () => {
    await new Client().signInAsDev('someone@example.com');
    const [existing] = await db.select().from(users);
    await db
      .update(users)
      .set({ googleSub: 'known-sub' })
      .where(eq(users.id, existing?.id ?? ''));

    const client = new Client();
    const { state } = await start(client);
    mockGoogleToken(vi, fakeIdToken({ sub: 'known-sub', email: 'someone@example.com' }));
    const response = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(location(response).pathname).toBe('/');
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('requires a verified email', async () => {
    const client = new Client();
    const { state } = await start(client);
    mockGoogleToken(vi, fakeIdToken({ email_verified: false }));
    const response = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(location(response).search).toBe('?error=email_not_verified');
  });

  it.each([
    ['another client id', { aud: 'someone-elses-client' }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['an expired token', { exp: 1 }],
  ])('rejects an ID token with %s', async (_label, claims) => {
    const client = new Client();
    const { state } = await start(client);
    mockGoogleToken(vi, fakeIdToken(claims));
    const response = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(location(response).search).toBe('?error=google_error');
  });

  it('reports a failed code exchange and a denied consent screen', async () => {
    const client = new Client();
    const { state } = await start(client);
    mockGoogleToken(vi, 'unused', 400);
    expect(
      location(await client.get(`/api/auth/google/callback?code=bad&state=${state}`)).search,
    ).toBe('?error=google_error');

    const second = await start(new Client());
    const denied = await new Client().get(
      `/api/auth/google/callback?error=access_denied&state=${second.state}`,
    );
    expect(location(denied).search).toBe('?error=access_denied');
  });

  it('accepts a state exactly once', async () => {
    const client = new Client();
    const { state } = await start(client);
    mockGoogleToken(vi, fakeIdToken({}));
    await client.get(`/api/auth/google/callback?code=abc&state=${state}`);

    const replay = await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(location(replay).search).toBe('?error=invalid_state');
  });

  it('rejects an unknown state, or a callback from a browser that did not start sign-in', async () => {
    const stranger = new Client();
    expect(
      location(await stranger.get('/api/auth/google/callback?code=abc&state=nope')).search,
    ).toBe('?error=invalid_state');

    // The real state, but arriving without the cookie and with no attempt: could be a login-CSRF.
    const victimStarted = new Client();
    const { state } = await start(victimStarted);
    mockGoogleToken(vi, fakeIdToken({}));
    const attacker = new Client();
    expect(
      location(await attacker.get(`/api/auth/google/callback?code=abc&state=${state}`)).search,
    ).toBe('?error=invalid_state');
    expect(attacker.cookies.has('gb_session')).toBe(false);
  });

  it('is unavailable when Google is not configured and dev login is off', async () => {
    const client = new Client({ ENVIRONMENT: 'production', GOOGLE_CLIENT_ID: undefined });
    expect((await client.get('/api/auth/google/start')).status).toBe(503);
  });

  it('validates the attempt and invite parameters', async () => {
    const client = new Client();
    expect((await client.get('/api/auth/google/start?attempt=short')).status).toBe(400);
    expect((await client.get('/api/auth/google/start?invite=x')).status).toBe(400);
  });
});

describe('attempt-login (installed app on iOS)', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'; // 43 url-safe characters
  let attemptHash: string;

  beforeEach(async () => {
    attemptHash = await sha256Hex(secret);
  });

  /** The installed app starts sign-in; Google finishes in a different browser (no cookies). */
  async function signInElsewhere(email = 'owner@example.com') {
    const app = new Client();
    const response = await app.get(`/api/auth/google/start?attempt=${attemptHash}`);
    const state = location(response).searchParams.get('state') ?? '';

    const browser = new Client(); // separate cookie jar, like Chrome next to the installed app
    mockGoogleToken(vi, fakeIdToken({ sub: `sub-${email}`, email }));
    const callback = await browser.get(`/api/auth/google/callback?code=abc&state=${state}`);
    return { app, browser, callback };
  }

  const tokenFrom = (html: string) => /name="token" value="([^"]+)"/.exec(html)?.[1] ?? '';

  it('hands the sign-in back to the app after the person confirms in the browser', async () => {
    const { app, browser, callback } = await signInElsewhere();

    // The browser is shown a confirmation page, not signed in.
    expect(callback.status).toBe(200);
    expect(callback.headers.get('content-security-policy')).toContain("default-src 'none'");
    // Not `no-referrer`: that makes a browser send `Origin: null` when this page's form posts back,
    // which the CSRF check would (rightly) refuse. Found by the end-to-end test in a real browser.
    expect(callback.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    const html = await callback.text();
    expect(html).toContain('Finish signing in on your installed app?');
    expect(browser.cookies.has('gb_session')).toBe(false);

    // Until they confirm, the app collects nothing.
    expect(await (await app.post('/api/auth/attempt/redeem', { secret })).json()).toEqual({
      status: 'pending',
    });

    const confirm = await browser.request('/api/auth/attempt/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token: tokenFrom(html) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(confirm.status).toBe(200);

    // Now the installed app redeems its secret and is signed in, in its own storage.
    const redeem = await app.post('/api/auth/attempt/redeem', { secret });
    expect(await redeem.json()).toEqual({ status: 'signed_in' });
    expect(app.cookies.has('gb_session')).toBe(true);
    expect(
      ((await (await app.get('/api/me')).json()) as { user: { email: string } }).user.email,
    ).toBe('owner@example.com');
    expect(browser.cookies.has('gb_session')).toBe(false);
  });

  it('can be redeemed only once', async () => {
    const { app, browser, callback } = await signInElsewhere();
    await browser.request('/api/auth/attempt/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token: tokenFrom(await callback.text()) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(await (await app.post('/api/auth/attempt/redeem', { secret })).json()).toEqual({
      status: 'signed_in',
    });
    expect(await (await new Client().post('/api/auth/attempt/redeem', { secret })).json()).toEqual({
      status: 'pending',
    });
  });

  it('is useless to anyone who only has the hash that travels through the browser', async () => {
    const { browser, callback } = await signInElsewhere();
    await browser.request('/api/auth/attempt/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token: tokenFrom(await callback.text()) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const thief = new Client();
    // The hash is not the secret; hashing it again (or sending it as the secret) gets nothing.
    expect(
      await (
        await thief.post('/api/auth/attempt/redeem', { secret: attemptHash.slice(0, 43) })
      ).json(),
    ).toEqual({ status: 'pending' });
    expect(thief.cookies.has('gb_session')).toBe(false);
  });

  it('expires if nobody confirms in time', async () => {
    const { app, browser, callback } = await signInElsewhere();
    await browser.request('/api/auth/attempt/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token: tokenFrom(await callback.text()) }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await env.DB.prepare('UPDATE login_attempts SET expires_at = ?')
      .bind(Date.now() - 1)
      .run();
    expect(await (await app.post('/api/auth/attempt/redeem', { secret })).json()).toEqual({
      status: 'pending',
    });
  });

  it('rejects a bad or reused confirmation token', async () => {
    const { browser, callback } = await signInElsewhere();
    const token = tokenFrom(await callback.text());
    const send = (value: string) =>
      browser.request('/api/auth/attempt/confirm', {
        method: 'POST',
        body: new URLSearchParams({ token: value }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
    expect((await send('x'.repeat(30))).status).toBe(400);
    expect((await send(token)).status).toBe(200);
    expect((await send(token)).status).toBe(400); // already confirmed
  });

  it('signs in directly when sign-in finishes in the app window itself', async () => {
    const app = new Client();
    const response = await app.get(`/api/auth/google/start?attempt=${attemptHash}`);
    const state = location(response).searchParams.get('state') ?? '';
    mockGoogleToken(vi, fakeIdToken({}));
    const callback = await app.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(callback.status).toBe(302);
    expect(app.cookies.has('gb_session')).toBe(true);
  });

  it('still applies the sign-up gate before offering a confirmation', async () => {
    const { callback } = await signInElsewhere('stranger@example.com');
    expect(callback.status).toBe(302);
    expect(location(callback).search).toBe('?error=not_invited');
  });

  it('rejects a malformed secret', async () => {
    expect((await new Client().post('/api/auth/attempt/redeem', { secret: 'short' })).status).toBe(
      400,
    );
    expect((await new Client().post('/api/auth/attempt/redeem', {})).status).toBe(400);
  });
});

describe('opening an invite from the installed app', () => {
  const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

  it('carries the invite through the hand-off, so the app can open the join page', async () => {
    const owner = new Client();
    const { user } = await owner.signInAsDev('host@example.com');
    const [group] = await db.select().from(groups).where(eq(groups.createdBy, user.id));
    const token = 'handoff-invite-0123456789abcdef';
    await db.insert(invites).values({
      id: crypto.randomUUID(),
      tokenHash: await sha256Hex(token),
      groupId: group?.id ?? '',
      createdBy: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      maxUses: 5,
    });

    // A brand-new person (allowed only by the invite) signs in from the installed app, and the
    // browser iOS opens completes it.
    const app = new Client();
    const attemptHash = await sha256Hex(secret);
    const start = await app.get(`/api/auth/google/start?attempt=${attemptHash}&invite=${token}`);
    const state = location(start).searchParams.get('state') ?? '';
    const browser = new Client();
    mockGoogleToken(
      vi,
      fakeIdToken({ sub: 'newcomer-sub', email: 'newcomer@example.com', name: 'New Comer' }),
    );
    const callback = await browser.get(`/api/auth/google/callback?code=abc&state=${state}`);
    const html = await callback.text();
    await browser.request('/api/auth/attempt/confirm', {
      method: 'POST',
      body: new URLSearchParams({ token: /name="token" value="([^"]+)"/.exec(html)?.[1] ?? '' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    const redeem = await app.post('/api/auth/attempt/redeem', { secret });
    expect(await redeem.json()).toEqual({ status: 'signed_in', invite: token });
    expect(app.cookies.has('gb_session')).toBe(true);
  });

  it('adds nothing when the person did not arrive through an invite', async () => {
    const app = new Client();
    const start = await app.get(`/api/auth/google/start?attempt=${await sha256Hex(secret)}`);
    const browser = new Client();
    mockGoogleToken(vi, fakeIdToken({}));
    const callback = await browser.get(
      `/api/auth/google/callback?code=abc&state=${location(start).searchParams.get('state')}`,
    );
    await browser.request('/api/auth/attempt/confirm', {
      method: 'POST',
      body: new URLSearchParams({
        token: /name="token" value="([^"]+)"/.exec(await callback.text())?.[1] ?? '',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(await (await app.post('/api/auth/attempt/redeem', { secret })).json()).toEqual({
      status: 'signed_in',
    });
  });
});

describe('the cost of an open endpoint', () => {
  it('writes exactly one row when a sign-in starts', async () => {
    const before = await db.select().from(oauthStates);
    await new Client().get('/api/auth/google/start');
    expect((await db.select().from(oauthStates)).length - before.length).toBe(1);
  });

  it('sweeps expired sign-in states when one completes, and when asked at start', async () => {
    const expired = (hash: string) => ({
      stateHash: hash,
      codeVerifier: 'v',
      createdAt: 1,
      expiresAt: 2,
    });
    await db.insert(oauthStates).values([expired('old-1'), expired('old-2')]);

    // Completing a sign-in cleans up.
    const client = new Client();
    const state =
      location(await client.get('/api/auth/google/start')).searchParams.get('state') ?? '';
    mockGoogleToken(vi, fakeIdToken({}));
    await client.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(await db.select().from(oauthStates)).toEqual([]);

    // Starting one with the sweep switched on cleans up too.
    await db.insert(oauthStates).values(expired('old-3'));
    await saveOauthState(
      db,
      'fresh-state',
      { codeVerifier: 'v', attemptHash: null, inviteToken: null },
      Date.now(),
      60_000,
      true,
    );
    expect((await db.select().from(oauthStates)).map((r) => r.stateHash)).toHaveLength(1);
  });
});

describe('dev stand-in for Google', () => {
  it('walks the same callback code: start → stand-in page → callback', async () => {
    const client = new Client({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    const start = await client.get('/api/auth/google/start');
    expect(location(start).pathname).toBe('/api/auth/dev/idp');
    const state = location(start).searchParams.get('state') ?? '';

    const page = await client.get(`/api/auth/dev/idp?state=${state}`);
    expect(await page.text()).toContain('Dev sign-in');

    const submit = await client.get(
      `/api/auth/dev/idp/submit?state=${state}&email=alice@example.com`,
    );
    expect(location(submit).pathname).toBe('/api/auth/google/callback');
    const callback = await client.get(`${location(submit).pathname}${location(submit).search}`);
    expect(location(callback).search).toBe('?error=not_invited'); // the gate applies here too

    const allowed = new Client({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    const again = await allowed.get('/api/auth/google/start');
    const state2 = location(again).searchParams.get('state') ?? '';
    const done = await allowed.get(
      `/api/auth/google/callback?state=${state2}&code=${encodeURIComponent('dev:owner@example.com')}`,
    );
    expect(location(done).pathname).toBe('/');
    expect(allowed.cookies.has('gb_session')).toBe(true);
  });
});
