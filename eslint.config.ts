import js from '@eslint/js';
import type { Linter } from 'eslint';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const boundary = (group: string[], message: string): Linter.RulesRecord => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
});

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/node_modules/**',
      'apps/server/drizzle/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/server/**/*.ts', 'packages/shared/**/*.ts', 'e2e/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // shadcn components export variants alongside components; they are generated code.
    files: ['apps/web/src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Dependency direction: web -> shared <- server. shared imports nothing of ours.
  {
    files: ['packages/shared/**'],
    rules: boundary(
      [
        '@budget/server',
        '@budget/server/*',
        '@budget/web',
        '@budget/web/*',
        '**/apps/**',
        'node:*',
      ],
      'packages/shared must stay pure and isomorphic: no apps/* imports and no Node built-ins.',
    ),
  },
  {
    files: ['apps/web/**'],
    rules: boundary(
      ['@budget/server', '@budget/server/*', '**/apps/server/**'],
      'The web app must never import server code; share contracts through @budget/shared.',
    ),
  },
  {
    files: ['apps/server/**'],
    rules: boundary(
      ['@budget/web', '@budget/web/*', '**/apps/web/**'],
      'The server must never import web code; share contracts through @budget/shared.',
    ),
  },
);
