---
name: report-bug
description: Record a real bug that a test found as a GitHub issue on the board (bugs never live in files in the repo), and mark its test as an expected failure that names the issue. Use when a test fails because the app is wrong, not the test.
---

# A bug found by a test

Bugs are tracked as GitHub issues labelled `bug`, on the board. Nothing about a bug is written into
the repository except the test that shows it.

1. **Is it the app?** A failure caused by the test itself is not a bug: fix the test instead.
2. **Is it known?** `gh issue list --label bug --state all --search "<words>"`. If it is, use that
   issue's number.
3. **File it**:
   ```sh
   gh issue create --title "<what goes wrong, in the user's words>" \
     --label bug --label "severity:<high|medium|low>" --label "area:<area>" \
     --body-file <a temporary file>
   ```
   The body has these headings (the bug form in `.github/ISSUE_TEMPLATE/bug.yml` asks for the same):
   **Steps**, **Expected**, **Actual**, **Cause** (where in the code, if found), **The test**
   (spec file and title).
   Severity: **high** loses or corrupts data, or blocks sign-in; **medium** blocks a flow, or is
   wrong on a main screen for everyone; **low** needs unusual input, or is wording or consistency.
   Areas: auth, budgets, categories, expenses, groups, import, insights, recurring, search,
   settings, sync, layout, design-system, pwa, live, ci.
4. **Mark the test** so the suite stays green while the bug is open and fails once it is fixed:
   `test.fail(true, 'Bug #<n>: <summary>');` as the test's first line (`npm run check:bug-refs`
   checks the reference).
5. **Say so** in the pull request (the template's "Bugs found").

When the bug is fixed, Playwright reports "expected to fail, but passed": remove the mark and put
`Closes #<n>` in that pull request.
