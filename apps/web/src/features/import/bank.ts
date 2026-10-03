import { isValidLocalDate, parseRupees } from '@budget/shared';

/**
 * Turning a bank statement's rows into expenses. Banks name their columns differently, so this
 * recognises columns by what their headers say rather than by position. The header shapes below
 * were written from how the banks' statements are commonly laid out; they have not been checked
 * against real statements, which is why the screen always shows a preview before importing.
 */

export type Field = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'type';

export type Mapping = Record<Field, number>;

/** Headers as a key: lower case, letters and digits only ("Withdrawal Amt." → "withdrawalamt"). */
export const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

// Earlier entries win when two columns could be the same field (a transaction date over a value
// date). `exact` aliases must match the whole header; `prefix` aliases may be followed by more
// text, such as a currency in brackets.
const ALIASES: Record<Field, { exact: string[]; prefix: string[] }> = {
  date: {
    exact: [
      'date',
      'txndate',
      'transactiondate',
      'trandate',
      'tdate',
      'postingdate',
      'valuedate',
      'valuedt',
    ],
    prefix: ['transactiondate', 'txndate'],
  },
  description: {
    exact: [
      'narration',
      'description',
      'particulars',
      'remarks',
      'details',
      'transactiondetails',
      'transactionremarks',
    ],
    prefix: ['narration', 'description', 'transactionremarks', 'particulars'],
  },
  debit: {
    exact: ['debit', 'dr', 'debits', 'withdrawal', 'withdrawals', 'debitamount'],
    prefix: ['withdrawalamt', 'withdrawalamount', 'debitamount'],
  },
  credit: {
    exact: ['credit', 'cr', 'credits', 'deposit', 'deposits', 'creditamount'],
    prefix: ['depositamt', 'depositamount', 'creditamount'],
  },
  amount: {
    exact: ['amount', 'transactionamount', 'txnamount', 'amountinr'],
    prefix: ['amountinr'],
  },
  type: { exact: ['drcr', 'crdr', 'type', 'transactiontype', 'txntype'], prefix: [] },
};

const NONE = -1;

/** Which column holds what, or -1 where there isn't one. */
export function detectColumns(header: readonly string[]): Mapping {
  const keys = header.map(headerKey);
  const mapping = Object.fromEntries(
    (Object.keys(ALIASES) as Field[]).map((field) => [field, NONE]),
  ) as Mapping;

  for (const field of Object.keys(ALIASES) as Field[]) {
    const { exact, prefix } = ALIASES[field];
    let bestRank = Number.POSITIVE_INFINITY;
    keys.forEach((key, index) => {
      if (key === '') return;
      let rank = exact.indexOf(key);
      if (rank === NONE) {
        const p = prefix.findIndex((alias) => key.startsWith(alias));
        rank = p === NONE ? NONE : exact.length + p;
      }
      if (rank !== NONE && rank < bestRank) {
        bestRank = rank;
        mapping[field] = index;
      }
    });
  }

  // A column can't be two things: if the same one was picked as a debit and a "type", it is the type.
  if (
    mapping.type !== NONE &&
    (mapping.type === mapping.debit || mapping.type === mapping.credit)
  ) {
    if (mapping.type === mapping.debit) mapping.debit = NONE;
    if (mapping.type === mapping.credit) mapping.credit = NONE;
  }
  return mapping;
}

/** Whether a row looks like the header of a statement: it names a date and some kind of amount. */
export function looksLikeHeader(row: readonly string[]): boolean {
  const m = detectColumns(row);
  return m.date !== NONE && (m.debit !== NONE || m.credit !== NONE || m.amount !== NONE);
}

/** Statements often have account details above the table; this finds where the table begins. */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  return rows.findIndex((row) => row.length >= 3 && looksLikeHeader(row));
}

interface Preset {
  name: string;
  /** Header keys that, together, say whose statement this is. */
  signature: string[];
}

export const BANK_PRESETS: readonly Preset[] = [
  {
    name: 'HDFC Bank',
    signature: ['narration', 'chqrefno', 'withdrawalamt', 'depositamt', 'closingbalance'],
  },
  {
    name: 'ICICI Bank',
    signature: ['transactionremarks', 'withdrawalamountinr', 'depositamountinr'],
  },
  {
    name: 'State Bank of India',
    signature: ['txndate', 'description', 'refnochequeno', 'debit', 'credit'],
  },
  { name: 'Axis Bank', signature: ['trandate', 'chqno', 'particulars', 'dr', 'cr'] },
  {
    name: 'Kotak Mahindra Bank',
    signature: ['transactiondate', 'chqrefno', 'debit', 'credit', 'drcr'],
  },
];

/** The bank whose statement this looks like, if the headers match one of the known shapes. */
export function detectBank(header: readonly string[]): string | null {
  const keys = new Set(header.map(headerKey));
  const match = BANK_PRESETS.find((preset) =>
    preset.signature.every((key) => [...keys].some((k) => k === key || k.startsWith(key))),
  );
  return match?.name ?? null;
}

// --- cells ------------------------------------------------------------------------------------

export interface Money {
  /** Always positive. */
  minor: number;
  /** Shown with a minus sign or in brackets. */
  negative: boolean;
  /** Marked "Cr" / "Dr", when the cell says so. */
  mark: 'cr' | 'dr' | null;
}

/** "1,23,456.78", "-500", "(500.00)", "₹ 99", "500.00 Dr", "INR 45.5 CR". Blank or unreadable is null. */
export function parseAmount(cell: string): Money | null {
  let text = cell.trim();
  if (text === '') return null;
  let negative = false;
  let mark: Money['mark'] = null;

  const bracketed = /^\((.*)\)$/.exec(text);
  if (bracketed) {
    negative = true;
    text = bracketed[1] ?? '';
  }
  const marked = /\s*(cr|dr)\.?$/i.exec(text);
  if (marked) {
    mark = (marked[1] ?? '').toLowerCase() as 'cr' | 'dr';
    text = text.slice(0, marked.index);
  }
  text = text.replace(/^(inr|rs\.?|₹)\s*/i, '').trim();
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  const minor = parseRupees(text);
  return minor === null ? null : { minor, negative, mark };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export type DateOrder = 'dmy' | 'mdy';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A date in any of the usual statement layouts ("2026-10-02", "02/10/2026", "02-10-26",
 * "2 Oct 2026", "02-Oct-26", with or without a time after it) as "YYYY-MM-DD", or null.
 * `order` settles which of day and month comes first when both are numbers.
 */
export function parseStatementDate(cell: string, order: DateOrder = 'dmy'): string | null {
  const text = cell.trim().split(/[ T]+(?=\d{1,2}:\d{2})/)[0] ?? '';
  const build = (y: number, m: number, d: number) => {
    const year = y < 100 ? 2000 + y : y;
    const date = `${year}-${pad(m)}-${pad(d)}`;
    return isValidLocalDate(date) ? date : null;
  };

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]*(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf((m[2] ?? '').slice(0, 3).toLowerCase()) + 1;
    return month > 0 ? build(Number(m[3]), month, Number(m[1])) : null;
  }

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return order === 'dmy' ? build(Number(m[3]), b, a) : build(Number(m[3]), a, b);
  }
  return null;
}

// --- rows -------------------------------------------------------------------------------------

export interface ImportRow {
  /** Position in the file (1-based, counting from the first row of the file), for messages. */
  line: number;
  date: string;
  amountMinor: number;
  note: string;
}

export interface Interpreted {
  rows: ImportRow[];
  /** Money that came in (salary, refunds): not an expense, so not imported. */
  credits: number;
  /** Rows without a readable date or amount (totals, notes, blank balances). */
  unreadable: number;
}

export interface InterpretOptions {
  dateOrder: DateOrder;
  /**
   * For a single "amount" column with no Dr/Cr marker: whether spending is the negative numbers
   * (a bank account) or the positive ones (a credit card).
   */
  spendingIs: 'negative' | 'positive';
}

/** Reads the table below the header into expenses. */
export function interpretRows(
  rows: readonly (readonly string[])[],
  firstLine: number,
  mapping: Mapping,
  { dateOrder, spendingIs }: InterpretOptions,
): Interpreted {
  const out: Interpreted = { rows: [], credits: 0, unreadable: 0 };
  const cell = (row: readonly string[], field: Field) =>
    mapping[field] === NONE ? '' : (row[mapping[field]] ?? '');

  rows.forEach((row, i) => {
    const date = parseStatementDate(cell(row, 'date'), dateOrder);
    const note = cell(row, 'description').replace(/\s+/g, ' ').trim();

    let spend: number | null = null;
    let credit = false;

    const debit = parseAmount(cell(row, 'debit'));
    const money = parseAmount(cell(row, 'credit'));
    if (mapping.debit !== NONE || mapping.credit !== NONE) {
      if (debit && debit.minor > 0) spend = debit.minor;
      else if (money && money.minor > 0) credit = true;
    } else {
      const amount = parseAmount(cell(row, 'amount'));
      if (amount && amount.minor > 0) {
        const kind = cell(row, 'type').trim().toLowerCase();
        const marked =
          amount.mark ?? (kind.startsWith('d') ? 'dr' : kind.startsWith('c') ? 'cr' : null);
        const isSpend = marked
          ? marked === 'dr'
          : spendingIs === 'negative'
            ? amount.negative
            : !amount.negative;
        if (isSpend) spend = amount.minor;
        else credit = true;
      }
    }

    if (date === null || (spend === null && !credit)) out.unreadable++;
    else if (credit) out.credits++;
    else if (spend !== null) {
      out.rows.push({ line: firstLine + i, date, amountMinor: spend, note });
    }
  });
  return out;
}

/**
 * Which sign means spending in a signed single-amount column: negative for a bank account (money
 * out is the minus numbers), positive for a credit card (a bill payment or a refund is the odd
 * minus one out). Whichever sign most rows have is taken to be spending, and a tie keeps the
 * bank-account default.
 */
export function guessSpendingSign(
  rows: readonly (readonly string[])[],
  mapping: Mapping,
): 'negative' | 'positive' {
  if (mapping.amount === NONE) return 'negative';
  let negatives = 0;
  let positives = 0;
  for (const row of rows) {
    const amount = parseAmount(row[mapping.amount] ?? '');
    // Nothing is imported from a zero (a waived charge, zero interest), so it says nothing.
    if (!amount || amount.minor === 0) continue;
    if (amount.negative) negatives++;
    else positives++;
  }
  return negatives >= positives ? 'negative' : 'positive';
}

// --- duplicates and categories ------------------------------------------------------------------

export interface ExistingExpense {
  occurredOn: string;
  amountMinor: number;
}

/**
 * Rows that look like something already recorded: the same day and the same amount. Each recorded
 * expense accounts for one row only, so a second ₹20 tea on the same day (one recorded, two in the
 * file) is still offered. This only suggests; the person can still tick a flagged row.
 */
export function findDuplicates(
  rows: readonly ImportRow[],
  existing: readonly ExistingExpense[],
): Set<number> {
  const unmatched = new Map<string, number>();
  for (const e of existing) {
    const key = `${e.occurredOn}|${e.amountMinor}`;
    unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
  }
  const dupes = new Set<number>();
  rows.forEach((row, index) => {
    const key = `${row.date}|${row.amountMinor}`;
    const left = unmatched.get(key) ?? 0;
    if (left === 0) return;
    dupes.add(index);
    unmatched.set(key, left - 1);
  });
  return dupes;
}

/**
 * Which rows of a long file the page shows, as `[start, end)`. At most `max` of them are ticked, so
 * the person can never import more than `max` at once, and rows they untick (a transfer, a card
 * bill) do not use up places. In a file of more than `max` rows the run of already-recorded rows at
 * the top is left out, so choosing the file again lands on the rows that still need importing
 * rather than on a screenful of rows that are done. `recorded` holds positions in `rows`.
 */
export function importWindow(
  rows: readonly ImportRow[],
  recorded: ReadonlySet<number>,
  isTicked: (row: ImportRow, index: number) => boolean,
  max: number,
): { start: number; end: number } {
  let start = 0;
  if (rows.length > max) {
    while (start < rows.length && recorded.has(start)) start++;
  }
  let ticked = 0;
  for (const [index, row] of rows.entries()) {
    if (index < start || !isTicked(row, index)) continue;
    if (ticked === max) return { start, end: index };
    ticked++;
  }
  return { start, end: rows.length };
}

// Words that appear in Indian bank narrations, tried in order, and the default category each means.
// A short word that also sits inside other words (TORRENT POWER, MOTOROLA, COCA-COLA, METROPOLIS)
// must not have a letter on either side: `word()`. Digits, `_`, `-` and `/` around it are fine
// (`UPI_OLA_123`, `OLA2345`). The forms that run letters together (BHARATGAS, PVRINOX) are listed
// next to it. Long, distinctive names (swiggy, amazon) match anywhere in the narration.
const word = (...alternatives: string[]) => `(?:^|[^a-z])(?:${alternatives.join('|')})(?![a-z])`;
const pattern = (...parts: string[]) => new RegExp(parts.join('|'), 'i');

const KEYWORDS: [RegExp, string][] = [
  [
    pattern(
      'swiggy|zomato|restaurant|cafe|café|dominos|mcdonald|kfc|pizza|starbucks|eatery|bakery|dining',
    ),
    'Food & dining',
  ],
  [
    pattern(
      'bigbasket|blinkit|zepto|dmart|grofers|grocer|supermarket|instamart|freshtohome',
      word('fresh'),
    ),
    'Groceries',
  ],
  [
    pattern(
      'uber|rapido|irctc|petrol|fuel|fastag|redbus|parking|indian oil|hpcl|bpcl',
      word('ola(?:cabs?)?', 'metro'),
    ),
    'Transport',
  ],
  [pattern('maintenance|society|housing', word('rent', 'rental')), 'Rent & home'],
  [
    pattern(
      'electricity|bescom|airtel|jio|vodafone|broadband|recharge|water bill|bill ?pay|insurance',
      'bharatgas|hpgas|indanegas',
      word('gas', 'vi', 'lic'),
    ),
    'Bills & utilities',
  ],
  [pattern('amazon|flipkart|myntra|ajio|nykaa|meesho'), 'Shopping'],
  [
    pattern(
      'pharmacy|apollo|hospital|clinic|medplus|pharmeasy|diagnostic|doctor',
      'tata ?1mg',
      word('1mg'),
    ),
    'Health',
  ],
  [
    pattern(
      'netflix|hotstar|spotify|prime video|bookmyshow|youtube|cinema',
      'pvrinox',
      word('pvr', 'inox'),
    ),
    'Entertainment',
  ],
  [
    pattern(
      'makemytrip|goibibo|indigo|air india|vistara|hotel|airbnb|cleartrip',
      'oyorooms',
      word('oyo'),
    ),
    'Travel',
  ],
];

/** The id of the category a narration most likely belongs to, or null when nothing is recognised. */
export function suggestCategory(
  note: string,
  categories: readonly { id: string; name: string }[],
): string | null {
  for (const [pattern, name] of KEYWORDS) {
    if (!pattern.test(note)) continue;
    const found = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
  }
  return null;
}
