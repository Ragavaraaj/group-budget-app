import { env } from 'cloudflare:workers';
import { createApp } from '../src/app';
import { createDb } from '../src/db/client';

export const ORIGIN = 'http://localhost';
export const db = createDb(env.DB);

const app = createApp();

type EnvOverrides = Record<string, string | undefined>;

/**
 * A browser stand-in: keeps cookies between requests, sends a same-origin `Origin` header on
 * anything that isn't a GET, and calls the real Hono app inside workerd.
 */
export class Client {
  readonly cookies = new Map<string, string>();

  constructor(private readonly overrides: EnvOverrides = {}) {}

  async request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const { json, ...rest } = init;
    const method = (rest.method ?? (json === undefined ? 'GET' : 'POST')).toUpperCase();
    const headers = new Headers(rest.headers);
    if (method !== 'GET' && method !== 'HEAD' && !headers.has('origin')) {
      headers.set('origin', ORIGIN);
    }
    if (json !== undefined) headers.set('content-type', 'application/json');
    if (this.cookies.size > 0 && !headers.has('cookie')) {
      headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    }

    const response = await app.request(
      `${ORIGIN}${path}`,
      {
        ...rest,
        method,
        headers,
        body: json === undefined ? rest.body : JSON.stringify(json),
        redirect: 'manual',
      },
      { ...env, ...this.overrides },
    );
    this.absorbCookies(response);
    return response;
  }

  get(path: string, init?: RequestInit) {
    return this.request(path, { ...init, method: 'GET' });
  }

  post(path: string, json?: unknown, init?: RequestInit) {
    return this.request(path, { ...init, method: 'POST', json: json ?? {} });
  }

  private absorbCookies(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const [name = '', value = ''] = pair.split('=');
      const expired = attrs.some((a) => /^\s*(max-age=0|expires=.*1970)/i.test(a));
      if (expired || value === '') this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.trim());
    }
  }

  async signInAsDev(email: string, name?: string) {
    const response = await this.post('/api/auth/dev-login', { email, name });
    if (response.status !== 200) throw new Error(`dev login failed: ${response.status}`);
    return (await response.json()) as { user: { id: string; email: string; displayName: string } };
  }
}

const TABLES = [
  'audit_log',
  'processed_mutations',
  'budgets',
  'recurring_rules',
  'expenses',
  'settlements',
  'categories',
  'memberships',
  'invites',
  'groups',
  'sessions',
  'login_attempts',
  'oauth_states',
  'users',
];

/** Empties every table (children before parents) and restarts the change counter. */
export async function resetDb() {
  await env.DB.batch([
    ...TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    env.DB.prepare('UPDATE sync_counter SET value = 0 WHERE id = 1'),
  ]);
}

export const sha256Hex = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');

const b64url = (value: string) =>
  btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/** An unsigned ID token like the one Google's token endpoint returns. */
export function fakeIdToken(claims: Record<string, unknown>, clientId = env.GOOGLE_CLIENT_ID) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: clientId,
    exp: now + 3600,
    iat: now,
    sub: 'google-sub-1',
    email: 'owner@example.com',
    email_verified: true,
    name: 'Owner One',
    picture: 'https://lh3.googleusercontent.com/a/photo',
    ...claims,
  };
  return `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.sig`;
}

/** Makes Google's token endpoint answer with the given ID token. */
export function mockGoogleToken(
  vi: { spyOn: typeof import('vitest').vi.spyOn },
  idToken: string,
  status = 200,
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    status === 200
      ? new Response(
          JSON.stringify({
            access_token: 'access',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idToken,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      : new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
  );
}
