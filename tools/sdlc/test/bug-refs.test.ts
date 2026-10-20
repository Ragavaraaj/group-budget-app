import { describe, expect, it } from 'vitest';
import { checkBugRefs, isTestPath } from '../src/bug-refs.ts';

// Built at run time so this file does not itself contain the calls it checks.
const call = (args: string) => `${['test', 'fail'].join('.')}(${args})`;

describe('isTestPath', () => {
  it('covers the e2e specs and every test folder', () => {
    expect(isTestPath('e2e/import.spec.ts')).toBe(true);
    expect(isTestPath('e2e/helpers.ts')).toBe(true);
    expect(isTestPath('apps/web/test/db/repo.test.ts')).toBe(true);
    expect(isTestPath('tools/sdlc/test/x.test.ts')).toBe(true);
    expect(isTestPath('apps/web/src/db/repo.ts')).toBe(false);
  });
});

describe('checkBugRefs', () => {
  it('accepts a mark that names its issue, on one line or several', () => {
    const files = [
      {
        path: 'e2e/a.spec.ts',
        content: `${call("true, 'Bug #12: the import stops at 500 rows'")};`,
      },
      {
        path: 'e2e/b.spec.ts',
        content: `${call("\n  browserName === 'webkit',\n  'Bug #7: no socket on iOS',\n")};`,
      },
    ];
    expect(checkBugRefs(files)).toEqual([]);
  });

  it('refuses a mark without an issue, with its line', () => {
    const files = [
      {
        path: 'e2e/c.spec.ts',
        content: `test('x', () => {\n  ${call("true, 'BUG-001: old style'")};\n});`,
      },
    ];
    expect(checkBugRefs(files)).toEqual([
      "e2e/c.spec.ts:2: a test.fail mark must name its issue, e.g. test.fail(true, 'Bug #123: summary')",
    ]);
  });

  it('also checks test.describe.fail and a bare mark', () => {
    const describeFail = `${['test', 'describe', 'fail'].join('.')}('group', () => {})`;
    const files = [{ path: 'apps/web/test/x.test.ts', content: `${describeFail};\n${call('')};` }];
    expect(checkBugRefs(files)).toHaveLength(2);
  });

  it('ignores source files', () => {
    expect(checkBugRefs([{ path: 'apps/web/src/x.ts', content: call('true') }])).toEqual([]);
  });
});
