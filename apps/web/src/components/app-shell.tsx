import { ReceiptText } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { SignedInProvider } from '@/auth/sync-context';
import { NotInstalledBanner, SessionExpiredBanner } from '@/components/banners';
import { BottomNav } from '@/components/bottom-nav';
import { SplashScreen } from '@/components/spinner';
import { SyncStatusChip } from '@/components/sync-status';

/** Everything behind sign-in: sets up the person's database and sync, then the app frame. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <SplashScreen />;
  if (state.status === 'signed_out') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return (
    <SignedInProvider me={state.me}>
      <AppShell />
    </SignedInProvider>
  );
}

function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <main className="flex-1 pt-safe">
        {/* Bottom padding keeps the last item clear of the fixed tab bar. */}
        <div className="space-y-4 px-4 pt-3 pb-28">
          <div className="flex items-center justify-between">
            <span className="text-primary flex items-center gap-1.5 text-sm font-bold tracking-tight">
              <ReceiptText className="size-4" aria-hidden="true" />
              Group Budget
            </span>
            <SyncStatusChip />
          </div>
          <SessionExpiredBanner />
          <NotInstalledBanner />
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
