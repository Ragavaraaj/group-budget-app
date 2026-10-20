import { describe, expect, it } from 'vitest';
import {
  extractPlan,
  hasPlan,
  PLAN_END,
  PLAN_START,
  parsePlanOutput,
  planHeader,
  upsertPlan,
} from '../src/plan.ts';

describe('the plan in the issue body', () => {
  it('adds the plan below what the person wrote', () => {
    const body = upsertPlan('Show the version somewhere.', 'Step one');
    expect(body).toBe(`Show the version somewhere.\n\n${PLAN_START}\nStep one\n${PLAN_END}`);
    expect(extractPlan(body)).toBe('Step one');
  });

  it('replaces an earlier plan and keeps everything around it', () => {
    const first = `Intro\n\n${PLAN_START}\nold\n${PLAN_END}\n\nFooter`;
    const next = upsertPlan(first, 'new');
    expect(next).toBe(`Intro\n\n${PLAN_START}\nnew\n${PLAN_END}\n\nFooter`);
  });

  it('writes the plan alone into an empty issue', () => {
    expect(upsertPlan(null, 'only')).toBe(`${PLAN_START}\nonly\n${PLAN_END}`);
  });

  it('knows when there is no plan', () => {
    expect(hasPlan(null)).toBe(false);
    expect(hasPlan('just a title')).toBe(false);
    expect(hasPlan(`${PLAN_START}\n  \n${PLAN_END}`)).toBe(false);
    expect(hasPlan(`${PLAN_END} before ${PLAN_START}`)).toBe(false);
    expect(hasPlan(upsertPlan('', 'x'))).toBe(true);
  });

  it('puts the branch, size and risk the person approves at the top', () => {
    const header = planHeader({
      branch: 'feat/12-x',
      size: 'S',
      risk: 'low',
      runUrl: 'https://example.test/r',
    });
    expect(header).toContain(
      '**Branch:** `feat/12-x` · **Size:** S · **Risk:** low · [planning run](https://example.test/r)',
    );
    expect(header).toContain('/approve');
  });
});

describe('parsePlanOutput', () => {
  const valid = {
    plan_markdown: '### Steps\n1. Do it',
    type: 'feat',
    size: 'S',
    risk: 'low',
    questions: [],
    context: {
      areas: ['settings'],
      files: ['apps/web/src/features/settings/x.tsx'],
      tests: [],
      graph_notes: '',
    },
  };

  it('accepts a complete plan', () => {
    expect(parsePlanOutput(JSON.stringify(valid)).type).toBe('feat');
  });

  it('names every problem with an unusable plan', () => {
    const bad = { ...valid, plan_markdown: ' ', type: 'refactor', size: 'XL', context: {} };
    expect(() => parsePlanOutput(JSON.stringify(bad))).toThrow(
      /plan_markdown is empty; type is not one of feat\|fix\|test\|chore; size is not S\|M\|L; context.areas is missing/,
    );
  });
});
