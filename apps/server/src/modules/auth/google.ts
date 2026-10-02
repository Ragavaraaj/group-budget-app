import { decodeIdToken, Google } from 'arctic';
import type { Config } from '../../config';
import type { Identity } from './repo';

/** Why a sign-in was refused; the login page shows a friendly message for each. */
export type SignInErrorCode =
  | 'google_error'
  | 'email_not_verified'
  | 'not_invited'
  | 'invalid_state'
  | 'access_denied';

export class SignInError extends Error {
  constructor(readonly code: SignInErrorCode) {
    super(code);
  }
}

export const GOOGLE_SCOPES = ['openid', 'email', 'profile'];

export function createGoogleClient(google: NonNullable<Config['google']>, origin: string): Google {
  return new Google(google.clientId, google.clientSecret, `${origin}/api/auth/google/callback`);
}

interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * Reads the identity out of Google's ID token. The token comes straight from Google's token
 * endpoint over TLS in answer to our own authenticated request, so (as the OIDC spec allows for
 * the code flow) it is not signature-checked, but its issuer, audience, expiry and verified
 * email are.
 */
export function identityFromIdToken(idToken: string, clientId: string, now: number): Identity {
  let claims: IdTokenClaims;
  try {
    claims = decodeIdToken(idToken) as IdTokenClaims;
  } catch {
    throw new SignInError('google_error');
  }

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const valid =
    typeof claims.iss === 'string' &&
    GOOGLE_ISSUERS.has(claims.iss) &&
    audience.includes(clientId) &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > now &&
    typeof claims.sub === 'string' &&
    claims.sub !== '' &&
    typeof claims.email === 'string';
  if (!valid) throw new SignInError('google_error');
  if (claims.email_verified !== true) throw new SignInError('email_not_verified');

  const email = (claims.email as string).toLowerCase();
  return {
    sub: claims.sub as string,
    email,
    name:
      typeof claims.name === 'string' && claims.name.trim() !== ''
        ? claims.name.trim().slice(0, 100)
        : email.split('@')[0] || 'Member',
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}

/** Exchanges the authorization code (with PKCE) for the person's identity. */
export async function exchangeGoogleCode(
  google: Google,
  clientId: string,
  code: string,
  codeVerifier: string,
  now: number,
): Promise<Identity> {
  let idToken: string;
  try {
    idToken = (await google.validateAuthorizationCode(code, codeVerifier)).idToken();
  } catch {
    throw new SignInError('google_error');
  }
  return identityFromIdToken(idToken, clientId, now);
}

/** Dev sign-in: the "code" is `dev:<email>`. Only reachable when `config.devLogin` is on. */
export function identityFromDevCode(code: string): Identity | null {
  if (!code.startsWith('dev:')) return null;
  const email = code.slice(4).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  return { sub: `dev:${email}`, email, name: email.split('@')[0] ?? email, picture: null };
}
