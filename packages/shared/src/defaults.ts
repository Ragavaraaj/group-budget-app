/** Categories every new personal ledger and group starts with. Icons are Lucide icon names. */
export interface DefaultCategory {
  name: string;
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: 'Food & dining', icon: 'utensils', color: '#f97316' },
  { name: 'Groceries', icon: 'shopping-cart', color: '#22c55e' },
  { name: 'Transport', icon: 'car', color: '#3b82f6' },
  { name: 'Rent & home', icon: 'house', color: '#8b5cf6' },
  { name: 'Bills & utilities', icon: 'zap', color: '#eab308' },
  { name: 'Shopping', icon: 'shopping-bag', color: '#ec4899' },
  { name: 'Health', icon: 'heart-pulse', color: '#ef4444' },
  { name: 'Entertainment', icon: 'film', color: '#14b8a6' },
  { name: 'Travel', icon: 'plane', color: '#0ea5e9' },
  { name: 'Other', icon: 'ellipsis', color: '#64748b' },
];
