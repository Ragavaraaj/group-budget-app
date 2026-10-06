import { describe, expect, it } from 'vitest';
import { trackInteraction } from './interaction';

describe('has the person started using the app', () => {
  it('says no until a tap, a touch or a key press', () => {
    const page = new EventTarget();
    const started = trackInteraction(page);
    expect(started()).toBe(false);
    page.dispatchEvent(new Event('scroll'));
    page.dispatchEvent(new Event('visibilitychange'));
    expect(started()).toBe(false);
  });

  it.each(['pointerdown', 'touchstart', 'keydown'])('says yes after a %s', (type) => {
    const page = new EventTarget();
    const started = trackInteraction(page);
    page.dispatchEvent(new Event(type));
    expect(started()).toBe(true);
  });
});
