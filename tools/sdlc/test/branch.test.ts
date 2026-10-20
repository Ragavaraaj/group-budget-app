import { describe, expect, it } from 'vitest';
import { branchName, changeTypeFor, issueOfBranch, isValidBranch, slugify } from '../src/branch.ts';

describe('slugify', () => {
  it.each([
    ['Show the app version in Settings', 'show-the-app-version-in-settings'],
    ['  Import: stops at 500 rows!! ', 'import-stops-at-500-rows'],
    ['Café crème & naïve résumé', 'cafe-creme-naive-resume'],
    ['₹ budget', 'budget'],
    ['???', 'change'],
  ])('%j → %j', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it('stops at a word boundary within 40 characters', () => {
    const slug = slugify('one two three four five six seven eight nine ten eleven twelve');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe('one-two-three-four-five-six-seven-eight');
  });

  it('cuts a single word that is longer than the limit', () => {
    expect(slugify('a'.repeat(60))).toBe('a'.repeat(40));
  });
});

describe('changeTypeFor', () => {
  it('uses the plan type, and feat when it is missing or unknown', () => {
    expect(changeTypeFor('chore', [])).toBe('chore');
    expect(changeTypeFor('test', ['sdlc'])).toBe('test');
    expect(changeTypeFor(null, [])).toBe('feat');
    expect(changeTypeFor('refactor', [])).toBe('feat');
  });

  it('always uses fix for a bug, whatever the plan says', () => {
    expect(changeTypeFor('feat', ['bug'])).toBe('fix');
    expect(changeTypeFor(null, ['Bug', 'area:import'])).toBe('fix');
  });
});

describe('branchName and isValidBranch', () => {
  it('builds <type>/<issue>-<slug> names that pass the check', () => {
    const name = branchName('feat', 12, 'Show the app version in Settings');
    expect(name).toBe('feat/12-show-the-app-version-in-settings');
    expect(isValidBranch(name)).toBe(true);
    expect(issueOfBranch(name)).toBe(12);
  });

  it.each([
    'main',
    'claude/funny-dijkstra-d0ofie',
    'feature/12-x',
    'feat/x-12',
    'feat/12-',
    'feat/12-Upper',
    'feat/12-double--dash',
    `fix/3-${'a'.repeat(41)}`,
  ])('refuses %j', (name) => {
    expect(isValidBranch(name)).toBe(false);
  });

  it('accepts every convention type', () => {
    for (const type of ['feat', 'fix', 'test', 'chore'] as const) {
      expect(isValidBranch(branchName(type, 7, 'x'))).toBe(true);
    }
  });
});
