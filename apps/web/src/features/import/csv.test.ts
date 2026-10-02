import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads plain rows and trims cells', () => {
    expect(parseCsv('a, b ,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas, quotes and line breaks inside quoted cells', () => {
    expect(parseCsv('"Smith, J","say ""hi""","two\nlines"\nx,y,z')).toEqual([
      ['Smith, J', 'say "hi"', 'two\nlines'],
      ['x', 'y', 'z'],
    ]);
  });

  it('handles Windows line endings, a byte-order mark and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty cells in the middle of a row', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('copes with a final row that has no line break', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('never loses or invents cells: re-reading what it wrote gives the same rows', () => {
    const rows = [
      ['Date', 'Narration', 'Amount'],
      ['02/10/2026', 'UPI-Swiggy, Bengaluru "Order"', '1,250.00'],
    ];
    const text = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n');
    expect(parseCsv(text)).toEqual(rows);
  });
});

describe('detectDelimiter', () => {
  it('picks the separator the file actually uses', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('ignores separators inside quotes', () => {
    expect(detectDelimiter('"a,b,c,d";x;y\n"1,2,3";2;3')).toBe(';');
  });

  it('parses a semicolon file without being told', () => {
    expect(parseCsv('Date;Amount\n02.10.2026;12,50')).toEqual([
      ['Date', 'Amount'],
      ['02.10.2026', '12,50'],
    ]);
  });
});
