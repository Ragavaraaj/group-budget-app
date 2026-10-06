/** What counts as the person having started to use the app. */
const STARTED_BY = ['pointerdown', 'touchstart', 'keydown'] as const;

/**
 * Starts watching for the first tap, touch or key press, and returns a function that says whether
 * one has happened. Used to tell "just opened, nothing entered" from "already doing something".
 */
export function trackInteraction(target: EventTarget): () => boolean {
  let happened = false;
  for (const type of STARTED_BY) {
    // Capturing, so nothing in the page can swallow it first.
    target.addEventListener(
      type,
      () => {
        happened = true;
      },
      { capture: true, passive: true },
    );
  }
  return () => happened;
}
