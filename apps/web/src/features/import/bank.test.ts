import { describe, expect, it } from 'vitest';
import {
  BANK_PRESETS,
  detectBank,
  detectColumns,
  findDuplicates,
  findHeaderRow,
  guessSpendingSign,
  interpretRows,
  looksLikeHeader,
  parseAmount,
  parseStatementDate,
  suggestCategory,
} from './bank';
import { parseCsv } from './csv';

describe('parseAmount', () => {
  it.each([
    ['1234', { minor: 123_400, negative: false, mark: null }],
    ['1,23,456.78', { minor: 12_345_678, negative: false, mark: null }],
    ['₹ 99', { minor: 9_900, negative: false, mark: null }],
    ['INR 45.5', { minor: 4_550, negative: false, mark: null }],
    ['-500', { minor: 50_000, negative: true, mark: null }],
    ['(500.00)', { minor: 50_000, negative: true, mark: null }],
    ['500.00 Dr', { minor: 50_000, negative: false, mark: 'dr' }],
    ['75.25CR', { minor: 7_525, negative: false, mark: 'cr' }],
  ])('reads %j', (cell, expected) => {
    expect(parseAmount(cell)).toEqual(expected);
  });

  it.each(['', '  ', 'abc', '1.234', '--5'])('gives up on %j', (cell) => {
    expect(parseAmount(cell)).toBeNull();
  });
});

describe('parseStatementDate', () => {
  it.each([
    ['2026-10-02', '2026-10-02'],
    ['02/10/2026', '2026-10-02'],
    ['02-10-2026', '2026-10-02'],
    ['02.10.2026', '2026-10-02'],
    ['02/10/26', '2026-10-02'],
    ['2 Oct 2026', '2026-10-02'],
    ['02-Oct-26', '2026-10-02'],
    ['02 October 2026', '2026-10-02'],
    ['02/10/2026 14:33:10', '2026-10-02'],
    ['2026-10-02T14:33:10', '2026-10-02'],
  ])('reads %j as %s', (cell, expected) => {
    expect(parseStatementDate(cell)).toBe(expected);
  });

  it('reads day first by default and month first when asked', () => {
    expect(parseStatementDate('03/04/2026')).toBe('2026-04-03');
    expect(parseStatementDate('03/04/2026', 'mdy')).toBe('2026-03-04');
  });

  it.each(['', 'today', '31/02/2026', '2026-13-01', '32/01/2026', '02 Foo 2026'])(
    'rejects %j',
    (cell) => {
      expect(parseStatementDate(cell)).toBeNull();
    },
  );
});

// Headers in the shape each bank's statement is commonly laid out in (not taken from real files).
const SAMPLES: Record<string, { header: string[]; row: string[] }> = {
  'HDFC Bank': {
    header: [
      'Date',
      'Narration',
      'Chq./Ref.No.',
      'Value Dt',
      'Withdrawal Amt.',
      'Deposit Amt.',
      'Closing Balance',
    ],
    row: ['02/10/26', 'UPI-SWIGGY-swiggy@icici', '0000123', '02/10/26', '450.00', '', '10,000.00'],
  },
  'ICICI Bank': {
    header: [
      'S No.',
      'Value Date',
      'Transaction Date',
      'Cheque Number',
      'Transaction Remarks',
      'Withdrawal Amount (INR )',
      'Deposit Amount (INR )',
      'Balance (INR )',
    ],
    row: ['1', '02/10/2026', '02/10/2026', '', 'UPI/Swiggy/Order', '450.00', '0.00', '10,000.00'],
  },
  'State Bank of India': {
    header: [
      'Txn Date',
      'Value Date',
      'Description',
      'Ref No./Cheque No.',
      'Debit',
      'Credit',
      'Balance',
    ],
    row: ['2 Oct 2026', '2 Oct 2026', 'UPI/DR/Swiggy', 'TXN1', '450.00', '', '10000.00'],
  },
  'Axis Bank': {
    header: ['SRL NO', 'Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL', 'SOL'],
    row: ['1', '02-10-2026', '', 'UPI/P2M/Swiggy', '450.00', '', '10000.00', '123'],
  },
  'Kotak Mahindra Bank': {
    header: [
      'Sl. No.',
      'Transaction Date',
      'Value Date',
      'Description',
      'Chq / Ref No.',
      'Debit',
      'Credit',
      'Balance',
      'Dr / Cr',
    ],
    row: ['1', '02-10-2026', '02-10-2026', 'UPI/Swiggy', 'REF1', '450.00', '', '10000.00', 'Dr'],
  },
};

describe('bank statement layouts', () => {
  it.each(Object.entries(SAMPLES))(
    'finds the columns of a %s statement',
    (name, { header, row }) => {
      expect(detectBank(header)).toBe(name);
      const mapping = detectColumns(header);
      expect(mapping.date).not.toBe(-1);
      expect(mapping.description).not.toBe(-1);
      expect(mapping.debit).not.toBe(-1);
      expect(mapping.credit).not.toBe(-1);

      const { rows } = interpretRows([row], 2, mapping, {
        dateOrder: 'dmy',
        spendingIs: 'negative',
      });
      expect(rows).toEqual([expect.objectContaining({ date: '2026-10-02', amountMinor: 45_000 })]);
      expect(rows[0]?.note).toMatch(/swiggy/i);
    },
  );

  it('prefers the transaction date to the value date', () => {
    const mapping = detectColumns(SAMPLES['ICICI Bank']?.header ?? []);
    expect(mapping.date).toBe(2);
  });

  it('knows the preset list has a signature for every bank it can name', () => {
    expect(BANK_PRESETS.map((p) => p.name).sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it('does not name a bank for an unfamiliar layout, but still finds the columns', () => {
    const header = ['Posted', 'Merchant', 'Amount'];
    expect(detectBank(header)).toBeNull();
    expect(detectBank(['Date', 'Description', 'Amount'])).toBeNull();
  });
});

describe('finding the table in a statement', () => {
  const file = [
    'Account Statement',
    'Name: A B,,,',
    'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '01/10/26,Opening,,,5000.00',
    '02/10/26,UPI-Zomato,300.00,,4700.00',
    '03/10/26,Salary,,50000.00,54700.00',
    '04/10/26,UPI-Uber,120.50,,54579.50',
    ',Total,420.50,50000.00,',
  ].join('\n');

  it('skips the lines above the header', () => {
    const rows = parseCsv(file);
    const at = findHeaderRow(rows);
    expect(rows[at]?.[1]).toBe('Narration');
  });

  it('turns debits into expenses, counts credits, and sets aside unreadable rows', () => {
    const rows = parseCsv(file);
    const at = findHeaderRow(rows);
    const mapping = detectColumns(rows[at] ?? []);
    const result = interpretRows(rows.slice(at + 1), at + 2, mapping, {
      dateOrder: 'dmy',
      spendingIs: 'negative',
    });
    expect(result.rows.map((r) => [r.date, r.amountMinor, r.note])).toEqual([
      ['2026-10-02', 30_000, 'UPI-Zomato'],
      ['2026-10-04', 12_050, 'UPI-Uber'],
    ]);
    expect(result.credits).toBe(1);
    expect(result.unreadable).toBe(2); // the opening balance and the totals line
  });

  it('is not fooled by a row that only mentions a date', () => {
    expect(looksLikeHeader(['Statement date', '02/10/2026', ''])).toBe(false);
    expect(findHeaderRow([['nothing', 'here', 'at all']])).toBe(-1);
  });
});

describe('a single amount column', () => {
  const header = ['Date', 'Description', 'Amount'];
  const mapping = detectColumns(header);

  it('treats negative numbers as spending in a bank account', () => {
    const rows = [
      ['02/10/2026', 'Swiggy', '-450.00'],
      ['03/10/2026', 'Salary', '50000.00'],
    ];
    expect(guessSpendingSign(rows, mapping)).toBe('negative');
    const result = interpretRows(rows, 2, mapping, { dateOrder: 'dmy', spendingIs: 'negative' });
    expect(result.rows).toHaveLength(1);
    expect(result.credits).toBe(1);
  });

  it('treats positive numbers as spending on a credit card, and refunds as credits', () => {
    const rows = [
      ['02/10/2026', 'Swiggy', '450.00'],
      ['03/10/2026', 'Refund', '-100.00'],
    ];
    expect(guessSpendingSign([['02/10/2026', 'x', '450']], mapping)).toBe('positive');
    const result = interpretRows(rows, 2, mapping, { dateOrder: 'dmy', spendingIs: 'positive' });
    expect(result.rows.map((r) => r.amountMinor)).toEqual([45_000]);
    expect(result.credits).toBe(1);
  });

  it('uses a Dr/Cr marker over the sign when there is one', () => {
    const withType = detectColumns(['Date', 'Narration', 'Amount', 'Dr/Cr']);
    const result = interpretRows(
      [
        ['02/10/2026', 'Swiggy', '450.00', 'DR'],
        ['03/10/2026', 'Salary', '50000.00', 'CR'],
        ['04/10/2026', 'Uber', '120.00 Dr', ''],
      ],
      2,
      withType,
      { dateOrder: 'dmy', spendingIs: 'negative' },
    );
    expect(result.rows.map((r) => r.amountMinor)).toEqual([45_000, 12_000]);
    expect(result.credits).toBe(1);
  });
});

describe('duplicates and categories', () => {
  const rows = [
    { line: 2, date: '2026-10-02', amountMinor: 45_000, note: 'Swiggy' },
    { line: 3, date: '2026-10-03', amountMinor: 12_000, note: 'Uber' },
    { line: 4, date: '2026-10-02', amountMinor: 45_000, note: 'Swiggy again' },
  ];

  it('flags rows that match an expense already recorded (same day, same amount)', () => {
    const dupes = findDuplicates(rows, [{ occurredOn: '2026-10-02', amountMinor: 45_000 }]);
    expect([...dupes]).toEqual([0, 2]);
  });

  it('flags nothing when nothing matches', () => {
    expect(findDuplicates(rows, [{ occurredOn: '2026-10-09', amountMinor: 1 }]).size).toBe(0);
  });

  it('suggests a default category from words in the narration', () => {
    const categories = [
      { id: 'food', name: 'Food & dining' },
      { id: 'transport', name: 'Transport' },
      { id: 'other', name: 'Other' },
    ];
    expect(suggestCategory('UPI-SWIGGY-order', categories)).toBe('food');
    expect(suggestCategory('Uber trip', categories)).toBe('transport');
    expect(suggestCategory('Payment to Ramesh', categories)).toBeNull();
    // A group that has no such category gets no suggestion rather than a wrong one.
    expect(suggestCategory('UPI-SWIGGY', [{ id: 'x', name: 'Misc' }])).toBeNull();
  });
});
