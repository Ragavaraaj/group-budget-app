import { PAISE_PER_RUPEE } from '@budget/shared';
import type {
  LocalBudget,
  LocalCategory,
  LocalExpense,
  LocalGroup,
  LocalMember,
  LocalRecurring,
  LocalSettlement,
} from '@/db/types';

/** Everything this device knows, as one JSON-able object. */
export interface ExportBundle {
  exportedAt: string;
  user: { id: string; name: string; email: string };
  groups: LocalGroup[];
  members: LocalMember[];
  categories: LocalCategory[];
  expenses: LocalExpense[];
  settlements: LocalSettlement[];
  budgets: LocalBudget[];
  recurring: LocalRecurring[];
}

/**
 * A spreadsheet will run a cell that starts with = + - @ as a formula, which is a way to attack
 * whoever opens an exported file. Prefix those with an apostrophe, then quote the cell.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rupees = (paise: number) => (paise / PAISE_PER_RUPEE).toFixed(2);

const HEADER = [
  'Date',
  'Group',
  'Category',
  'Note',
  'Total (INR)',
  'Your share (INR)',
  'Paid by',
  'Added by',
];

/** One line per expense that has not been deleted, newest first. */
export function expensesToCsv(bundle: ExportBundle): string {
  const groupName = new Map(bundle.groups.map((g) => [g.id, g.isPersonal ? 'Personal' : g.name]));
  const categoryName = new Map(bundle.categories.map((c) => [c.id, c.name]));
  const personName = new Map<string, string>();
  for (const m of bundle.members) personName.set(m.userId, m.displayName);
  personName.set(bundle.user.id, bundle.user.name);
  const who = (id: string) => personName.get(id) ?? 'Former member';

  const rows = bundle.expenses
    .filter((e) => e.deletedAt === null)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.updatedAt - a.updatedAt)
    .map((e) => {
      const mine = e.shares.find((s) => s.userId === bundle.user.id)?.amountMinor ?? 0;
      return [
        e.occurredOn,
        groupName.get(e.groupId) ?? '',
        e.categoryId ? (categoryName.get(e.categoryId) ?? '') : '',
        e.note,
        rupees(e.amountMinor),
        rupees(mine),
        e.payers.map((p) => who(p.userId)).join(' + '),
        who(e.createdBy),
      ].map(csvCell);
    });
  return [HEADER.map(csvCell), ...rows].map((row) => row.join(',')).join('\r\n');
}

export function exportToJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Saves text as a file through the browser. */
export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
