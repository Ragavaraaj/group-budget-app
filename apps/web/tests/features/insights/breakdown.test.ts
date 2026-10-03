import { describe, expect, it } from 'vitest';
import type { LocalCategory } from '@/db/types';
import { limitRows, nameCategories } from '@/features/insights/breakdown';
import { categoryRow } from '../../support/helpers';

const category = (id: string, name: string, overrides: Partial<LocalCategory> = {}) =>
  ({ ...categoryRow('g', 'u', { name }), id, ...overrides }) as LocalCategory;

describe('nameCategories', () => {
  it('names each category and orders by amount', () => {
    const categories = new Map([
      ['a', category('a', 'Food')],
      ['b', category('b', 'Rent')],
    ]);
    const rows = nameCategories(
      [
        { categoryId: 'a', amountMinor: 100, count: 2 },
        { categoryId: 'b', amountMinor: 900, count: 1 },
      ],
      categories,
    );
    expect(rows.map((r) => [r.name, r.amountMinor])).toEqual([
      ['Rent', 900],
      ['Food', 100],
    ]);
  });

  it('adds up categories with the same name from different groups', () => {
    const categories = new Map([
      ['a', category('a', 'Food')],
      ['b', category('b', ' food ')],
    ]);
    const rows = nameCategories(
      [
        { categoryId: 'a', amountMinor: 100, count: 1 },
        { categoryId: 'b', amountMinor: 250, count: 3 },
      ],
      categories,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountMinor: 350, count: 4 });
  });

  it('keeps a category called "Other" or "None" apart from the rows the app adds itself', () => {
    const names = ['Other', 'None', 'Food', 'Rent', 'Fuel', 'Fun', 'Gym', 'Gifts', 'Pets'];
    const categories = new Map(names.map((name) => [name, category(name, name)]));
    const rows = nameCategories(
      [
        ...names.map((name, i) => ({ categoryId: name, amountMinor: 1_000 - i, count: 1 })),
        { categoryId: null, amountMinor: 1, count: 1 },
      ],
      categories,
    );
    // "None" the category is not folded into "Uncategorised"...
    expect(rows.map((r) => r.name)).toContain('None');
    expect(rows.map((r) => r.name)).toContain('Uncategorised');
    expect(rows).toHaveLength(10);

    // ...and with the "Everything else" row added to a full list, no key is used twice.
    const limited = limitRows(rows, 8);
    expect(limited.map((r) => r.name)).toContain('Other');
    expect(limited.at(-1)?.name).toBe('Everything else');
    expect(new Set(limited.map((r) => r.key)).size).toBe(limited.length);
  });

  it('calls no category and unknown categories "Uncategorised"', () => {
    const rows = nameCategories(
      [
        { categoryId: null, amountMinor: 100, count: 1 },
        { categoryId: 'gone', amountMinor: 50, count: 1 },
      ],
      new Map(),
    );
    expect(rows).toEqual([
      {
        key: 'none',
        name: 'Uncategorised',
        icon: undefined,
        color: undefined,
        amountMinor: 150,
        count: 2,
      },
    ]);
  });
});

describe('limitRows', () => {
  const rows = [50, 40, 30, 20, 10].map((amountMinor, i) => ({
    key: `c${i}`,
    name: `C${i}`,
    icon: undefined,
    color: undefined,
    amountMinor,
    count: 1,
  }));

  it('leaves a short list alone', () => {
    expect(limitRows(rows, 5)).toEqual(rows);
  });

  it('folds the smallest into one row so the list has exactly the limit', () => {
    const limited = limitRows(rows, 3);
    expect(limited.map((r) => r.name)).toEqual(['C0', 'C1', 'Everything else']);
    expect(limited[2]).toMatchObject({ amountMinor: 60, count: 3 });
    expect(limited.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(150);
  });
});
