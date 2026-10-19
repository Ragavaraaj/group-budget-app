/**
 * Branch names follow CLAUDE.md's convention: `<type>/<issue>-<slug>`, where the type is one of
 * test, feat, fix or chore. One branch per issue, so a re-run finds the same name.
 */
import { CHANGE_TYPES, type ChangeType } from './plan.ts';

const MAX_SLUG = 40;
const BRANCH_RE = /^(feat|fix|test|chore)\/(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function slugify(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug === '' ? word : `${slug}-${word}`;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  // A single word longer than the limit is cut rather than dropped.
  if (slug === '' && words[0]) slug = words[0].slice(0, MAX_SLUG);
  return slug === '' ? 'change' : slug;
}

/** A `bug` label always means `fix`; otherwise the plan's type, defaulting to `feat`. */
export function changeTypeFor(planType: string | null | undefined, labels: string[]): ChangeType {
  if (labels.some((label) => label.toLowerCase() === 'bug')) return 'fix';
  return CHANGE_TYPES.includes(planType as ChangeType) ? (planType as ChangeType) : 'feat';
}

export function branchName(type: ChangeType, issue: number, title: string): string {
  return `${type}/${issue}-${slugify(title)}`;
}

export function isValidBranch(name: string): boolean {
  const match = BRANCH_RE.exec(name);
  return match !== null && (match[3]?.length ?? 0) <= MAX_SLUG;
}

/** The issue number a convention branch is for, or null. */
export function issueOfBranch(name: string): number | null {
  const match = BRANCH_RE.exec(name);
  return match?.[2] ? Number(match[2]) : null;
}
