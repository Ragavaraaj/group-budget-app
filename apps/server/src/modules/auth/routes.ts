import {
  type AuthConfigResponse,
  attemptHashSchema,
  attemptRedeemRequestSchema,
  devLoginRequestSchema,
} from '@budget/shared';
import { generateCodeVerifier, generateState } from 'arctic';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import { findUsableInvite } from '../groups/repo';
import {
  clearOauthCookie,
  clearSessionCookie,
  getOauthCookie,
  getSessionToken,
  OAUTH_TTL_MS,
  setOauthCookie,
  setSessionCookie,
} from './cookies';
import {
  createGoogleClient,
  devIdentity,
  exchangeGoogleCode,
  GOOGLE_SCOPES,
  identityFromDevCode,
  SignInError,
  type SignInErrorCode,
} from './google';
import { confirmPage, devIdpPage, messagePage, PAGE_CSP } from './pages';
import {
  bindAttempt,
  confirmAttempt,
  consumeOauthState,
  createSession,
  deleteSession,
  findUserBySub,
  type Identity,
  provisionUser,
  recordLogin,
  redeemAttempt,
  saveOauthState,
  type UserRecord,
} from './repo';
import { constantTimeEqual, randomToken, sha256Hex } from './tokens';

const INVITE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** `/api/auth/*`: sign-in, the installed-app hand-back, and logout. See docs/auth.md. */
export function authRoutes() {
  const auth = new Hono<AppEnv>();

  /** What the login screen may offer. */
  auth.get('/config', (c) => {
    const { google, devLogin } = c.get('config');
    const body: AuthConfigResponse = { google: google !== null || devLogin, devLogin };
    return c.json(body);
  });

  // 1. The browser (or the installed app) is sent here by the "Continue with Google" button.
  auth.get('/google/start', async (c) => {
    const config = c.get('config');
    if (!config.google && !config.devLogin) {
      return c.json({ error: 'google_not_configured' }, 503);
    }

    const attempt = c.req.query('attempt');
    if (attempt !== undefined && !attemptHashSchema.safeParse(attempt).success) {
      return c.json({ error: 'invalid_attempt' }, 400);
    }
    const invite = c.req.query('invite');
    if (invite !== undefined && !INVITE_TOKEN.test(invite)) {
      return c.json({ error: 'invalid_invite' }, 400);
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    await saveOauthState(
      c.get('db'),
      state,
      { codeVerifier, attemptHash: attempt ?? null, inviteToken: invite ?? null },
      Date.now(),
      OAUTH_TTL_MS,
    );
    setOauthCookie(c, state);

    if (!config.google) {
      return c.redirect(`/api/auth/dev/idp?state=${encodeURIComponent(state)}`);
    }
    const url = createGoogleClient(config.google, new URL(c.req.url).origin).createAuthorizationURL(
      state,
      codeVerifier,
      GOOGLE_SCOPES,
    );
    url.searchParams.set('prompt', 'select_account'); // phones are shared; always ask which account
    return c.redirect(url.toString());
  });

  // 2. Google (or the dev stand-in) sends the person back here.
  auth.get('/google/callback', async (c) => {
    const config = c.get('config');
    const db = c.get('db');
    const now = Date.now();

    const fail = (code: SignInErrorCode) => {
      clearOauthCookie(c);
      return c.redirect(`/login?error=${code}`);
    };

    const state = c.req.query('state');
    if (!state) return fail('invalid_state');
    const stored = await consumeOauthState(db, state, now);
    if (!stored) return fail('invalid_state');

    const code = c.req.query('code');
    if (c.req.query('error') || !code) {
      return fail(c.req.query('error') === 'access_denied' ? 'access_denied' : 'google_error');
    }

    // The cookie proves this is the browser that started sign-in. Without it the only legitimate
    // case is the installed app handing over to a browser (attempt-login); anything else could
    // be someone steering a victim into signing in as the attacker.
    const sameBrowser = constantTimeEqual(getOauthCookie(c) ?? '', state);
    if (!sameBrowser && !stored.attemptHash) return fail('invalid_state');

    let identity: Identity;
    try {
      const fromDevCode = config.devLogin ? identityFromDevCode(code) : null;
      if (fromDevCode) identity = fromDevCode;
      else if (config.google) {
        const google = createGoogleClient(config.google, new URL(c.req.url).origin);
        identity = await exchangeGoogleCode(
          google,
          config.google.clientId,
          code,
          stored.codeVerifier,
          now,
        );
      } else return fail('google_error');
    } catch (error) {
      if (error instanceof SignInError) return fail(error.code);
      throw error;
    }

    // Existing accounts always get in; new ones need an allowed email or a valid invite.
    let user: UserRecord;
    const existing = await findUserBySub(db, identity.sub);
    if (existing) {
      user = await recordLogin(db, existing, identity, now);
    } else {
      const allowed =
        config.allowedEmails.includes(identity.email) ||
        (stored.inviteToken !== null &&
          (await findUsableInvite(db, await sha256Hex(stored.inviteToken), now)) !== null);
      if (!allowed) return fail('not_invited');
      user = await createUserOrFindWinner(c.get('db'), identity, now);
    }

    clearOauthCookie(c);

    if (!sameBrowser && stored.attemptHash) {
      const confirmToken = randomToken();
      await bindAttempt(db, stored.attemptHash, user.id, confirmToken, stored.inviteToken, now);
      return c.html(confirmPage(confirmToken), 200, { 'Content-Security-Policy': PAGE_CSP });
    }

    const session = await createSession(db, user.id, c.req.header('user-agent'), now);
    setSessionCookie(c, session.token, session.expiresAt);
    return c.redirect(stored.inviteToken ? `/join/${stored.inviteToken}` : '/');
  });

  // 3. The person confirmed, on the page the callback showed in the browser.
  auth.post('/attempt/confirm', async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const token = typeof body.token === 'string' ? body.token : '';
    const ok = token.length >= 20 && (await confirmAttempt(c.get('db'), token, Date.now()));
    const page = ok
      ? messagePage(
          'You’re signed in',
          'Go back to the Group Budget app. It finishes signing in by itself.',
        )
      : messagePage('This link has expired', 'Go back to the app and tap “Sign in” again.');
    return c.html(page, ok ? 200 : 400, { 'Content-Security-Policy': PAGE_CSP });
  });

  // 4. The installed app collects its sign-in with the secret only it knows.
  auth.post('/attempt/redeem', async (c) => {
    const parsed = attemptRedeemRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const db = c.get('db');
    const now = Date.now();
    const redeemed = await redeemAttempt(db, parsed.data.secret, now);
    if (!redeemed) return c.json({ status: 'pending' as const });

    const session = await createSession(db, redeemed.userId, c.req.header('user-agent'), now);
    setSessionCookie(c, session.token, session.expiresAt);
    // The invite (if the person arrived through one) lets the app open the join page next.
    return c.json({
      status: 'signed_in' as const,
      ...(redeemed.inviteToken ? { invite: redeemed.inviteToken } : {}),
    });
  });

  auth.post('/logout', async (c) => {
    const token = getSessionToken(c);
    if (token) await deleteSession(c.get('db'), token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  // --- development and tests only: a stand-in for Google, and a one-step sign-in ---------------

  auth.get('/dev/idp', (c) => {
    if (!c.get('config').devLogin) return c.json({ error: 'not_found' }, 404);
    return c.html(devIdpPage(c.req.query('state') ?? ''), 200, {
      'Content-Security-Policy': PAGE_CSP,
    });
  });

  auth.get('/dev/idp/submit', (c) => {
    if (!c.get('config').devLogin) return c.json({ error: 'not_found' }, 404);
    const state = c.req.query('state') ?? '';
    const email = c.req.query('email') ?? '';
    return c.redirect(
      `/api/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`dev:${email}`)}`,
    );
  });

  auth.post('/dev-login', async (c) => {
    if (!c.get('config').devLogin) return c.json({ error: 'not_found' }, 404);
    const parsed = devLoginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const db = c.get('db');
    const now = Date.now();
    const identity = devIdentity(parsed.data.email, parsed.data.name);
    const existing = await findUserBySub(db, identity.sub);
    const user = existing
      ? await recordLogin(db, existing, identity, now)
      : await createUserOrFindWinner(db, identity, now);

    const session = await createSession(db, user.id, c.req.header('user-agent'), now);
    setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ user });
  });

  return auth;
}

/**
 * Two first sign-ins for the same Google account at once: one insert wins, the other violates
 * the unique constraint and rolls back. The loser simply picks up the winner's account.
 */
async function createUserOrFindWinner(
  db: Parameters<typeof provisionUser>[0],
  identity: Identity,
  now: number,
): Promise<UserRecord> {
  try {
    return await provisionUser(db, identity, now);
  } catch (error) {
    const winner = await findUserBySub(db, identity.sub);
    if (!winner) throw error;
    return winner;
  }
}
