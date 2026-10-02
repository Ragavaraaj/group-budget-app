/**
 * A small CSV reader for bank statements: quoted cells, escaped quotes (`""`), line breaks inside
 * quotes, a byte-order mark, and comma, semicolon or tab separators. It does not guess at
 * anything else; what the columns mean is `bank.ts`'s job.
 */

const DELIMITERS = [',', ';', '\t'] as const;

/** The separator used most in the first lines of the file, ignoring quoted text. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20);
  let best: string = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    for (const line of sample) {
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === delimiter && !inQuotes) count++;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Rows of cells, trimmed, with blank lines dropped. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === sep) {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += char;
    }
  }
  endRow();
  return rows;
}
