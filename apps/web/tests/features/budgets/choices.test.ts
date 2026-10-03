import { describe, expect, it } from 'vitest';
import type { LocalBudget, LocalCategory } from '@/db/types';
import { budgetChoices, OVERALL } from '@/features/budgets/choices';
import { budgetRow, categoryRow } from '../../support/helpers';

const category = (id: string, name: string) =>
  ({ ...categoryRow('g', 'u', { name }), id }) as LocalCategory;
const budget = (categoryId: string | null) =>
  ({ ...budgetRow('g', 'u', { categoryId }) }) as LocalBudget;

const food = category('food', 'Food');
const rent = category('rent', 'Rent');

describe('what a budget can be set for', () => {
  it('offers everything and every category when there are no budgets', () => {
    expect(budgetChoices([food, rent], []).map((c) => c.id)).toEqual([OVERALL, 'food', 'rent']);
  });

  it('leaves out what already has a budget', () => {
    expect(budgetChoices([food, rent], [budget(null), budget('food')]).map((c) => c.id)).toEqual([
      'rent',
    ]);
  });

  it('offers nothing when everything is covered', () => {
    expect(budgetChoices([food, rent], [budget(null), budget('food'), budget('rent')])).toEqual([]);
  });

  it('keeps its own target for the one being edited', () => {
    const overall = budget(null);
    const forFood = budget('food');
    expect(budgetChoices([food, rent], [overall, forFood], forFood).map((c) => c.id)).toEqual([
      'food',
      'rent',
    ]);
    expect(budgetChoices([food, rent], [overall, forFood], overall).map((c) => c.id)).toEqual([
      OVERALL,
      'rent',
    ]);
  });
});
