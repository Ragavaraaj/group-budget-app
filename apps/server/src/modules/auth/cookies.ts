import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../../app';

export const SESSION_COOKIE = 'gb_session';
export const OAUTH_COOKIE = 'gb_oauth';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_TTL_MS = 10 * 60 * 1000;

type C = Context<AppEnv>;

// Production is HTTPS only, so cookies are Secure there. Local development is plain http.
const base = (c: C) => ({
  httpOnly: true,
  secure: c.get('config').isProduction,
  sameSite: 'Lax' as const,
});

export function setSessionCookie(c: C, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    ...base(c),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: C): void {
  deleteCookie(c, SESSION_COOKIE, { ...base(c), path: '/' });
}

export function getSessionToken(c: C): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** Proves the callback is happening in the same browser that started sign-in. */
export function setOauthCookie(c: C, state: string): void {
  setCookie(c, OAUTH_COOKIE, state, {
    ...base(c),
    path: '/api/auth',
    maxAge: OAUTH_TTL_MS / 1000,
  });
}

export function getOauthCookie(c: C): string | undefined {
  return getCookie(c, OAUTH_COOKIE);
}

export function clearOauthCookie(c: C): void {
  deleteCookie(c, OAUTH_COOKIE, { ...base(c), path: '/api/auth' });
}
