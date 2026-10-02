import { ChartColumn, type LucideIcon, ReceiptIndianRupee, Settings, Users } from 'lucide-react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const items: NavItem[] = [
  { to: '/', label: 'Expenses', icon: ReceiptIndianRupee, end: true },
  { to: '/insights', label: 'Insights', icon: ChartColumn },
  { to: '/groups', label: 'Groups', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 px-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]"
    >
      <ul className="bg-card mx-auto grid max-w-xl grid-cols-4 gap-1 rounded-[1.65rem] p-1.5 shadow-lg ring-1 shadow-black/10 ring-black/5 dark:ring-white/10">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 rounded-[1.25rem] py-2 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
