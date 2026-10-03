/**
 * Money is always integer paise (₹1 = 100 paise). Never use floats for amounts;
 * convert to/from rupees only at the UI boundary with the helpers below.
 */

export const CURRENCY = 'INR' as const;
export const PAISE_PER_RUPEE = 100;

/** Sanity cap for a single amount: ₹10 crore, far above any real expense. */
export const MAX_PAISE = 10_000_000_000;

const formatters = {
  whole: new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }),
  fractional: new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

/**
 * Parses what a person types into paise: "1234", "1,234.5", "₹ 1,23,456.78", ".5".
 * A trailing dot ("12.") is accepted since that is what people type mid-entry.
 * Returns null for anything else (negative, 3+ decimals, letters, too large).
 * Zero is accepted here; callers decide whether zero is a valid amount.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return null;

  const rupees = whole === '' ? 0 : Number(whole);
  if (!Number.isSafeInteger(rupees)) return null;

  const paise = rupees * PAISE_PER_RUPEE + Number(fraction.padEnd(2, '0'));
  return paise <= MAX_PAISE ? paise : null;
}

/** Formats paise for display with Indian digit grouping: 12345678 → "₹1,23,456.78". */
export function formatPaise(paise: number): string {
  const formatter = paise % PAISE_PER_RUPEE === 0 ? formatters.whole : formatters.fractional;
  return formatter.format(paise / PAISE_PER_RUPEE);
}

/** Plain editable string for form fields: 12345 → "123.45", 12300 → "123", -50 → "-0.50". */
export function toRupeesString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const whole = Math.trunc(Math.abs(paise) / PAISE_PER_RUPEE);
  const fraction = Math.abs(paise) % PAISE_PER_RUPEE;
  return `${sign}${whole}${fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`}`;
}
