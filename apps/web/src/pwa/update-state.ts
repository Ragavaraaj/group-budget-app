/**
 * Whether a newer version of the app has been downloaded and is waiting to take over. Set when the
 * browser says so, whatever then happens to the "new version" message (which can be dismissed),
 * so Settings can still tell the person.
 */
let ready = false;
const listeners = new Set<() => void>();

export const updateReady = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): boolean => ready,
  /** A newer version is waiting. It stays so until the page reloads onto it. */
  markReady(): void {
    if (ready) return;
    ready = true;
    for (const listener of listeners) listener();
  },
};
