/**
 * Balances are always derived from the expenses and settlements, never stored, so there is
 * nothing to drift out of sync: net(user) = Σ paid − Σ owed, adjusted by settlements.
 * A positive balance means the group owes that person; a negative one means they owe the group.
 */

export interface Allocation {
  userId: string;
  amountMinor: number;
}

export interface BalanceExpense {
  payers: readonly Allocation[];
  shares: readonly Allocation[];
}

export interface BalanceSettlement {
  /** The person who paid the money back. */
  fromUser: string;
  /** The person who received it. */
  toUser: string;
  amountMinor: number;
}

export interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}

/** Net balance per user, in paise. Users with a zero balance are kept (they are still members). */
export function computeBalances(
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[],
): Map<string, number> {
  const net = new Map<string, number>();
  const add = (userId: string, amount: number) => net.set(userId, (net.get(userId) ?? 0) + amount);

  for (const expense of expenses) {
    for (const payer of expense.payers) add(payer.userId, payer.amountMinor);
    for (const share of expense.shares) add(share.userId, -share.amountMinor);
  }
  for (const settlement of settlements) {
    add(settlement.fromUser, settlement.amountMinor);
    add(settlement.toUser, -settlement.amountMinor);
  }
  return net;
}

/**
 * The fewest simple payments that clear every balance (greedy min-cash-flow): repeatedly make the
 * biggest debtor pay the biggest creditor. Produces at most (people with a balance − 1) transfers.
 * Deterministic: ties are broken by user id.
 */
export function simplifyDebts(balances: ReadonlyMap<string, number>): Transfer[] {
  const creditors: { userId: string; amount: number }[] = [];
  const debtors: { userId: string; amount: number }[] = [];
  for (const [userId, balance] of balances) {
    if (balance > 0) creditors.push({ userId, amount: balance });
    if (balance < 0) debtors.push({ userId, amount: -balance });
  }
  const byAmountThenId = (a: { userId: string; amount: number }, b: typeof a) =>
    b.amount - a.amount || a.userId.localeCompare(b.userId);

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
    const creditor = creditors[0];
    const debtor = debtors[0];
    if (!creditor || !debtor) break;

    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({ from: debtor.userId, to: creditor.userId, amountMinor: amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
  }
  return transfers;
}
