import { Loader2 } from 'lucide-react';
import { LogoMark } from '@/components/logo-mark';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden="true" />;
}

/** Full-screen placeholder shown while the app works out who is signed in. */
export function SplashScreen() {
  return (
    <div
      className="bg-hero text-hero-foreground pt-safe pb-safe flex min-h-dvh flex-col items-center px-8 pb-14"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
        <LogoMark animated className="w-40" />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Group Budget</h1>
          <p className="text-hero-foreground/80">Shared spending, sorted.</p>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3" aria-hidden="true">
        <div className="h-1 w-30 overflow-hidden rounded-full bg-white/20">
          <div className="splash-bar h-full w-2/5 rounded-full bg-white" />
        </div>
        <p className="text-hero-foreground/80 text-sm">Opening your ledger</p>
      </div>
    </div>
  );
}
