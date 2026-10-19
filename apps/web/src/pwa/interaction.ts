/**
 * What counts as the person having started to use the app. Wide on purpose: a false "yes" only
 * means an update is offered instead of applied, while a false "no" could reload a form half
 * filled. Taps and keys, and also what assistive technology, dictation and autofill produce
 * without them (a click, input, a change or a paste).
 */
const STARTED_BY = [
  'pointerdown',
  'touchstart',
  'keydown',
  'click',
  'input',
  'change',
  'paste',
] as const;

/**
 * Starts watching for the first of those, and returns a function that says whether one has
 * happened. Used to tell "just opened, nothing entered" from "already doing something".
 */
export function trackInteraction(target: EventTarget): () => boolean {
  let happened = false;
  for (const type of STARTED_BY) {
    // Capturing, so nothing in the page can swallow it first (a handler that stops the event
    // reaching the window would otherwise hide a tap from this).
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
