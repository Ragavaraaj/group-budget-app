import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveChannel, type LiveSocket } from './live';

class FakeSocket implements LiveSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  closed: { code?: number } | null = null;
  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, listener: (event: never) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closed = { code };
    this.readyState = 3;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  message(data: string) {
    this.emit('message', { data });
  }
  drop() {
    this.readyState = 3;
    this.emit('close', {});
  }
  private emit(type: string, event: object) {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

let changed = 0;
let connections: boolean[] = [];
let allowed = true;

function channel() {
  return new LiveChannel({
    onChanged: () => {
      changed++;
    },
    onConnection: (connected) => {
      connections.push(connected);
    },
    canConnect: () => allowed,
    createSocket: (url) => new FakeSocket(url),
    random: () => 1, // no jitter: delays are exactly the backoff
    location: { protocol: 'https:', host: 'budget.example' },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // The tests run in Node, so stand in for the page: it is only an event source with a visibility.
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  FakeSocket.all = [];
  changed = 0;
  connections = [];
  allowed = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setVisibility = (state: 'visible' | 'hidden') => {
  (document as unknown as { visibilityState: string }).visibilityState = state;
  document.dispatchEvent(new Event('visibilitychange'));
};

const last = () => FakeSocket.all.at(-1) as FakeSocket;

describe('LiveChannel', () => {
  it('connects to the server, naming itself, over wss for an https page', () => {
    const live = channel();
    live.start();
    expect(last().url).toBe(`wss://budget.example/api/live?id=${live.id}`);
    expect(live.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    live.stop();
  });

  it('uses ws on plain http (local development)', () => {
    const live = new LiveChannel({
      onChanged: () => undefined,
      onConnection: () => undefined,
      canConnect: () => true,
      createSocket: (url) => new FakeSocket(url),
      location: { protocol: 'http:', host: 'localhost:8787' },
    });
    live.start();
    expect(last().url.startsWith('ws://localhost:8787/api/live?id=')).toBe(true);
    live.stop();
  });

  it('reports being connected once the socket opens, and asks for a pull on "changed"', () => {
    const live = channel();
    live.start();
    expect(live.isConnected).toBe(false);
    last().open();
    expect(live.isConnected).toBe(true);
    expect(connections).toEqual([true]);

    last().message('{"type":"changed"}');
    last().message('pong');
    last().message('garbage {');
    last().message('{"type":"something-else"}');
    expect(changed).toBe(1);
    live.stop();
  });

  it('does not connect when it should not (signed out, offline, hidden)', () => {
    allowed = false;
    const live = channel();
    live.start();
    expect(FakeSocket.all).toHaveLength(0);
    live.stop();
  });

  it('reconnects after a drop, backing off 1 s, 2 s, 4 s and so on up to a minute', () => {
    const live = channel();
    live.start();
    last().open();
    last().drop();
    expect(connections).toEqual([true, false]);
    expect(FakeSocket.all).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);

    // The second attempt fails before opening: the wait doubles.
    last().drop();
    vi.advanceTimersByTime(1_999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);

    for (let i = 0; i < 10; i++) {
      last().drop();
      vi.advanceTimersByTime(60_000);
    }
    expect(FakeSocket.all.length).toBeGreaterThan(5);
    live.stop();
  });

  it('starts the backoff over once a connection has worked', () => {
    const live = channel();
    live.start();
    last().drop();
    vi.advanceTimersByTime(1_000);
    last().drop();
    vi.advanceTimersByTime(2_000);
    last().open(); // worked this time
    last().drop();
    vi.advanceTimersByTime(1_000); // back to the short wait
    expect(FakeSocket.all).toHaveLength(4);
    live.stop();
  });

  it('pings every 30 s and gives up on a connection that stops answering', () => {
    const live = channel();
    live.start();
    last().open();

    vi.advanceTimersByTime(30_000);
    expect(last().sent).toEqual(['ping']);

    // Silence: after 20 s the connection is dropped and a new one follows.
    const first = last();
    vi.advanceTimersByTime(20_000);
    expect(first.closed?.code).toBe(4000);
    expect(live.isConnected).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    live.stop();
  });

  it('keeps a connection that answers', () => {
    const live = channel();
    live.start();
    last().open();
    // Every ping is answered, for two minutes.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(30_000);
      last().message('pong');
    }
    vi.advanceTimersByTime(10_000);
    expect(live.isConnected).toBe(true);
    expect(FakeSocket.all).toHaveLength(1);
    live.stop();
  });

  it('closes cleanly when the app goes to the background and reconnects when it returns', () => {
    const live = channel();
    live.start();
    const first = last();
    first.open();

    setVisibility('hidden');
    expect(first.closed?.code).toBe(1000);
    expect(live.isConnected).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1); // nothing while hidden

    setVisibility('visible');
    expect(FakeSocket.all).toHaveLength(2);
    live.stop();
  });

  it('closes when offline and reconnects when the connection returns', () => {
    const live = channel();
    live.start();
    last().open();
    window.dispatchEvent(new Event('offline'));
    expect(live.isConnected).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.all).toHaveLength(2);
    live.stop();
  });

  it('stops for good: no more sockets, and listeners removed', () => {
    const live = channel();
    live.start();
    last().open();
    live.stop();
    expect(last().closed?.code).toBe(1000);
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(300_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('ignores a late event from a socket it has already replaced', () => {
    const live = channel();
    live.start();
    const old = last();
    old.open();
    old.drop();
    vi.advanceTimersByTime(1_000);
    const fresh = last();
    old.message('{"type":"changed"}');
    expect(changed).toBe(0);
    fresh.open();
    fresh.message('{"type":"changed"}');
    expect(changed).toBe(1);
    live.stop();
  });
});
