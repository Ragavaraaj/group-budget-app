import { describe, expect, it } from 'vitest';
import type { LocalCategory, LocalExpense } from '@/db/types';
import {
  categoryChoices,
  filterExpenses,
  isEmptySearch,
  NO_FILTERS,
} from '@/features/search/filter';
import { categoryRow, expenseRow } from '../../support/helpers';

const G = 'g';
const U = 'u';
const food = { ...categoryRow(G, U, { name: 'Food' }), id: 'food' } as LocalCategory;
const rent = { ...categoryRow(G, U, { name: 'Rent' }), id: 'rent' } as LocalCategory;
const categories = new Map([
  ['food', food],
  ['rent', rent],
]);

const expense = (overrides: Partial<LocalExpense>): LocalExpense => expenseRow(G, U, overrides);

const lunch = expense({
  note: 'Lunch at Café Coffee Day',
  amountMinor: 45_050,
  categoryId: 'food',
  occurredOn: '2026-10-03',
});
const flat = expense({
  note: 'October rent',
  amountMinor: 1_800_000,
  categoryId: 'rent',
  occurredOn: '2026-10-01',
});
const chai = expense({ note: '', amountMinor: 2_000, categoryId: null, occurredOn: '2026-09-20' });
const gone = expense({ note: 'lunch', deletedAt: 5, occurredOn: '2026-10-04' });
const all = [chai, lunch, gone, flat];

const find = (filters: Partial<typeof NO_FILTERS>) =>
  filterExpenses(all, { ...NO_FILTERS, ...filters }, categories).map((e) => e.id);

describe('filterExpenses', () => {
  it('returns every live expense, newest first, when nothing is filtered', () => {
    expect(find({})).toEqual([lunch.id, flat.id, chai.id]);
  });

  it('matches words in the note, ignoring case and accents', () => {
    expect(find({ text: 'cafe' })).toEqual([lunch.id]);
    expect(find({ text: 'RENT' })).toEqual([flat.id]);
  });

  it('needs every word to match, in any order', () => {
    expect(find({ text: 'coffee lunch' })).toEqual([lunch.id]);
    expect(find({ text: 'lunch rent' })).toEqual([]);
  });

  it('also looks at the category name, the amount and the date', () => {
    expect(find({ text: 'food' })).toEqual([lunch.id]);
    expect(find({ text: '450.50' })).toEqual([lunch.id]);
    expect(find({ text: '2026-09' })).toEqual([chai.id]);
  });

  it('filters by category name, and by "none"', () => {
    expect(find({ category: 'food' })).toEqual([lunch.id]);
    expect(find({ category: 'none' })).toEqual([chai.id]);
  });

  it('filters by date range, both ends included', () => {
    expect(find({ from: '2026-10-01', to: '2026-10-03' })).toEqual([lunch.id, flat.id]);
    expect(find({ from: '2026-10-02' })).toEqual([lunch.id]);
    expect(find({ to: '2026-09-30' })).toEqual([chai.id]);
  });

  it('filters by amount range, both ends included', () => {
    expect(find({ minMinor: 45_050, maxMinor: 1_800_000 })).toEqual([lunch.id, flat.id]);
    expect(find({ maxMinor: 2_000 })).toEqual([chai.id]);
  });

  it('never returns a deleted expense', () => {
    expect(find({ text: 'lunch' })).toEqual([lunch.id]);
  });
});

describe('search helpers', () => {
  it('knows when nothing is being asked', () => {
    expect(isEmptySearch(NO_FILTERS)).toBe(true);
    expect(isEmptySearch({ ...NO_FILTERS, text: '  ' })).toBe(true);
    expect(isEmptySearch({ ...NO_FILTERS, category: 'food' })).toBe(false);
    expect(isEmptySearch({ ...NO_FILTERS, minMinor: 0 })).toBe(false);
  });

  it('offers each category name once, whichever group it is in', () => {
    const other = { ...categoryRow('h', U, { name: ' food ' }), id: 'other' } as LocalCategory;
    const choices = categoryChoices([food, rent, other]);
    expect(choices.map((c) => c.label)).toEqual(['Food', 'Rent']);
  });
});
