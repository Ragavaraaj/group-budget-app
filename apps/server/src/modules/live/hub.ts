import { DurableObject } from 'cloudflare:workers';

/** What a device is told: something changed, go and pull. It carries no data. */
export const CHANGED_MESSAGE = JSON.stringify({ type: 'changed' });

/** Browser tabs one person may have connected at once; the oldest are closed beyond this. */
export const MAX_SOCKETS_PER_USER = 8;

const tagFor = (userId: string) => `u:${userId}`;

interface Attachment {
  /** Chosen by the device, so its own pushes don't wake it up again. */
  liveId: string;
}

/**
 * The live-updates hub: one Durable Object holds every connected device's WebSocket and, when
 * the Worker says some people's data changed, sends each of them a tiny "changed" message so
 * their app pulls straight away instead of waiting for the next poll.
 *
 * - It holds no data and decides nothing: it is told who to notify. It is reachable only through
 *   the Worker's binding, and the Worker has authenticated the person before connecting them.
 * - Sockets use the hibernation API, so while nothing is happening the object is evicted from
 *   memory and costs nothing; the "ping" keep-alive is answered without waking it.
 * - A single instance serves everyone, which is plenty for tens of people (the app is built for
 *   50 to 100). Going beyond that means sharding by group; see docs/sync.md.
 */
export class LiveHub extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket', { status: 426 });
      }
      const userId = url.searchParams.get('user');
      if (!userId) return new Response('Missing user', { status: 400 });

      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      const attachment: Attachment = { liveId: url.searchParams.get('id') ?? '' };
      this.ctx.acceptWebSocket(server, [tagFor(userId)]);
      server.serializeAttachment(attachment);

      // Keep the newest few tabs; getWebSockets lists in the order they were accepted.
      const open = this.ctx.getWebSockets(tagFor(userId));
      for (const old of open.slice(0, Math.max(0, open.length - MAX_SOCKETS_PER_USER))) {
        old.close(1008, 'too many connections');
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        users?: unknown;
        exclude?: unknown;
      } | null;
      if (!body || !Array.isArray(body.users)) return new Response('Bad request', { status: 400 });
      const exclude = typeof body.exclude === 'string' && body.exclude !== '' ? body.exclude : null;

      let sent = 0;
      for (const userId of new Set(body.users.filter((u): u is string => typeof u === 'string'))) {
        for (const socket of this.ctx.getWebSockets(tagFor(userId))) {
          if (
            exclude !== null &&
            (socket.deserializeAttachment() as Attachment)?.liveId === exclude
          ) {
            continue;
          }
          try {
            socket.send(CHANGED_MESSAGE);
            sent += 1;
          } catch {
            // A socket that is already closing; the device reconnects and catches up by pulling.
          }
        }
      }
      return Response.json({ sent });
    }

    return new Response('Not found', { status: 404 });
  }

  override webSocketMessage(): void {
    // Devices only ping, and that is answered automatically. Anything else is ignored.
  }

  override webSocketClose(socket: WebSocket, code: number): void {
    // 1005 and 1006 are "no code" markers that can't be sent back.
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, 'closing');
    } catch {
      // Already closed.
    }
  }
}
