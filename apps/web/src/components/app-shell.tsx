import { Outlet } from 'react-router';
import { BottomNav } from '@/components/bottom-nav';

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <main className="flex-1 pt-safe">
        {/* Bottom padding keeps the last item clear of the fixed tab bar. */}
        <div className="px-4 pt-6 pb-28">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
