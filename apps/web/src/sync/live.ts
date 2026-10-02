import { randomToken } from '@budget/shared';

/**
 * The live connection to the server: a WebSocket that says "something changed" so the app pulls
 * at once instead of waiting for the next poll. It is an optimisation only. Polling still runs
 * (slowly) underneath, so if the connection can't be made (an old browser, a network that
 * blocks WebSockets) or drops, the app carries on exactly as before.
 */

export interface LiveOptions {
  /** The server said something changed. */
  onChanged(): void;
  /** The connection came up or went down. */
  onConnection(connected: boolean): void;
  /** Whether it is worth being connected right now (signed in, online, app in front). */
  canConnect(): boolean;
  /** Test seams. */
  createSocket?: (url: string) => LiveSocket;
  random?: () => number;
  location?: { protocol: string; host: string };
}

export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: never) => void): void;
}

const OPEN = 1;
/** A socket that has not opened by now never will (a proxy that doesn't pass WebSockets on). */
const CONNECT_WITHIN_MS = 10_000;
/** Sent by the server when this person already has too many connections open. */
const CLOSE_POLICY = 1008;
const PING_EVERY_MS = 30_000;
/** A ping with no answer (not even a pong) for this long means the connection is dead. */
const PONG_WITHIN_MS = 20_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export class LiveChannel {
  /** Names this connection to the server, which leaves it out of the notifications for its own pushes. */
  readonly id = randomToken(12);

  private readonly options: LiveOptions;
  private socket: LiveSocket | null = null;
  private connected = false;
  private started = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LiveOptions) {
    this.options = options;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.onWake);
    window.addEventListener('offline', this.onSleep);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.connect();
  }

  stop(): void {
    this.started = false;
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('offline', this.onSleep);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearReconnect();
    this.teardown(1000);
  }

  /** Connects if allowed and not already connected or connecting. */
  connect(): void {
    if (!this.started || this.socket || !this.options.canConnect()) return;
    this.clearReconnect();

    const where = this.options.location ?? window.location;
    const scheme = where.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${where.host}/api/live?id=${encodeURIComponent(this.id)}`;

    let socket: LiveSocket;
    try {
      socket = (this.options.createSocket ?? ((u) => new WebSocket(u) as unknown as LiveSocket))(
        url,
      );
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.socket !== socket || this.connected) return;
      this.teardown(4001);
      this.scheduleReconnect();
    }, CONNECT_WITHIN_MS);

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.attempts = 0;
      this.setConnected(true);
      this.startHeartbeat(socket);
    });
    socket.addEventListener('message', ((event: { data: unknown }) => {
      if (this.socket !== socket) return;
      this.heardFromServer();
      if (typeof event.data !== 'string') return;
      try {
        if ((JSON.parse(event.data) as { type?: unknown }).type === 'changed') {
          this.options.onChanged();
        }
      } catch {
        // "pong", or something we don't know: nothing to do.
      }
    }) as (event: never) => void);
    const closed = (event?: { code?: number }) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearConnectTimer();
      this.stopHeartbeat();
      this.setConnected(false);
      // Closed because this person has too many connections open: coming straight back would
      // close another one of theirs, which would come back and close the next, for as long as
      // the windows stay open. So wait to be woken (the app returning to the front, or the
      // network returning), when this connection is wanted again.
      if (event?.code === CLOSE_POLICY) return;
      this.scheduleReconnect();
    };
    socket.addEventListener('close', closed as (event: never) => void);
    socket.addEventListener('error', closed as (event: never) => void);
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.options.onConnection(connected);
  }

  /** Close the connection and forget it without scheduling a reconnect. */
  private teardown(code: number) {
    const socket = this.socket;
    this.socket = null;
    this.clearConnectTimer();
    this.stopHeartbeat();
    try {
      socket?.close(code, 'closing');
    } catch {
      // Already closed.
    }
    this.setConnected(false);
  }

  private scheduleReconnect() {
    if (!this.started || this.reconnectTimer) return;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** this.attempts);
    this.attempts += 1;
    // Spread reconnects out so a server restart doesn't bring everyone back at the same instant.
    const delay = base * (0.5 + (this.options.random ?? Math.random)() / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  // --- keeping the connection honest ------------------------------------------------------------

  private startHeartbeat(socket: LiveSocket) {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (socket.readyState !== OPEN) return;
      try {
        socket.send('ping');
      } catch {
        return;
      }
      if (!this.pongTimer) {
        this.pongTimer = setTimeout(() => {
          // No answer: a phone that went through a tunnel leaves a connection that looks open.
          this.pongTimer = null;
          if (this.socket === socket) {
            this.teardown(4000);
            this.scheduleReconnect();
          }
        }, PONG_WITHIN_MS);
      }
    }, PING_EVERY_MS);
  }

  private heardFromServer() {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  // --- the app going to the background, offline, and back ----------------------------------------

  private readonly onWake = () => {
    this.attempts = 0;
    this.connect();
  };
  private readonly onSleep = () => {
    this.clearReconnect();
    this.teardown(1000);
  };
  private readonly onVisibility = () => {
    // A hidden app has its sockets killed by the OS anyway (iOS especially); closing cleanly
    // saves the server noticing later, and coming back reconnects at once.
    if (document.visibilityState === 'visible') this.onWake();
    else this.onSleep();
  };
}
