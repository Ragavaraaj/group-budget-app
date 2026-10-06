/**
 * Which build of the app this is, read from its own entry file. The build names that file after
 * its content (`/assets/index-<hash>.js`), so the name changes exactly when the code does, and a
 * deploy that changes nothing in the app leaves it, and so the service worker, untouched. (A
 * commit id baked into the code would change both on every deploy.)
 */
const ENTRY_FILE = /\/assets\/index-([A-Za-z0-9_-]+)\.js(?:[?#].*)?$/;

/** The id in the entry file's name; "dev" when there is none (the Vite dev server, a test). */
export function buildIdOf(scriptSources: readonly string[]): string {
  for (const source of scriptSources) {
    const id = ENTRY_FILE.exec(source)?.[1];
    if (id) return id;
  }
  return 'dev';
}

/** The id of the build running in this page. */
export function runningBuildId(): string {
  return buildIdOf(Array.from(document.scripts, (script) => script.src));
}
