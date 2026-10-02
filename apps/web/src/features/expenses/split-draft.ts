import {
  BASIS_POINTS_TOTAL,
  computeShares,
  formatPaise,
  parseRupees,
  type Share,
  type SplitParticipant,
  type SplitType,
  toRupeesString,
} from '@budget/shared';

/**
 * What the person has typed into the "who paid, who owes" part of the form, kept as text so
 * half-typed values are never lost. `resolveSplit` turns it into exact paise, or says why not.
 */
export interface SplitDraft {
  type: SplitType;
  /** Equal split: the people sharing it. */
  included: string[];
  /** Exact / percent / shares: what was typed for each person ("" = not in the split). */
  values: Record<string, string>;
  /** Who paid, when it was one person. */
  payerId: string;
  multiplePayers: boolean;
  /** When several people paid: what each put in (rupees; "" = didn't pay). */
  payerAmounts: Record<string, string>;
}

export type Resolved =
  | {
      ok: true;
      splitType: SplitType;
      payers: { userId: string; amountMinor: number }[];
      shares: Share[];
    }
  | { ok: false; message: string };

/** "33.33" → 3333 basis points. Accepts up to two decimals, 0 to 100. Null if it isn't a percentage. */
export function parsePercent(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const basisPoints = whole * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints <= BASIS_POINTS_TOTAL ? basisPoints : null;
}

export const percentToString = (basisPoints: number): string => {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
};

/** The starting point for a new expense: paid by `me`, split equally between everyone. */
export function newDraft(me: string, memberIds: string[]): SplitDraft {
  return {
    type: 'equal',
    included: memberIds,
    values: {},
    payerId: me,
    multiplePayers: false,
    payerAmounts: {},
  };
}

/** Rebuilds the draft from a saved expense so it can be edited exactly as it was entered. */
export function draftFromExpense(expense: {
  splitType: SplitType;
  payers: { userId: string; amountMinor: number }[];
  shares: Share[];
}): SplitDraft {
  const values: Record<string, string> = {};
  for (const share of expense.shares) {
    if (expense.splitType === 'exact') values[share.userId] = toRupeesString(share.amountMinor);
    else if (expense.splitType === 'percent')
      values[share.userId] = percentToString(share.weight ?? 0);
    else if (expense.splitType === 'shares') values[share.userId] = String(share.weight ?? 1);
  }
  const [first] = expense.payers;
  return {
    type: expense.splitType,
    included: expense.shares.map((s) => s.userId),
    values,
    payerId: first?.userId ?? '',
    multiplePayers: expense.payers.length > 1,
    payerAmounts: Object.fromEntries(
      expense.payers.map((p) => [p.userId, toRupeesString(p.amountMinor)]),
    ),
  };
}

/** Switching split type: keep what was typed where it still makes sense, fill in sensible starts. */
export function withType(draft: SplitDraft, type: SplitType, memberIds: string[]): SplitDraft {
  if (type === draft.type) return draft;
  const values: Record<string, string> = {};
  if (type === 'shares')
    for (const id of draft.included.length ? draft.included : memberIds) values[id] = '1';
  return { ...draft, type, values };
}

/** Turns the draft into amounts that add up exactly, or a short message saying what is missing. */
export function resolveSplit(draft: SplitDraft, amountMinor: number | null): Resolved {
  if (amountMinor === null || amountMinor <= 0) return { ok: false, message: 'Enter an amount.' };

  // Who paid.
  let payers: { userId: string; amountMinor: number }[];
  if (!draft.multiplePayers) {
    if (!draft.payerId) return { ok: false, message: 'Choose who paid.' };
    payers = [{ userId: draft.payerId, amountMinor }];
  } else {
    payers = [];
    for (const [userId, text] of Object.entries(draft.payerAmounts)) {
      if (text.trim() === '') continue;
      const paise = parseRupees(text);
      if (paise === null) return { ok: false, message: 'Check the amounts people paid.' };
      if (paise > 0) payers.push({ userId, amountMinor: paise });
    }
    const paid = payers.reduce((sum, p) => sum + p.amountMinor, 0);
    if (payers.length === 0) return { ok: false, message: 'Enter what each person paid.' };
    if (paid !== amountMinor) {
      const diff = amountMinor - paid;
      return {
        ok: false,
        message:
          diff > 0
            ? `${formatPaise(diff)} of the payment isn’t assigned yet.`
            : `Payments are ${formatPaise(-diff)} over the total.`,
      };
    }
  }

  // Who owes.
  let participants: SplitParticipant[];
  if (draft.type === 'equal') {
    if (draft.included.length === 0)
      return { ok: false, message: 'Pick at least one person to split with.' };
    participants = draft.included.map((userId) => ({ userId }));
  } else {
    participants = [];
    for (const [userId, text] of Object.entries(draft.values)) {
      if (text.trim() === '') continue;
      const value =
        draft.type === 'exact'
          ? parseRupees(text)
          : draft.type === 'percent'
            ? parsePercent(text)
            : /^\d{1,4}$/.test(text.trim())
              ? Number(text)
              : null;
      if (value === null) return { ok: false, message: 'Check the numbers in the split.' };
      if (value > 0 || draft.type === 'exact') participants.push({ userId, value });
    }
    participants = participants.filter((p) => draft.type !== 'exact' || (p.value ?? 0) > 0);
    if (participants.length === 0) return { ok: false, message: 'Pick who shares this expense.' };
  }

  const result = computeShares(draft.type, amountMinor, participants);
  if (result.ok) return { ok: true, splitType: draft.type, payers, shares: result.shares };

  if (result.error === 'sum_mismatch') {
    const entered = participants.reduce((sum, p) => sum + (p.value ?? 0), 0);
    if (draft.type === 'percent') {
      const left = BASIS_POINTS_TOTAL - entered;
      return {
        ok: false,
        message:
          left > 0
            ? `${percentToString(left)}% left to assign.`
            : `${percentToString(-left)}% over 100%.`,
      };
    }
    const left = amountMinor - entered;
    return {
      ok: false,
      message:
        left > 0 ? `${formatPaise(left)} left to assign.` : `${formatPaise(-left)} over the total.`,
    };
  }
  return { ok: false, message: 'Check the split.' };
}
