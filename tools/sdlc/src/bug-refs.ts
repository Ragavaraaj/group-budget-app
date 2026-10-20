/**
 * A test marked as failing is a bug that is still open, and bugs live in GitHub issues. So every
 * `test.fail(...)` must name its issue: `test.fail(true, 'Bug #123: what goes wrong')`. When the bug
 * is fixed the test starts passing, Playwright reports "expected to fail", and the fix removes the
 * mark and closes the issue.
 */

export interface SourceFile {
  path: string;
  content: string;
}

/** Whether a path holds tests: the e2e specs, or a package's `test/` folder. */
export function isTestPath(path: string): boolean {
  return /^e2e\/.+\.ts$/.test(path) || /(^|\/)test\/.+\.ts$/.test(path);
}

/** The text of the call starting at `open` (the parenthesis), up to its closing parenthesis. */
function callArgs(content: string, open: number): string {
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return content.slice(open + 1);
}

export function checkBugRefs(files: SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (!isTestPath(file.path)) continue;
    for (const match of file.content.matchAll(/\btest(?:\.describe)?\.fail\s*\(/g)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      const args = callArgs(file.content, open);
      if (/Bug #\d+/.test(args)) continue;
      const line = file.content.slice(0, match.index).split('\n').length;
      problems.push(
        `${file.path}:${line}: a test.fail mark must name its issue, e.g. test.fail(true, 'Bug #123: summary')`,
      );
    }
  }
  return problems;
}
