import { describe, expect, it, vi } from 'vitest';
import { trackInteraction } from './interaction';

const STARTED_BY = ['pointerdown', 'touchstart', 'keydown', 'click', 'input', 'change', 'paste'];

describe('has the person started using the app', () => {
  it('says no until one of the things that mean it happens', () => {
    const page = new EventTarget();
    const started = trackInteraction(page);
    expect(started()).toBe(false);
    page.dispatchEvent(new Event('scroll'));
    page.dispatchEvent(new Event('visibilitychange'));
    page.dispatchEvent(new Event('focusin')); // a field focused by the page itself is not use
    expect(started()).toBe(false);
  });

  it.each(STARTED_BY)('says yes after a %s', (type) => {
    const page = new EventTarget();
    const started = trackInteraction(page);
    page.dispatchEvent(new Event(type));
    expect(started()).toBe(true);
  });

  it('listens in the capture phase, so a handler that stops the event cannot hide it', () => {
    // A bare EventTarget has no ancestors to tell capture from bubble, so what is registered is
    // checked: the window must see the event before anything below it can stop it.
    const addEventListener = vi.fn();
    trackInteraction({ addEventListener } as unknown as EventTarget);
    const registered = addEventListener.mock.calls.map(([type]) => type).sort();
    expect(registered).toEqual([...STARTED_BY].sort());
    for (const [, , options] of addEventListener.mock.calls) {
      expect(options).toMatchObject({ capture: true });
    }
  });
});
