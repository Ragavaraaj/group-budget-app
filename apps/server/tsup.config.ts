import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared package ships as TypeScript source, so it is bundled in here.
  // Everything else in `dependencies` (hono, drizzle, better-sqlite3, ...) stays external.
  noExternal: ['@budget/shared'],
});
