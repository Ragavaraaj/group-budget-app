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
  set(value: boolean): void {
    if (ready === value) return;
    ready = value;
    for (const listener of listeners) listener();
  },
};
