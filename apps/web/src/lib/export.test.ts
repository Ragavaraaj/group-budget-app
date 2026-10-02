import { uuidv7 } from '@budget/shared';
import { describe, expect, it } from 'vitest';
import { categoryRow, expenseRow, groupRow, memberRow } from '@/test-helpers';
import { csvCell, type ExportBundle, expensesToCsv } from './export';

describe('csvCell', () => {
  it('quotes cells with commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses spreadsheet formulas', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-5)).toBe('-5'); // a real number is not a formula
  });
});

describe('expensesToCsv', () => {
  const me = uuidv7();
  const friend = uuidv7();
  const group = uuidv7();
  const cat = categoryRow(group, me, { name: 'Food, drink' });

  const bundle = (expenses: ExportBundle['expenses']): ExportBundle => ({
    exportedAt: '2026-10-02T00:00:00Z',
    user: { id: me, name: 'Asha', email: 'a@example.com' },
    groups: [groupRow(group, me, { name: 'Goa trip' })],
    members: [
      memberRow(group, me, { displayName: 'Asha' }),
      memberRow(group, friend, { displayName: 'Bala' }),
    ],
    categories: [cat],
    expenses,
    settlements: [],
    budgets: [],
    recurring: [],
  });

  it('writes a header and one line per live expense, newest first, in rupees', () => {
    const csv = expensesToCsv(
      bundle([
        expenseRow(group, me, {
          occurredOn: '2026-10-01',
          categoryId: cat.id,
          note: 'Dinner, with "friends"',
          amountMinor: 123_450,
          payers: [{ userId: friend, amountMinor: 123_450 }],
          shares: [
            { userId: me, amountMinor: 61_725 },
            { userId: friend, amountMinor: 61_725 },
          ],
        }),
        expenseRow(group, me, {
          occurredOn: '2026-10-02',
          amountMinor: 500,
          payers: [{ userId: me, amountMinor: 500 }],
          shares: [{ userId: me, amountMinor: 500 }],
        }),
        expenseRow(group, me, { occurredOn: '2026-10-03', deletedAt: 5 }), // deleted: left out
      ]),
    ).split('\r\n');

    expect(csv[0]).toBe('Date,Group,Category,Note,Total (INR),Your share (INR),Paid by,Added by');
    expect(csv).toHaveLength(3);
    expect(csv[1]).toBe('2026-10-02,Goa trip,,,5.00,5.00,Asha,Asha');
    expect(csv[2]).toBe(
      '2026-10-01,Goa trip,"Food, drink","Dinner, with ""friends""",1234.50,617.25,Bala,Asha',
    );
  });

  it('names someone who left "Former member" rather than leaving a blank', () => {
    const gone = uuidv7();
    const csv = expensesToCsv(
      bundle([expenseRow(group, gone, { payers: [{ userId: gone, amountMinor: 1_000 }] })]),
    );
    expect(csv).toContain('Former member');
  });
});
