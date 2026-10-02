import { parse } from 'hono/utils/cookie';
import { createDb } from '../../db/client';
import { SESSION_COOKIE } from '../auth/cookies';
import { findSession } from '../auth/repo';
import { hubStub, LIVE_ID } from './notify';

/**
 * `GET /api/live?id=<device connection id>`: the WebSocket the app keeps open for live updates.
 * Handled before the Hono app because a WebSocket response has to leave the Worker untouched
 * (middleware that rebuilds a response would lose the socket).
 *
 * The person is checked here, then handed to the hub. Two checks guard against another website
 * making the browser open this connection with the person's cookies: the session cookie is
 * `SameSite=Lax`, which browsers don't send on a cross-site WebSocket, and the `Origin` header
 * must be ours.
 */
export async function handleLive(request: Request, env: Cloudflare.Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'expected_websocket' }, { status: 426 });
  }
  if (request.headers.get('Origin') !== url.origin) {
    return Response.json({ error: 'bad_origin' }, { status: 403 });
  }

  const liveId = url.searchParams.get('id') ?? '';
  if (!LIVE_ID.test(liveId)) return Response.json({ error: 'invalid_request' }, { status: 400 });

  const token = parse(request.headers.get('Cookie') ?? '')[SESSION_COOKIE];
  const found = token ? await findSession(createDb(env.DB), token, Date.now()) : null;
  if (!found) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URLSearchParams({ user: found.user.id, id: liveId });
  return hubStub(env).fetch(`https://hub/connect?${params}`, {
    headers: { Upgrade: 'websocket' },
  });
}
