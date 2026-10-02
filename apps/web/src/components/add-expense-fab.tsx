import { Plus } from 'lucide-react';
import { Link } from 'react-router';

/** The round "add" button floating above the tab bar. */
export function AddExpenseFab({ to }: { to: string }) {
  return (
    <Link
      to={to}
      aria-label="Add expense"
      className="bg-primary text-primary-foreground fixed right-5 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 grid size-15 place-items-center rounded-[1.35rem] shadow-lg shadow-black/20 transition-transform outline-none hover:brightness-110 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95"
    >
      <Plus className="size-6" strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}
